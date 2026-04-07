/**
 * Claude Web client (CDP-based).
 * Sends messages to claude.ai API using Chrome browser context to bypass
 * Cloudflare bot protection, similar to ChatGPT and Kimi clients.
 */

import type { Page } from "playwright-core";
import { BrowserManager } from "../../browser/manager.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { ClaudeWebAuth } from "./auth.ts";
import { parseClaudeStream } from "./stream.ts";

export class ClaudeWebClient implements WebProviderClient {
	readonly providerId = "claude-web";
	private cookie: string;
	private organizationId?: string;
	private userAgent: string;
	private readonly baseUrl = "https://claude.ai/api";

	private page: Page | null = null;

	constructor(auth: ClaudeWebAuth) {
		this.cookie = auth.cookie || `sessionKey=${auth.sessionKey}`;
		this.organizationId = auth.organizationId;
		this.userAgent =
			auth.userAgent ||
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
	}

	private async ensurePage(): Promise<Page> {
		if (this.page) {
			try {
				await this.page.evaluate(() => document.readyState);
				return this.page;
			} catch {
				this.page = null;
			}
		}
		const bm = BrowserManager.getInstance();
		this.page = await bm.getPage("claude.ai", "https://claude.ai/");
		if (this.cookie) {
			if (this.cookie.trim() && !this.cookie.startsWith("{")) {
				const cookies = this.cookie
					.split(";")
					.map((c) => {
						const [name, ...valueParts] = c.trim().split("=");
						return {
							name: name?.trim() ?? "",
							value: valueParts.join("=").trim(),
							domain: ".claude.ai",
							path: "/",
						};
					})
					.filter((c) => c.name.length > 0);
				await bm.addCookies(cookies);
			}
		}
		return this.page;
	}

	async init(): Promise<void> {
		const page = await this.ensurePage();

		if (this.organizationId) return;

		// Discover organization ID via browser-side fetch
		try {
			const orgResult = await page.evaluate(async (baseUrl: string) => {
				const res = await fetch(`${baseUrl}/organizations`, { credentials: "include" });
				if (!res.ok) return null;
				const orgs = (await res.json()) as Array<{ uuid: string }>;
				return orgs[0]?.uuid ?? null;
			}, this.baseUrl);

			if (orgResult) {
				this.organizationId = orgResult;
				console.log(`[ClaudeWeb] Discovered organization: ${this.organizationId}`);
			}
		} catch {
			// ignore - will try without org ID
		}
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const page = await this.ensurePage();

		const model = params.model || "claude-sonnet-4-20250514";
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const conversationUuid = crypto.randomUUID();
		const orgId = this.organizationId;
		const baseUrl = this.baseUrl;

		// Execute all API calls inside the browser context to bypass Cloudflare
		const responseData = (await page.evaluate(
			async ({
				baseUrl: apiBase,
				orgId: org,
				conversationUuid: convUuid,
				model: mdl,
				timezone: tz,
				message: msg,
			}) => {
				// Step 1: Create conversation
				const createUrl = org
					? `${apiBase}/organizations/${org}/chat_conversations`
					: `${apiBase}/chat_conversations`;

				const createRes = await fetch(createUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({ name: "", uuid: convUuid }),
				});

				if (!createRes.ok) {
					const text = await createRes.text();
					return {
						ok: false as const,
						status: createRes.status,
						error: `Failed to create conversation: ${createRes.status} ${text.slice(0, 500)}`,
					};
				}

				const conv = (await createRes.json()) as { uuid: string };

				// Step 2: Send completion
				const completionUrl = org
					? `${apiBase}/organizations/${org}/chat_conversations/${conv.uuid}/completion`
					: `${apiBase}/chat_conversations/${conv.uuid}/completion`;

				const completionRes = await fetch(completionUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "text/event-stream",
					},
					credentials: "include",
					body: JSON.stringify({
						prompt: msg,
						parent_message_uuid: "00000000-0000-4000-8000-000000000000",
						model: mdl,
						timezone: tz,
						rendering_mode: "messages",
						attachments: [],
						files: [],
						locale: "en-US",
						personalized_styles: [],
						sync_sources: [],
						tools: [],
					}),
				});

				if (!completionRes.ok) {
					const text = await completionRes.text();
					return {
						ok: false as const,
						status: completionRes.status,
						error: `Claude API error: ${completionRes.status} ${text.slice(0, 500)}`,
					};
				}

				// Read entire SSE stream in browser context
				const reader = completionRes.body?.getReader();
				if (!reader) {
					return { ok: false as const, status: 500, error: "No response body from Claude API" };
				}

				const decoder = new TextDecoder();
				let fullText = "";
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					fullText += decoder.decode(value, { stream: true });
				}

