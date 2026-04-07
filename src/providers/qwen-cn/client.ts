import type { Page } from "playwright-core";
import { type BrowserCookie, BrowserManager } from "../../browser/manager.ts";
import { BaseApiClient } from "../factory/base-api-client.ts";
import type { ApiClientConfig, NormalizedSendParams } from "../factory/types.ts";
import type { EvalResult } from "../shared/eval-helpers.ts";
import type { StreamResult } from "../types.ts";
import type { QwenCNWebAuth } from "./auth.ts";
import { parseQwenCnStream } from "./stream.ts";

function randomSessionId(): string {
	return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function randomId(): string {
	return `random-${Math.random().toString(36).slice(2)}`;
}

export class QwenCNWebClient extends BaseApiClient<QwenCNWebAuth> {
	readonly providerId = "qwen-cn-web";

	protected readonly config: ApiClientConfig = {
		hostKey: "qianwen.com",
		startUrl: "https://www.qianwen.com/",
		cookieDomain: ".qianwen.com",
		defaultModel: "Qwen3.5-Plus",
		models: [
			{ id: "Qwen3.5-Plus", name: "Qwen 3.5 Plus (CN)" },
			{ id: "Qwen3.5-Turbo", name: "Qwen 3.5 Turbo (CN)" },
		],
	};

	private readonly baseUrl = "https://chat2.qianwen.com";
	private xsrfToken: string;
	private deviceId: string;
	private ut: string;

	constructor(auth: QwenCNWebAuth) {
		super(auth);
		this.xsrfToken = auth.xsrfToken || "";
		this.ut = auth.ut || "";
		if (!this.ut && auth.cookies.length > 0) {
			const utC = auth.cookies.find((c) => c.name === "b-user-id");
			if (utC) this.ut = utC.value;
		}
		this.deviceId = this.ut || randomId();
	}

	protected getCookies(): BrowserCookie[] {
		return [];
	}

	/** Custom page bootstrapping with structured cookie objects. */
	protected override async getPage(): Promise<Page> {
		if (this.page) {
			try {
				await this.page.evaluate(() => document.readyState);
				return this.page;
			} catch {
				this.page = null;
			}
		}
		const bm = BrowserManager.getInstance();
		this.page = await bm.getPage(this.config.hostKey, this.config.startUrl);
		const toAdd = this.auth.cookies.map((c) => ({
			name: c.name,
			value: c.value,
			domain: c.domain || this.config.cookieDomain,
			path: c.path || "/",
			expires: c.expires,
			httpOnly: c.httpOnly,
			secure: c.secure,
			sameSite: c.sameSite,
		}));
		if (toAdd.length > 0) await bm.addCookies(toAdd as BrowserCookie[]);
		return this.page;
	}

	protected async callApi(page: Page, params: NormalizedSendParams): Promise<EvalResult> {
		const sessionId = randomSessionId();
		const timestamp = Date.now();
		const nonce = Math.random().toString(36).slice(2);
		return (await page.evaluate(
			async ({ baseUrl, sessionId, model, message, ut, xsrfToken, deviceId, nonce, timestamp }) => {
				try {
					const url = `${baseUrl}/api/v2/chat?biz_id=ai_qwen&chat_client=h5&device=pc&fr=pc&pr=qwen&nonce=${nonce}&timestamp=${timestamp}&ut=${ut}`;
					const bodyObj: Record<string, unknown> = {
						model,
						session_id: sessionId,
						parent_req_id: "0",
						deep_search: "0",
						req_id: `req-${Math.random().toString(36).slice(2)}`,
						scene: "chat",
						sub_scene: "chat",
						temporary: false,
						from: "default",
						scene_param: "first_turn",
						chat_client: "h5",
						client_tm: timestamp.toString(),
						protocol_version: "v2",
						biz_id: "ai_qwen",
						messages: [
							{ content: message, mime_type: "text/plain", meta_data: { ori_query: message } },
						],
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
					if (!reader) return { ok: false, status: 500, error: "No response body" };
					const decoder = new TextDecoder();
					let fullText = "";
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						fullText += decoder.decode(value, { stream: true });
					}
					return { ok: true, data: fullText };
				} catch (err) {
					return { ok: false, status: 500, error: String(err) };
				}
			},
			{
				baseUrl: this.baseUrl,
				sessionId,
				model: params.model,
				message: params.message,
				ut: this.ut,
				xsrfToken: this.xsrfToken,
				deviceId: this.deviceId,
				nonce,
				timestamp,
			},
		)) as EvalResult;
	}

	protected parseStreamImpl(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseQwenCnStream(body, onDelta);
	}
}
