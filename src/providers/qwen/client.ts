import crypto from "node:crypto";
import type { Page } from "playwright-core";
import { BrowserManager } from "../../browser/manager.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { QwenWebAuth } from "./auth.ts";
import { parseQwenStream } from "./stream.ts";

export class QwenWebClient implements WebProviderClient {
	readonly providerId = "qwen-web";
	private sessionToken: string;
	private cookie: string;
	private userAgent: string;
	private readonly baseUrl = "https://chat.qwen.ai";
	private page: Page | null = null;

	constructor(auth: QwenWebAuth) {
		this.sessionToken = auth.sessionToken;
		this.cookie = auth.cookie || `qwen_session=${auth.sessionToken}`;
		this.userAgent = auth.userAgent || "Mozilla/5.0";
	}

	private async ensurePage(): Promise<Page> {
		if (this.page) {
			try {
				await this.page.evaluate(() => document.readyState);
			} catch {
				this.page = null;
			}
		}

		if (this.page) {
			return this.page;
		}

		const bm = BrowserManager.getInstance();
		this.page = await bm.getPage("qwen.ai", "https://chat.qwen.ai/");

		const cookies = this.cookie.split(";").map((c) => {
			const [name, ...valueParts] = c.trim().split("=");
			return {
				name: name?.trim() ?? "",
				value: valueParts.join("=").trim(),
				domain: ".qwen.ai",
				path: "/",
			};
		});

		await bm.addCookies(cookies);

		return this.page;
	}

	async init(): Promise<void> {
		await this.ensurePage();
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const page = await this.ensurePage();

		const model = params.model || "qwen3.5-plus";

		const createChatTimeoutMs = 30_000;
		const createChatResult = await page.evaluate(
			async ({ baseUrl, timeoutMs }) => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					const url = `${baseUrl}/api/v2/chats/new`;
					const controller = new AbortController();
					timer = setTimeout(() => controller.abort(), timeoutMs);

					const res = await fetch(url, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify({}),
						signal: controller.signal,
					});

					clearTimeout(timer);

					if (!res.ok) {
						const errorText = await res.text();
						return { ok: false, status: res.status, error: errorText };
					}

					const data = await res.json();
					const chatId = data.data?.id ?? data.chat_id ?? data.id ?? data.chatId;
					return { ok: true, chatId, fullData: data };
				} catch (err) {
					if (typeof timer !== "undefined") {
						clearTimeout(timer);
					}
					const msg = String(err);
					if (msg.includes("aborted") || msg.includes("signal")) {
						return { ok: false, status: 408, error: `Create chat timed out after ${timeoutMs}ms` };
					}
					return { ok: false, status: 500, error: msg };
				}
			},
			{ baseUrl: this.baseUrl, timeoutMs: createChatTimeoutMs },
		);

		if (!createChatResult.ok || !createChatResult.chatId) {
			throw new Error(
				`Failed to create Qwen chat: ${createChatResult.error || "No chat_id in response"}`,
			);
		}

		const chatId = createChatResult.chatId;
		const fetchTimeoutMs = 300_000;
		const fid = crypto.randomUUID();
		const responseData = await page.evaluate(
			async ({ baseUrl, chatId, model, message, fid, timeoutMs }) => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					const url = `${baseUrl}/api/v2/chat/completions?chat_id=${chatId}`;

					const controller = new AbortController();
					timer = setTimeout(() => controller.abort(), timeoutMs);
					const requestBody = {
						stream: true,
						version: "2.1",
						incremental_output: true,
						chat_id: chatId,
						chat_mode: "normal",
						model: model,
						parent_id: null,
						messages: [
							{
								fid,
								parentId: null,
								childrenIds: [],
								role: "user",
								content: message,
								user_action: "chat",
								files: [],
								timestamp: Math.floor(Date.now() / 1000),
								models: [model],
								chat_type: "t2t",
								feature_config: { thinking_enabled: true, output_schema: "phase" },
							},
						],
					};

					const res = await fetch(url, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Accept: "text/event-stream",
						},
						body: JSON.stringify(requestBody),
						signal: controller.signal,
					});

					clearTimeout(timer);

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
					if (typeof timer !== "undefined") {
						clearTimeout(timer);
					}
					const msg = String(err);
					if (msg.includes("aborted") || msg.includes("signal")) {
						return {
							ok: false,
							status: 408,
							error: `Qwen API request timed out after ${timeoutMs}ms`,
						};
					}
					return { ok: false, status: 500, error: msg };
				}
			},
			{
				baseUrl: this.baseUrl,
				chatId,
				model: model,
				message: params.message,
				fid,
				timeoutMs: fetchTimeoutMs,
			},
		);

		if (!responseData?.ok) {
			if (responseData?.status === 401 || responseData?.status === 403) {
				throw new Error(
					"Authentication failed. Please re-run onboarding to refresh your Qwen session.",
				);
			}
			if (responseData?.status === 408) {
				throw new Error(
					`Qwen API request timed out. ${responseData?.error || ""} ` +
						"Ensure chat.qwen.ai is reachable, Chrome is connected, and you are logged in.",
				);
			}
			throw new Error(
				`Qwen API error: ${responseData?.status || "unknown"} - ${responseData?.error || "Request failed"}`,
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
		return parseQwenStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "qwen3.5-plus", name: "Qwen 3.5 Plus" },
			{ id: "qwen3.5-turbo", name: "Qwen 3.5 Turbo" },
		];
	}

	async close(): Promise<void> {
		this.page = null;
	}
}
