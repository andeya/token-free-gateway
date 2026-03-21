import type { BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { QwenCNWebAuth } from "./auth.ts";
import { parseQwenCnStream } from "./stream.ts";

export class QwenCNWebClient implements WebProviderClient {
	readonly providerId = "qwen-cn-web";
	private cookies: QwenCNWebAuth["cookies"];
	private xsrfToken: string;
	private userAgent: string;
	private deviceId: string;
	private ut: string;
	private readonly baseUrl = "https://chat2.qianwen.com";
	private browser: BrowserContext | null = null;
	private page: Page | null = null;

	constructor(auth: QwenCNWebAuth) {
		this.cookies = auth.cookies;
		this.xsrfToken = auth.xsrfToken || "";
		this.userAgent =
			auth.userAgent ||
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
		this.ut = auth.ut || "";

		if (!this.ut && this.cookies.length > 0) {
			const utC = this.cookies.find((c) => c.name === "b-user-id");
			if (utC) {
				this.ut = utC.value;
			}
		}
		this.deviceId = this.ut || randomId();
	}

	private async ensureBrowser() {
		if (this.browser && this.page) {
			return { browser: this.browser, page: this.page };
		}

		const cdpUrl = getDefaultCdpUrl();
		let wsUrl: string | null = null;
		for (let i = 0; i < 10; i++) {
			wsUrl = await getChromeWebSocketUrl(cdpUrl, 2000);
			if (wsUrl) {
				break;
			}
			await new Promise((r) => setTimeout(r, 500));
		}

		if (!wsUrl) {
			throw new Error(
				`Failed to connect to Chrome at ${cdpUrl}. Make sure Chrome is running in debug mode.`,
			);
		}

		const cdpBrowser = await chromium.connectOverCDP(wsUrl, {
			headers: getHeadersWithAuth(wsUrl),
		});
		const ctx = cdpBrowser.contexts()[0];
		if (!ctx) {
			throw new Error("CDP connection returned no browser context");
		}
		this.browser = ctx;

		const pages = ctx.pages();
		const qwenPage = pages.find((p) => p.url().includes("qianwen.com"));

		if (qwenPage) {
			this.page = qwenPage;
		} else {
			this.page = await ctx.newPage();
			await this.page.goto("https://www.qianwen.com/", { waitUntil: "domcontentloaded" });
		}

		const browserForCookies = this.browser;
		const toAdd = this.cookies.map((c) => ({
			name: c.name,
			value: c.value,
			domain: c.domain || ".qianwen.com",
			path: c.path || "/",
			expires: c.expires,
			httpOnly: c.httpOnly,
			secure: c.secure,
			sameSite: c.sameSite,
		}));

		if (toAdd.length > 0) {
			try {
				await browserForCookies.addCookies(toAdd);
			} catch (err) {
				console.warn(
					`[Qwen CN Web] addCookies failed (page may already have session): ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		return { browser: this.browser, page: this.page };
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

		const model = params.model || "Qwen3.5-Plus";
		const sessionId = randomSessionId();

		const timestamp = Date.now();
		const nonce = Math.random().toString(36).slice(2);

		const responseData = await page.evaluate(
			async ({
				baseUrl,
				sessionId,
				model,
				message,
				parentMessageId,
				ut,
				xsrfToken,
				deviceId,
				nonce,
				timestamp,
			}) => {
				try {
					const url = `${baseUrl}/api/v2/chat?biz_id=ai_qwen&chat_client=h5&device=pc&fr=pc&pr=qwen&nonce=${nonce}&timestamp=${timestamp}&ut=${ut}`;

					const bodyObj: Record<string, unknown> = {
						model: model,
						messages: [
							{
								content: message,
								mime_type: "text/plain",
								meta_data: {
									ori_query: message,
								},
							},
						],
						session_id: sessionId,
						parent_req_id: parentMessageId || "0",
						deep_search: "0",
						req_id: `req-${Math.random().toString(36).slice(2)}`,
						scene: "chat",
						sub_scene: "chat",
						temporary: false,
						from: "default",
						scene_param: parentMessageId ? "continue_chat" : "first_turn",
						chat_client: "h5",
						client_tm: timestamp.toString(),
						protocol_version: "v2",
						biz_id: "ai_qwen",
					};

					const res = await fetch(url, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Accept: "text/event-stream, text/plain, */*",
							Referer: `${baseUrl}/`,
							Origin: baseUrl,
							"x-xsrf-token": xsrfToken,
							"x-deviceid": deviceId,
							"x-platform": "pc_tongyi",
							"x-req-from": "pc_web",
						},
						body: JSON.stringify(bodyObj),
						credentials: "include",
					});

					if (!res.ok) {
						const errorText = await res.text();
						return { ok: false, status: res.status, error: errorText };
					}

					const reader = res.body?.getReader();
					if (!reader) {
						return { ok: false, status: 500, error: "No response body" };
					}

					const decoder = new TextDecoder();
					let fullText = "";

					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}
						const chunk = decoder.decode(value, { stream: true });
						fullText += chunk;
					}

					return { ok: true, data: fullText };
				} catch (err) {
					return { ok: false, status: 500, error: String(err) };
				}
			},
			{
				baseUrl: this.baseUrl,
				sessionId,
				model,
				message: params.message,
				parentMessageId: undefined as string | undefined,
				ut: this.ut,
				xsrfToken: this.xsrfToken,
				deviceId: this.deviceId,
				nonce,
				timestamp,
			},
		);

		if (!responseData?.ok) {
			throw new Error(
				`Qwen CN API error: ${responseData?.status || "unknown"} - ${responseData?.error || "Request failed"}`,
			);
		}

		const encoder = new TextEncoder();
		return new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(responseData.data));
				controller.close();
			},
		});
	}

	async parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseQwenCnStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "Qwen3.5-Plus", name: "Qwen 3.5 Plus (CN)" },
			{ id: "Qwen3.5-Turbo", name: "Qwen 3.5 Turbo (CN)" },
		];
	}

	async close(): Promise<void> {
		this.browser = null;
		this.page = null;
	}
}

function randomSessionId(): string {
	return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function randomId(): string {
	return `random-${Math.random().toString(36).slice(2)}`;
}