				return { ok: true as const, data: fullText };
			},
			{
				baseUrl,
				orgId: orgId ?? null,
				conversationUuid,
				model,
				timezone,
				message: params.message,
			},
		)) as { ok: true; data: string } | { ok: false; status: number; error: string };

		if (!responseData.ok) {
			if (responseData.status === 403) {
				console.log("[ClaudeWeb] 403 from API even via CDP, falling back to DOM simulation");
				return this.chatCompletionsViaDOM({ message: params.message, signal: params.signal });
			}
			if (responseData.status === 401) {
				throw new Error("Claude authentication failed. Please run `webauth` to refresh.");
			}
			throw new Error(responseData.error ?? `Claude API error ${responseData.status}`);
		}

		console.log(`[ClaudeWeb] Response length: ${responseData.data?.length || 0} bytes`);

		const encoder = new TextEncoder();
		const data = responseData.data ?? "";
		return new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(data));
				controller.close();
			},
		});
	}

	/**
	 * DOM-based fallback: type the message into claude.ai's chat input and poll
	 * for the assistant reply. Used when even browser-context fetch returns 403.
	 */
	private async chatCompletionsViaDOM(params: {
		message: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const page = await this.ensurePage();

		const inputSelectors = [
			'div.ProseMirror[contenteditable="true"]',
			'[contenteditable="true"]',
			"textarea",
		];
		let inputHandle = null;
		for (const sel of inputSelectors) {
			inputHandle = await page.$(sel);
			if (inputHandle) break;
		}
		if (!inputHandle) {
			throw new Error("Claude DOM fallback failed: chat input not found. Is claude.ai loaded?");
		}

		await inputHandle.click();
		await page.waitForTimeout(300);
		await page.keyboard.type(params.message, { delay: 20 });
		await page.waitForTimeout(500);
		await page.keyboard.press("Enter");
		console.log("[ClaudeWeb] DOM: typed message and pressed Enter");

		const maxWaitMs = 120000;
		const pollIntervalMs = 2000;
		let lastText = "";
		let stableCount = 0;
		const signal = params.signal;

		for (let elapsed = 0; elapsed < maxWaitMs; elapsed += pollIntervalMs) {
			if (signal?.aborted) throw new Error("Claude request cancelled");
			await new Promise((r) => setTimeout(r, pollIntervalMs));

			const result = await page.evaluate(() => {
				const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
				const assistantMessages = document.querySelectorAll(
					'[data-is-streaming], [class*="response"], [class*="assistant"], [class*="markdown"]',
				);
				let text = "";
				if (assistantMessages.length > 0) {
					const last = assistantMessages[assistantMessages.length - 1];
					if (last) text = clean((last as HTMLElement).innerText ?? "");
				}
				const stopBtn = document.querySelector(
					'button[aria-label*="Stop"], [class*="stop-button"]',
				);
				return { text, isStreaming: !!stopBtn };
			});

			if (result.text && result.text.length >= 20) {
				if (result.text !== lastText) {
					lastText = result.text;
					stableCount = 0;
				} else {
					stableCount++;
					if (!result.isStreaming && stableCount >= 2) break;
				}
			}
		}

		if (!lastText) {
			throw new Error(
				"Claude DOM fallback: no assistant reply detected. Ensure claude.ai is open and logged in.",
			);
		}

		// Wrap as SSE for stream parser compatibility
		const fakeSse = `data: ${JSON.stringify({
			type: "content_block_delta",
			delta: { text: lastText },
		})}\n\ndata: [DONE]\n\n`;
		const encoder = new TextEncoder();
		return new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(fakeSse));
				controller.close();
			},
		});
	}

	async parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseClaudeStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
			{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
			{ id: "claude-opus-4-20250514", name: "Claude Opus 4" },
			{ id: "claude-opus-4-6", name: "Claude Opus 4.6" },
			{ id: "claude-haiku-4-20250514", name: "Claude Haiku 4" },
			{ id: "claude-haiku-4-6", name: "Claude Haiku 4.6" },
		];
	}

	async close(): Promise<void> {
		this.page = null;
	}
}
