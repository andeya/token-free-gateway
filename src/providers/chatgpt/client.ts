import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { ChatGPTWebAuth } from "./auth.ts";
import { parseChatGPTStream } from "./stream.ts";

export class ChatGPTWebClient implements WebProviderClient {
	readonly providerId = "chatgpt-web";
	private accessToken: string;
	private cookie: string;
	private userAgent: string;
	private browser: BrowserContext | null = null;
	private page: Page | null = null;
	private conversationId: string | undefined;
	private parentMessageId: string | undefined;

	constructor(auth: ChatGPTWebAuth) {
		this.accessToken = auth.accessToken;
		this.cookie = auth.cookie || `__Secure-next-auth.session-token=${auth.accessToken}`;
		this.userAgent = auth.userAgent || "Mozilla/5.0";
	}

	private async ensureBrowser(): Promise<{ browser: BrowserContext; page: Page }> {
		if (this.browser && this.page) {
			return { browser: this.browser, page: this.page };
		}

		const cdpUrl = getDefaultCdpUrl();
		console.log(`[ChatGPT Web] Connecting to Chrome at ${cdpUrl}`);

		let wsUrl: string | null = null;
		for (let i = 0; i < 10; i++) {
			wsUrl = await getChromeWebSocketUrl(cdpUrl, 2000);
			if (wsUrl) break;
			await new Promise((r) => setTimeout(r, 500));
		}

		if (!wsUrl) {
			throw new Error(
				`Failed to connect to Chrome at ${cdpUrl}. Make sure Chrome is running in debug mode`,
			);
		}

		this.browser = (
			await chromium.connectOverCDP(wsUrl, {
				headers: getHeadersWithAuth(wsUrl),
			})
		).contexts()[0]!;

		const pages = this.browser.pages();
		const chatgptPage = pages.find((p) => p.url().includes("chatgpt.com"));

		if (chatgptPage) {
			console.log(`[ChatGPT Web] Found existing ChatGPT page: ${chatgptPage.url()}`);
			this.page = chatgptPage;
		} else {
			console.log(`[ChatGPT Web] No ChatGPT page found, creating new one...`);
			this.page = await this.browser.newPage();
			await this.page.goto("https://chatgpt.com/", { waitUntil: "load" });
		}

		await this.ensureChatGptPageReady();
		console.log(`[ChatGPT Web] Connected to Chrome successfully`);

		const cookieStr = typeof this.cookie === "string" ? this.cookie.trim() : "";
		if (cookieStr && !cookieStr.startsWith("{")) {
			const rawCookies = cookieStr.split(";").map((c) => {
				const [name, ...valueParts] = c.trim().split("=");
				return {
					name: name?.trim() ?? "",
					value: valueParts.join("=").trim(),
					domain: ".chatgpt.com",
					path: "/",
				};
			});
			const cookies = rawCookies.filter((c) => c.name.length > 0);
			if (cookies.length > 0) {
				try {
					await this.browser.addCookies(cookies);
				} catch (err) {
					console.warn(
						`[ChatGPT Web] addCookies failed (page may already have session): ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}
		}

		return { browser: this.browser, page: this.page };
	}

	private async ensureChatGptPageReady() {
		if (!this.page) {
			return;
		}
		if (!this.page.url().includes("chatgpt.com")) {
			await this.page.goto("https://chatgpt.com/", { waitUntil: "load" });
		}
		try {
			await this.page.waitForFunction(
				() => {
					const scripts = Array.from(document.scripts);
					return scripts.some((s) => s.src?.includes("oaistatic.com") && s.src?.endsWith(".js"));
				},
				{ timeout: 15000 },
			);
		} catch {
			console.warn("[ChatGPT Web] oaistatic script not found in 15s, continuing anyway");
		}
		await new Promise((r) => setTimeout(r, 2000));
	}

	private async chatCompletionsViaDOM(params: {
		message: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const { page } = await this.ensureBrowser();

		const inputSelectors = [
			"#prompt-textarea",
			"textarea[placeholder]",
			"textarea",
			'[contenteditable="true"]',
		];
		let inputHandle = null;
		for (const sel of inputSelectors) {
			inputHandle = await page.$(sel);
			if (inputHandle) {
				break;
			}
		}
		if (!inputHandle) {
			throw new Error("ChatGPT DOM simulation failed: input not found");
		}

		await inputHandle.click();
		await page.waitForTimeout(300);
		await page.keyboard.type(params.message, { delay: 20 });
		await page.waitForTimeout(500);
		await page.keyboard.press("Enter");
		console.log("[ChatGPT Web] DOM: typed message and pressed Enter");

		const maxWaitMs = 90000;
		const pollIntervalMs = 2000;
		let lastText = "";
		let stableCount = 0;
		const signal = params.signal;

		for (let elapsed = 0; elapsed < maxWaitMs; elapsed += pollIntervalMs) {
			if (signal?.aborted) {
				throw new Error("ChatGPT request cancelled");
			}

			await new Promise((r) => setTimeout(r, pollIntervalMs));

			const result = await page.evaluate(() => {
				const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
				const els = document.querySelectorAll(
					'div[data-message-author-role="assistant"], .agent-turn [data-message-author-role="assistant"], [class*="markdown"], [class*="assistant"]',
				);
				const last = els.length > 0 ? els[els.length - 1] : null;
				const text = last ? clean(last.textContent ?? "") : "";
				const stopBtn = document.querySelector('button.bg-black .icon-lg, [aria-label*="Stop"]');
				const isStreaming = !!stopBtn;
				return { text, isStreaming };
			});

			if (result.text && result.text !== lastText) {
				lastText = result.text;
				stableCount = 0;
			} else if (result.text) {
				stableCount++;
				if (!result.isStreaming && stableCount >= 2) {
					break;
				}
			}
		}

		if (!lastText) {
			throw new Error(
				"ChatGPT DOM simulation: no assistant reply detected. Ensure chatgpt.com is open, logged in, and the input is visible.",
			);
		}

		const fakeSse = `data: ${JSON.stringify({
			message: { id: "dom-fallback", content: { parts: [lastText] } },
		})}\n\ndata: [DONE]\n\n`;
		const encoder = new TextEncoder();
		return new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(fakeSse));
				controller.close();
			},
		});
	}

	async init(): Promise<void> {
		await this.ensureBrowser();
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const { page } = await this.ensureBrowser();

		const convId = this.conversationId ?? "new";
		const parentMessageId = this.parentMessageId ?? randomUUID();
		const messageId = randomUUID();

		console.log(`[ChatGPT Web] Sending message`);
		console.log(`[ChatGPT Web] Conversation ID: ${convId}`);
		console.log(`[ChatGPT Web] Model: ${params.model || "gpt-4"}`);

		const body = {
			action: "next",
			messages: [
				{
					id: messageId,
					author: { role: "user" },
					content: {
						content_type: "text",
						parts: [params.message],
					},
				},
			],
			parent_message_id: parentMessageId,
			model: params.model || "gpt-4",
			timezone_offset_min: new Date().getTimezoneOffset(),
			conversation_id: convId === "new" ? undefined : convId,
			history_and_training_disabled: false,
			conversation_mode: { kind: "primary_assistant", plugin_ids: null },
			force_paragen: false,
			force_paragen_model_slug: "",
			force_rate_limit: false,
			reset_rate_limits: false,
			force_use_sse: true,
		};

		const pageUrl = page.url();

		const responseData = await page.evaluate(
			async ({ body: reqBody, pageUrl: refUrl }) => {
				const baseHeaders = (accessToken: string | undefined, deviceId: string) => ({
					"Content-Type": "application/json",
					Accept: "text/event-stream",
					"oai-device-id": deviceId,
					"oai-language": "en-US",
					Referer: refUrl || "https://chatgpt.com/",
					"sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
					"sec-ch-ua-mobile": "?0",
					"sec-ch-ua-platform": '"macOS"',
					...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
				});

				async function warmupSentinel(accessToken: string | undefined, deviceId: string) {
					const h = baseHeaders(accessToken, deviceId);
					await fetch("https://chatgpt.com/backend-api/conversation/init", {
						method: "POST",
						headers: h,
						body: "{}",
						credentials: "include",
					}).catch(() => {});
					await fetch("https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare", {
						method: "POST",
						headers: h,
						body: "{}",
						credentials: "include",
					}).catch(() => {});
					await fetch("https://chatgpt.com/backend-api/sentinel/chat-requirements/finalize", {
						method: "POST",
						headers: h,
						body: "{}",
						credentials: "include",
					}).catch(() => {});
				}

				async function getSession() {
					const r = await fetch("https://chatgpt.com/api/auth/session", { credentials: "include" });
					return r.ok ? r.json() : null;
				}

				async function tryFetchWithSentinel(accessToken: string | undefined, deviceId: string) {
					await warmupSentinel(accessToken, deviceId);
					const scripts = Array.from(document.scripts);
					const assetSrc = scripts
						.map((s) => s.src)
						.find((s) => s?.includes("oaistatic.com") && s.endsWith(".js"));
					const assetUrl = assetSrc || "https://cdn.oaistatic.com/assets/i5bamk05qmvsi6c3.js";

					try {
						const g = await import(/* @vite-ignore */ assetUrl);
						if (typeof g.bk !== "function" || typeof g.fX !== "function") {
							return { error: `Sentinel asset missing bk/fX (asset: ${assetUrl})` };
						}
						const z = await g.bk();
						const turnstileKey = z?.turnstile?.bx ?? z?.turnstile?.dx;
						if (!turnstileKey) {
							return { error: "Sentinel chat-requirements missing turnstile" };
						}
						const r = await g.bi(turnstileKey);
						let arkose: unknown = null;
						try {
							arkose = await g.bl?.getEnforcementToken?.(z);
						} catch {
							// Arkose may fail (captcha), continue with null
						}
						let p: unknown = null;
						try {
							p = await g.bm?.getEnforcementToken?.(z);
						} catch {
							// Proof token may fail, continue with null
						}
						const extraHeaders = await g.fX(z, arkose, r, p, null);

						const headers: Record<string, string> = {
							...baseHeaders(accessToken, deviceId),
							...(typeof extraHeaders === "object" ? extraHeaders : {}),
						};

						const res = await fetch("https://chatgpt.com/backend-api/conversation", {
							method: "POST",
							headers,
							body: JSON.stringify(reqBody),
							credentials: "include",
						});
						return { res };
					} catch (e: unknown) {
						const msg = e instanceof Error ? e.message : String(e);
						return { error: `Sentinel token failed: ${msg}` };
					}
				}

				const session = await getSession();
				const accessToken = session?.accessToken as string | undefined;
				const deviceId =
					(session as { oaiDeviceId?: string })?.oaiDeviceId ??
					globalThis.crypto?.randomUUID?.() ??
					Math.random().toString(36).slice(2);

				const sentinelResult = await tryFetchWithSentinel(accessToken, deviceId);
				const res =
					sentinelResult.res ??
					(await fetch("https://chatgpt.com/backend-api/conversation", {
						method: "POST",
						headers: baseHeaders(accessToken, deviceId),
						body: JSON.stringify(reqBody),
						credentials: "include",
					}));

				const sentinelError = "error" in sentinelResult ? sentinelResult.error : undefined;

				if (!res.ok) {
					const errorText = await res.text();
					return { ok: false, status: res.status, error: errorText, sentinelError };
				}

				const reader = res.body?.getReader();
				if (!reader) {
					return { ok: false, status: 500, error: "No response body", sentinelError };
				}

				const decoder = new TextDecoder();
				let fullText = "";
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}
					fullText += decoder.decode(value, { stream: true });
				}
				return { ok: true, data: fullText };
			},
			{ body, pageUrl },
		);

		if (!responseData.ok) {
			if (responseData.status === 403) {
				console.log("[ChatGPT Web] 403 from API, falling back to DOM simulation");
				return this.chatCompletionsViaDOM({
					message: params.message,
					signal: params.signal,
				});
			}
			if (responseData.status === 401) {
				throw new Error("ChatGPT authentication failed. Re-run webauth to refresh the session.");
			}
			const sentinelHint = responseData.sentinelError
				? ` Sentinel: ${responseData.sentinelError}`
				: " If 403 persists, check oaistatic export names in the chatgpt.com console.";
			throw new Error(
				`ChatGPT API error ${responseData.status}: ${responseData.error?.slice(0, 200) || ""}${sentinelHint}`,
			);
		}

		console.log(`[ChatGPT Web] Response length: ${responseData.data?.length || 0} bytes`);

		const encoder = new TextEncoder();
		const data = responseData.data ?? "";
		return new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(data));
				controller.close();
			},
		});
	}

	async parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseChatGPTStream(body, onDelta, (meta) => {
			if (meta.conversationId) {
				this.conversationId = meta.conversationId;
			}
			if (meta.parentMessageId) {
				this.parentMessageId = meta.parentMessageId;
			}
		});
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "gpt-4", name: "GPT-4" },
			{ id: "gpt-4-turbo", name: "GPT-4 Turbo" },
			{ id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
		];
	}

	async close(): Promise<void> {
		this.browser = null;
		this.page = null;
	}
}
