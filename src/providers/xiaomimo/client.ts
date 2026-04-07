import type { Page } from "playwright-core";
import { BaseApiClient } from "../factory/base-api-client.ts";
import type { ApiClientConfig, NormalizedSendParams } from "../factory/types.ts";
import { parseCookieHeader } from "../shared/cookie-parser.ts";
import type { EvalResult } from "../shared/eval-helpers.ts";
import type { StreamResult } from "../types.ts";
import type { XiaomiMimoWebAuth } from "./auth.ts";
import { parseXiaomiMimoStream } from "./stream.ts";

const XIAOMIMO_BASE_URL = "https://aistudio.xiaomimimo.com";

function randomHex32(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class XiaomiMimoWebClient extends BaseApiClient<XiaomiMimoWebAuth> {
	readonly providerId = "xiaomimo-web";

	protected readonly config: ApiClientConfig = {
		hostKey: "xiaomimimo.com",
		startUrl: "https://aistudio.xiaomimimo.com",
		cookieDomain: ".xiaomimimo.com",
		defaultModel: "xiaomimo-chat",
		models: [{ id: "xiaomimo-chat", name: "MiMo Chat" }],
	};

	private serviceToken: string;
	private botPh: string;

	constructor(auth: XiaomiMimoWebAuth) {
		super(auth);
		const serviceTokenMatch = auth.cookie.match(/serviceToken="?([^;"\s]+)/);
		this.serviceToken = serviceTokenMatch?.[1] || "";
		const botPhMatch = auth.cookie.match(/xiaomichatbot_ph="?([^;"\s]+)/);
		this.botPh = botPhMatch?.[1] || "";
	}

	protected getCookies() {
		return parseCookieHeader(this.auth.cookie, this.config.cookieDomain);
	}

	protected async callApi(page: Page, params: NormalizedSendParams): Promise<EvalResult> {
		let url = `${XIAOMIMO_BASE_URL}/open-apis/bot/chat`;
		if (this.botPh) {
			url += `?xiaomichatbot_ph=${encodeURIComponent(this.botPh)}`;
		}

		const requestBody = {
			msgId: randomHex32(),
			conversationId: randomHex32(),
			query: params.message,
			modelConfig: {
				enableThinking: false,
				temperature: 0.8,
				topP: 0.95,
				webSearchStatus: "disabled",
				model: "mimo-v2-flash-studio",
			},
			multiMedias: [],
		};

		return (await page.evaluate(
			async (args: {
				requestUrl: string;
				cookie: string;
				userAgent: string;
				serviceToken: string;
				botPh: string;
				baseUrl: string;
				bodyJson: string;
			}) => {
				const { requestUrl, cookie, userAgent, serviceToken, botPh, baseUrl, bodyJson } = args;
				const headers: Record<string, string> = {
					Cookie: cookie,
					"User-Agent": userAgent,
					"Content-Type": "application/json",
					Accept: "*/*",
					...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
					Referer: `${baseUrl}/`,
					Origin: baseUrl,
					"x-timezone": "Asia/Shanghai",
					bot_ph: botPh,
				};
				const res = await fetch(requestUrl, {
					method: "POST",
					headers,
					body: bodyJson,
					credentials: "include",
				});
				const text = await res.text();
				if (!res.ok) {
					return {
						ok: false as const,
						status: res.status,
						error: `XiaomiMimo chat completion failed: ${res.status} ${text}`,
					};
				}
				return { ok: true as const, data: text };
			},
			{
				requestUrl: url,
				cookie: this.auth.cookie,
				userAgent: this.auth.userAgent || "Mozilla/5.0",
				serviceToken: this.serviceToken,
				botPh: this.botPh,
				baseUrl: XIAOMIMO_BASE_URL,
				bodyJson: JSON.stringify(requestBody),
			},
		)) as EvalResult;
	}

	protected parseStreamImpl(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseXiaomiMimoStream(body, onDelta);
	}
}
