import crypto from "node:crypto";
import type { Page } from "playwright-core";
import { BaseApiClient } from "../factory/base-api-client.ts";
import type { ApiClientConfig, NormalizedSendParams } from "../factory/types.ts";
import { parseCookieHeader } from "../shared/cookie-parser.ts";
import type { EvalResult } from "../shared/eval-helpers.ts";
import { withEvalTimeout } from "../shared/eval-helpers.ts";
import type { StreamResult } from "../types.ts";
import type { GlmWebAuth } from "./auth.ts";
import { parseGlmStream } from "./stream.ts";

const ASSISTANT_ID_MAP: Record<string, string> = {
	"glm-4-plus": "65940acff94777010aa6b796",
	"glm-4": "65940acff94777010aa6b796",
	"glm-4-think": "676411c38945bbc58a905d31",
	"glm-4-zero": "676411c38945bbc58a905d31",
};
const DEFAULT_ASSISTANT_ID = "65940acff94777010aa6b796";
const SIGN_SECRET = "8a1317a7468aa3ad86e997d08f3f31cb";

const X_EXP_GROUPS =
	"na_android_config:exp:NA,na_4o_config:exp:4o_A,tts_config:exp:tts_config_a," +
	"na_glm4plus_config:exp:open,mainchat_server_app:exp:A,mobile_history_daycheck:exp:a," +
	"desktop_toolbar:exp:A,chat_drawing_server:exp:A,drawing_server_cogview:exp:cogview4," +
	"app_welcome_v2:exp:A,chat_drawing_streamv2:exp:A,mainchat_rm_fc:exp:add," +
	"mainchat_dr:exp:open,chat_auto_entrance:exp:A,drawing_server_hi_dream:control:A," +
	"homepage_square:exp:close,assistant_recommend_prompt:exp:3,app_home_regular_user:exp:A," +
	"memory_common:exp:enable,mainchat_moe:exp:300,assistant_greet_user:exp:greet_user," +
	"app_welcome_personalize:exp:A,assistant_model_exp_group:exp:glm4.5," +
	"ai_wallet:exp:ai_wallet_enable";

function generateSign(): { timestamp: string; nonce: string; sign: string } {
	const e = Date.now();
	const A = e.toString();
	const t = A.length;
	const o = A.split("").map((c) => Number(c));
	const i = o.reduce((acc, v) => acc + v, 0) - (o[t - 2] ?? 0);
	const a = i % 10;
	const timestamp = A.substring(0, t - 2) + a + A.substring(t - 1, t);
	const nonce = crypto.randomUUID().replace(/-/g, "");
	const sign = crypto
		.createHash("md5")
		.update(`${timestamp}-${nonce}-${SIGN_SECRET}`)
		.digest("hex");
	return { timestamp, nonce, sign };
}

export class GlmWebClient extends BaseApiClient<GlmWebAuth> {
	readonly providerId = "glm-web";

	protected readonly config: ApiClientConfig = {
		hostKey: "chatglm.cn",
		startUrl: "https://chatglm.cn",
		cookieDomain: ".chatglm.cn",
		defaultModel: "glm-4-plus",
		models: [{ id: "glm-4-plus", name: "GLM-4 Plus" }],
	};

	private accessToken: string | null = null;
	private deviceId = crypto.randomUUID().replace(/-/g, "");

	protected getCookies() {
		return parseCookieHeader(this.auth.cookie, this.config.cookieDomain);
	}

	private getRefreshToken(): string | null {
		return this.getCookies().find((c) => c.name === "chatglm_refresh_token")?.value ?? null;
	}

	private getAccessTokenFromCookie(): string | null {
		return this.getCookies().find((c) => c.name === "chatglm_token")?.value ?? null;
	}

	protected override async onInit(): Promise<void> {
		await this.refreshAccessToken();
	}

