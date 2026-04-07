import type { Page } from "playwright-core";
import { pasteText } from "../../browser/dom-input.ts";
import { BaseApiClient } from "../factory/base-api-client.ts";
import type { ApiClientConfig, NormalizedSendParams } from "../factory/types.ts";
import { parseCookieHeader } from "../shared/cookie-parser.ts";
import type { EvalResult } from "../shared/eval-helpers.ts";
import { withEvalTimeout } from "../shared/eval-helpers.ts";
import { textToStream } from "../shared/stream-helpers.ts";
import type { StreamResult } from "../types.ts";
import { SessionExpiredError } from "../types.ts";
import type { GrokWebAuth } from "./auth.ts";
import { parseGrokStream } from "./stream.ts";

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

export class GrokWebClient extends BaseApiClient<GrokWebAuth> {
	readonly providerId = "grok-web";

	protected readonly config: ApiClientConfig = {
		hostKey: "grok.com",
		startUrl: "https://grok.com",
		cookieDomain: ".grok.com",
		defaultModel: "grok-2",
		models: [
			{ id: "grok-1", name: "Grok 1 (Web)" },
			{ id: "grok-2", name: "Grok 2 (Web)" },
		],
	};

	lastConversationId: string | undefined;

	protected getCookies() {
		return parseCookieHeader(this.auth.cookie, this.config.cookieDomain);
	}

	/**
	 * Not used directly — Grok overrides `sendMessage` because its
	 * pull-based streaming and DOM fallback logic requires custom flow.
	 */
	protected async callApi(_page: Page, _params: NormalizedSendParams): Promise<EvalResult> {
		throw new Error("Grok uses custom sendMessage; callApi is not reachable.");
	}

	/**
	 * Full custom sendMessage:
	 * - Uses page.evaluate to call Grok API with conversation management
	 * - 401 → SessionExpiredError
	 * - 403/anti-bot → DOM fallback
	 * - Returns pull-based ReadableStream from NDJSON chunks
	 */
	override async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const page = await this.getPage();

