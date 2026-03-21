import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { XiaomiMimoWebAuth } from "./auth.ts";
import { parseXiaomiMimoStream } from "./stream.ts";

const XIAOMIMO_BASE_URL = "https://aistudio.xiaomimimo.com";

export class XiaomiMimoWebClient implements WebProviderClient {
	readonly providerId = "xiaomimo-web";
	private cookie: string;
	private userAgent: string;

	constructor(auth: XiaomiMimoWebAuth) {
		this.cookie = auth.cookie;
		this.userAgent =
			auth.userAgent ||
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
	}

	private fetchHeaders(): Record<string, string> {
		const serviceTokenMatch = this.cookie.match(/serviceToken="([^"]*)"/);
		const serviceToken = serviceTokenMatch?.[1] || "";

		const botPhMatch = this.cookie.match(/xiaomichatbot_ph="([^"]*)"/);
		const botPh = botPhMatch?.[1] || "";

		return {
			Cookie: this.cookie,
			"User-Agent": this.userAgent,
			"Content-Type": "application/json",
			Accept: "*/*",
			...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
			Referer: `${XIAOMIMO_BASE_URL}/`,
			Origin: XIAOMIMO_BASE_URL,
			"x-timezone": "Asia/Shanghai",
			bot_ph: botPh,
		};
	}

	async init(): Promise<void> {}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const headers = this.fetchHeaders();

		const botPhMatch = this.cookie.match(/xiaomichatbot_ph="([^"]*)"/);
		const botPh = botPhMatch?.[1] || "";

		let url = `${XIAOMIMO_BASE_URL}/open-apis/bot/chat`;
		if (botPh) {
			url += `?xiaomichatbot_ph=${encodeURIComponent(botPh)}`;
		}

		const body = {
			message: params.message,
		};

		const res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: params.signal,
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw new Error(`XiaomiMimo chat completion failed: ${res.status} ${errorText}`);
		}

		if (!res.body) {
			throw new Error("No response body from XiaomiMimo API");
		}

		return res.body;
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
}
