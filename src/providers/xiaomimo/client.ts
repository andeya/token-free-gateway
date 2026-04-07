import type { Page } from "playwright-core";
import { BrowserManager } from "../../browser/manager.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { XiaomiMimoWebAuth } from "./auth.ts";
import { parseXiaomiMimoStream } from "./stream.ts";

const XIAOMIMO_BASE_URL = "https://aistudio.xiaomimimo.com";

export class XiaomiMimoWebClient implements WebProviderClient {
	readonly providerId = "xiaomimo-web";
	private cookie: string;
	private userAgent: string;
	private serviceToken: string;
	private botPh: string;
	private page: Page | null = null;

	constructor(auth: XiaomiMimoWebAuth) {
		this.cookie = auth.cookie;
		this.userAgent =
			auth.userAgent ||
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
		const serviceTokenMatch = this.cookie.match(/serviceToken="([^"]*)"/);
		this.serviceToken = serviceTokenMatch?.[1] || "";
		const botPhMatch = this.cookie.match(/xiaomichatbot_ph="([^"]*)"/);
		this.botPh = botPhMatch?.[1] || "";
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
		this.page = await bm.getPage("xiaomimimo.com", "https://aistudio.xiaomimimo.com");

		const cookieStr = typeof this.cookie === "string" ? this.cookie.trim() : "";
		if (cookieStr && !cookieStr.startsWith("{")) {
			const rawCookies = cookieStr.split(";").map((c) => {
				const [name, ...valueParts] = c.trim().split("=");
				return {
					name: name?.trim() ?? "",
					value: valueParts.join("=").trim(),
					domain: ".xiaomimimo.com",
					path: "/",
				};
			});
			const cookies = rawCookies.filter((c) => c.name.length > 0);
			if (cookies.length > 0) {
				await bm.addCookies(cookies);
			}
		}

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
		if (params.signal?.aborted) {
			throw new Error("XiaomiMimo request cancelled");
		}

		const page = await this.ensurePage();

		let url = `${XIAOMIMO_BASE_URL}/open-apis/bot/chat`;
		if (this.botPh) {
			url += `?xiaomichatbot_ph=${encodeURIComponent(this.botPh)}`;
		}

		const responseData = (await page.evaluate(
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
				cookie: this.cookie,
				userAgent: this.userAgent,
				serviceToken: this.serviceToken,
				botPh: this.botPh,
				baseUrl: XIAOMIMO_BASE_URL,
				bodyJson: JSON.stringify({ message: params.message }),
			},
		)) as { ok: true; data: string } | { ok: false; status: number; error: string };

		if (!responseData.ok) {
			throw new Error(responseData.error);
		}

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
		return parseXiaomiMimoStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [{ id: "xiaomimo-chat", name: "MiMo Chat" }];
	}

	async close(): Promise<void> {
		this.page = null;
	}
}