	private async refreshAccessToken(): Promise<void> {
		const cookieToken = this.getAccessTokenFromCookie();
		if (cookieToken) {
			this.accessToken = cookieToken;
			return;
		}
		const refreshToken = this.getRefreshToken();
		if (!refreshToken || !this.page) return;
		const sign = generateSign();
		const requestId = crypto.randomUUID().replace(/-/g, "");
		const result = await this.page.evaluate(
			async ({ refreshToken, deviceId, requestId, sign }) => {
				try {
					const res = await fetch("https://chatglm.cn/chatglm/user-api/user/refresh", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${refreshToken}`,
							"App-Name": "chatglm",
							"X-App-Platform": "pc",
							"X-App-Version": "0.0.1",
							"X-Device-Id": deviceId,
							"X-Request-Id": requestId,
							"X-Sign": sign.sign,
							"X-Nonce": sign.nonce,
							"X-Timestamp": sign.timestamp,
						},
						credentials: "include",
						body: JSON.stringify({}),
					});
					if (!res.ok) return { ok: false, status: res.status, error: await res.text() };
					const data = (await res.json()) as {
						result?: { access_token?: string; accessToken?: string };
						accessToken?: string;
					};
					const accessToken =
						data.result?.access_token ?? data.result?.accessToken ?? data.accessToken;
					if (!accessToken)
						return {
							ok: false,
							status: 200,
							error: `No accessToken in response: ${JSON.stringify(data).substring(0, 300)}`,
						};
					return { ok: true, accessToken };
				} catch (err) {
					return { ok: false, status: 500, error: String(err) };
				}
			},
			{ refreshToken, deviceId: this.deviceId, requestId, sign },
		);
		if (result.ok && result.accessToken) {
			this.accessToken = result.accessToken;
		} else {
			console.warn(`[GlmWeb] Failed to refresh access token: ${result.error}`);
		}
	}

	protected async callApi(page: Page, params: NormalizedSendParams): Promise<EvalResult> {
		if (!this.accessToken) await this.refreshAccessToken();
		const assistantId = ASSISTANT_ID_MAP[params.model] ?? DEFAULT_ASSISTANT_ID;
		const fetchTimeoutMs = 120_000;
		const sign = generateSign();
		const requestId = crypto.randomUUID().replace(/-/g, "");
		const body = {
			assistant_id: assistantId,
			conversation_id: "",
			project_id: "",
			chat_type: "user_chat",
			meta_data: {
				cogview: { rm_label_watermark: false },
				is_test: false,
				input_question_type: "xxxx",
				channel: "",
				draft_id: "",
				chat_mode: "zero",
				is_networking: false,
				quote_log_id: "",
				platform: "pc",
			},
			messages: [{ role: "user", content: [{ type: "text", text: params.message }] }],
		};
		const evalPromise = page.evaluate(
			async ({ accessToken, bodyStr, deviceId, requestId, timeoutMs, sign, xExpGroups }) => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					const controller = new AbortController();
					timer = setTimeout(() => controller.abort(), timeoutMs);
					const headers: Record<string, string> = {
						"Content-Type": "application/json",
						Accept: "text/event-stream",
						"App-Name": "chatglm",
						Origin: "https://chatglm.cn",
						"X-App-Platform": "pc",
						"X-App-Version": "0.0.1",
						"X-App-fr": "default",
						"X-Device-Brand": "",
						"X-Device-Id": deviceId,
						"X-Device-Model": "",
						"X-Exp-Groups": xExpGroups,
						"X-Lang": "zh",
						"X-Nonce": sign.nonce,
						"X-Request-Id": requestId,
						"X-Sign": sign.sign,
						"X-Timestamp": sign.timestamp,
					};
					if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
					const res = await fetch("https://chatglm.cn/chatglm/backend-api/assistant/stream", {
						method: "POST",
						headers,
						credentials: "include",
						body: bodyStr,
						signal: controller.signal,
					});
					clearTimeout(timer);
					if (!res.ok) {
						const errorText = await res.text();
						return { ok: false, status: res.status, error: errorText.substring(0, 500) };
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
					if (timer) clearTimeout(timer);
					const msg = String(err);
					if (msg.includes("aborted") || msg.includes("signal"))
						return {
							ok: false,
							status: 408,
							error: `ChatGLM API request timed out after ${timeoutMs}ms`,
						};
					return { ok: false, status: 500, error: msg };
				}
			},
			{
				accessToken: this.accessToken,
				bodyStr: JSON.stringify(body),
				deviceId: this.deviceId,
				requestId,
				timeoutMs: fetchTimeoutMs,
				sign,
				xExpGroups: X_EXP_GROUPS,
			},
		);
		const responseData = await withEvalTimeout(evalPromise, fetchTimeoutMs + 10_000, "GLM");
		if (!responseData?.ok && responseData?.status === 401) {
			await this.refreshAccessToken();
		}
		return responseData as EvalResult;
	}

	protected parseStreamImpl(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseGlmStream(body, onDelta);
	}

	override async close(): Promise<void> {
		this.page = null;
		this.accessToken = null;
	}
}