		const evalPromise = page.evaluate(
			async ({
				conversationId: convArg,
				parentResponseId,
				message,
			}: {
				conversationId?: string;
				parentResponseId?: string;
				message: string;
			}) => {
				let convId = convArg;
				const parentId = parentResponseId;
				if (!convId) {
					const m = window.location.pathname.match(/\/c\/([a-f0-9-]{36})/);
					convId = m?.[1] ?? undefined;
				}
				if (!convId) {
					const urls = [
						"https://grok.com/rest/app-chat/conversations?limit=1",
						"https://grok.com/rest/app-chat/conversations",
					];
					for (const url of urls) {
						const listRes = await fetch(url, { credentials: "include" });
						if (listRes.ok) {
							const list = (await listRes.json()) as {
								conversations?: Array<{ conversationId?: string }>;
							};
							convId = list?.conversations?.[0]?.conversationId ?? undefined;
							if (convId) break;
						}
					}
				}
				if (!convId) {
					const createRes = await fetch("https://grok.com/rest/app-chat/conversations", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "include",
						body: JSON.stringify({}),
					});
					if (createRes.ok) {
						const createData = (await createRes.json()) as { conversationId?: string; id?: string };
						convId = createData?.conversationId ?? createData?.id ?? undefined;
					}
				}
				if (!convId)
					throw new Error(
						`Need a Grok conversation. Open or start a chat on grok.com (current URL: ${window.location.href}).`,
					);

				const body: Record<string, unknown> = {
					message,
					parentResponseId:
						parentId ?? globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
					disableSearch: false,
					enableImageGeneration: true,
					imageAttachments: [],
					returnImageBytes: false,
					returnRawGrokInXaiRequest: false,
					fileAttachments: [],
					enableImageStreaming: true,
					imageGenerationCount: 2,
					forceConcise: false,
					toolOverrides: {},
					enableSideBySide: true,
					sendFinalMetadata: true,
					isReasoning: false,
					metadata: { request_metadata: { mode: "auto" } },
					disableTextFollowUps: false,
					disableArtifact: false,
					isFromGrokFiles: false,
					disableMemory: false,
					forceSideBySide: false,
					modelMode: "MODEL_MODE_AUTO",
					isAsyncChat: false,
					skipCancelCurrentInflightRequests: false,
					isRegenRequest: false,
					disableSelfHarmShortCircuit: false,
					deviceEnvInfo: {
						darkModeEnabled: false,
						devicePixelRatio: 1,
						screenWidth: 2560,
						screenHeight: 1440,
						viewportWidth: 1440,
						viewportHeight: 719,
					},
				};
				const response = await fetch(
					`https://grok.com/rest/app-chat/conversations/${convId}/responses`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "include",
						body: JSON.stringify(body),
					},
				);
				if (!response.ok) {
					const errText = await response.text();
					throw new Error(
						`Grok API error: ${response.status} ${response.statusText} - ${errText.slice(0, 300)}`,
					);
				}
				const reader = response.body?.getReader();
				if (!reader) throw new Error("No response body");
				const chunks: number[][] = [];
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value) chunks.push(Array.from(value));
				}
				return { chunks, conversationId: convId };
			},
			{
				conversationId: this.lastConversationId,
				parentResponseId: undefined as string | undefined,
				message: params.message,
			},
		);

		const timeoutMs = 120000;
		const result = await withEvalTimeout(evalPromise, timeoutMs, "Grok").catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("401")) {
				throw new SessionExpiredError(
					this.providerId,
					"Grok authentication failed. Re-run webauth to refresh the session.",
				);
			}
			if (msg.includes("403") || msg.includes("anti-bot")) {
				return this.chatCompletionsViaDOM({ message: params.message, signal: params.signal });
			}
			throw err;
		});

		if (result instanceof ReadableStream) return result;

		const apiResult = result as { chunks: number[][]; conversationId?: string };
		this.lastConversationId = apiResult.conversationId;
		const fullBytes = apiResult.chunks.flat();
		const fullText = new TextDecoder().decode(new Uint8Array(fullBytes));

		const parsedChunks: string[] = [];
		for (const line of fullText.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			try {
				const data = JSON.parse(t) as Record<string, unknown>;
				const content =
					(data.contentDelta as string | undefined) ??
					(data.textDelta as string | undefined) ??
					(data.content as string | undefined) ??
					(data.text as string | undefined) ??
					(data.delta as string | undefined);
				if (typeof content === "string" && content) parsedChunks.push(content);
			} catch {
				/* skip */
			}
		}

		let index = 0;
		return new ReadableStream({
			pull(controller) {
				if (index < parsedChunks.length) {
					const line = `${JSON.stringify({ contentDelta: parsedChunks[index] })}\n`;
					controller.enqueue(new TextEncoder().encode(line));
					index++;
				} else {
					controller.close();
				}
			},
		});
	}

	private async chatCompletionsViaDOM(params: {
		message: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const page = await this.getPage();
		const inputSelectors = [
			'[contenteditable="true"]',
			"textarea[placeholder]",
			"textarea",
			'div[role="textbox"]',
		];
		let inputHandle = null;
		for (const sel of inputSelectors) {
			inputHandle = await page.$(sel);
			if (inputHandle) break;
		}
		if (!inputHandle) throw new Error("Grok: could not find chat input");
		await inputHandle.click();
		await delay(300);
		await pasteText(page, params.message, inputHandle);
		await delay(300);
		await page.keyboard.press("Enter");
		const maxWaitMs = 90000;
		const pollIntervalMs = 2000;
		let lastText = "";
		let stableCount = 0;
		for (let elapsed = 0; elapsed < maxWaitMs; elapsed += pollIntervalMs) {
			if (params.signal?.aborted) throw new Error("Grok request aborted");
			await delay(pollIntervalMs);
			const result = await page.evaluate(() => {
				const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
				const selectors = [
					'[data-role="assistant"]',
					'[class*="assistant"]',
					'[class*="response"]',
					'[class*="message"]',
					"article",
					"[class*='markdown']",
					".prose",
				];
				let text = "";
				for (const sel of selectors) {
					const els = document.querySelectorAll(sel);
					const last = els.length > 0 ? els[els.length - 1] : null;
					if (last) {
						const t = clean((last as HTMLElement).textContent ?? "");
						if (t.length > 10) {
							text = t;
							break;
						}
					}
				}
				if (!text) {
					const all = document.querySelectorAll("p, div[class]");
					for (let i = all.length - 1; i >= 0; i--) {
						const t = clean((all[i] as HTMLElement).textContent ?? "");
						if (t.length > 20 && !t.includes("Ask Grok")) {
							text = t;
							break;
						}
					}
				}
				const stopBtn = document.querySelector('[aria-label*="Stop"], [aria-label*="stop"]');
				return { text, isStreaming: !!stopBtn };
			});
			if (result.text && result.text !== lastText) {
				lastText = result.text;
				stableCount = 0;
			} else if (result.text) {
				stableCount++;
				if (!result.isStreaming && stableCount >= 2) break;
			}
		}
		if (!lastText)
			throw new Error(
				"Grok: no reply detected. Open grok.com, sign in, and ensure the chat input is visible.",
			);
		const ndjsonLine = `${JSON.stringify({ contentDelta: lastText })}\n`;
		return textToStream(ndjsonLine);
	}

	protected parseStreamImpl(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseGrokStream(body, onDelta);
	}
}
