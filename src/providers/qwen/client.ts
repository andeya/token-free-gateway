import crypto from "node:crypto";
import type { Page } from "playwright-core";
import { BaseApiClient } from "../factory/base-api-client.ts";
import type { ApiClientConfig, NormalizedSendParams } from "../factory/types.ts";
import { parseCookieHeader } from "../shared/cookie-parser.ts";
import type { EvalResult } from "../shared/eval-helpers.ts";
import type { StreamResult } from "../types.ts";
import type { QwenWebAuth } from "./auth.ts";
import { parseQwenStream } from "./stream.ts";

export class QwenWebClient extends BaseApiClient<QwenWebAuth> {
	readonly providerId = "qwen-web";

	protected readonly config: ApiClientConfig = {
		hostKey: "qwen.ai",
		startUrl: "https://chat.qwen.ai/",
		cookieDomain: ".qwen.ai",
		defaultModel: "qwen3.5-plus",
		models: [
			{ id: "qwen3.5-plus", name: "Qwen 3.5 Plus" },
			{ id: "qwen3.5-turbo", name: "Qwen 3.5 Turbo" },
		],
	};

	private readonly baseUrl = "https://chat.qwen.ai";

	protected getCookies() {
		return parseCookieHeader(
			this.auth.cookie || `qwen_session=${this.auth.sessionToken}`,
			this.config.cookieDomain,
		);
	}

	protected async callApi(page: Page, params: NormalizedSendParams): Promise<EvalResult> {
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
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({}),
						signal: controller.signal,
					});
					clearTimeout(timer);
					if (!res.ok) {
						const errorText = await res.text();
						return { ok: false as const, status: res.status, error: errorText };
					}
					const data = await res.json();
					const chatId = data.data?.id ?? data.chat_id ?? data.id ?? data.chatId;
					return { ok: true as const, chatId };
				} catch (err) {
					if (typeof timer !== "undefined") clearTimeout(timer);
					const msg = String(err);
					if (msg.includes("aborted") || msg.includes("signal")) {
						return {
							ok: false as const,
							status: 408,
							error: `Create chat timed out after ${timeoutMs}ms`,
						};
					}
					return { ok: false as const, status: 500, error: msg };
				}
			},
			{ baseUrl: this.baseUrl, timeoutMs: createChatTimeoutMs },
		);

		if (!createChatResult.ok || !createChatResult.chatId) {
			return {
				ok: false,
				status: (createChatResult as { status?: number }).status ?? 500,
				error: (createChatResult as { error?: string }).error || "No chat_id in response",
			};
		}

		const chatId = createChatResult.chatId as string;
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
						model,
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
						headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
						body: JSON.stringify(requestBody),
						signal: controller.signal,
					});
					clearTimeout(timer);
					if (!res.ok) {
						const errorText = await res.text();
						return { ok: false as const, status: res.status, error: errorText };
					}
					const reader = res.body?.getReader();
					if (!reader) return { ok: false as const, status: 500, error: "No response body" };
					const decoder = new TextDecoder();
					let fullText = "";
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						fullText += decoder.decode(value, { stream: true });
					}
					return { ok: true as const, data: fullText };
				} catch (err) {
					if (typeof timer !== "undefined") clearTimeout(timer);
					const msg = String(err);
					if (msg.includes("aborted") || msg.includes("signal")) {
						return {
							ok: false as const,
							status: 408,
							error: `Qwen API request timed out after ${timeoutMs}ms`,
						};
					}
					return { ok: false as const, status: 500, error: msg };
				}
			},
			{
				baseUrl: this.baseUrl,
				chatId,
				model: params.model,
				message: params.message,
				fid,
				timeoutMs: fetchTimeoutMs,
			},
		);

		return responseData as EvalResult;
	}

	protected parseStreamImpl(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseQwenStream(body, onDelta);
	}
}
