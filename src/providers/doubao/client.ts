import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { DoubaoWebAuth } from "./auth.ts";
import { parseDoubaoStream } from "./stream.ts";

export interface DoubaoWebClientConfig {
	aid?: string;
	device_id?: string;
	device_platform?: string;
	fp?: string;
	language?: string;
	pc_version?: string;
	pkg_type?: string;
	real_aid?: string;
	region?: string;
	samantha_web?: string;
	sys_region?: string;
	tea_uuid?: string;
	use_olympus_account?: string;
	version_code?: string;
	web_id?: string;
	web_tab_id?: string;
	msToken?: string;
	a_bogus?: string;
}

interface DoubaoMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

const DOUBAO_API_BASE = "https://www.doubao.com";

export class DoubaoWebClient implements WebProviderClient {
	readonly providerId = "doubao-web";
	private auth: DoubaoWebAuth;
	private config: DoubaoWebClientConfig;

	constructor(auth: DoubaoWebAuth | string, config: DoubaoWebClientConfig = {}) {
		if (typeof auth === "string") {
			try {
				this.auth = JSON.parse(auth) as DoubaoWebAuth;
			} catch {
				this.auth = { sessionid: auth, userAgent: "" };
			}
		} else {
			this.auth = auth;
		}

		const dynamic: Partial<DoubaoWebClientConfig> = {};
		const a = this.auth as DoubaoWebAuth & Record<string, string | undefined>;
		for (const k of [
			"msToken",
			"a_bogus",
			"fp",
			"tea_uuid",
			"device_id",
			"web_tab_id",
			"aid",
			"version_code",
			"pc_version",
			"region",
			"language",
		] as const) {
			if (a[k]) (dynamic as Record<string, string>)[k] = a[k] as string;
		}

		this.config = {
			aid: "497858",
			device_platform: "web",
			language: "zh",
			pkg_type: "release_version",
			real_aid: "497858",
			region: "CN",
			samantha_web: "1",
			sys_region: "CN",
			use_olympus_account: "1",
			version_code: "20800",
			...dynamic,
			...config,
		};
	}

	private getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
			"User-Agent":
				this.auth.userAgent ||
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			Referer: "https://www.doubao.com/chat/",
			Origin: "https://www.doubao.com",
			"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
			"Accept-Encoding": "gzip, deflate, br",
			Connection: "keep-alive",
			"Sec-Fetch-Dest": "empty",
			"Sec-Fetch-Mode": "cors",
			"Sec-Fetch-Site": "same-origin",
			"Agw-js-conv": "str",
		};

		const sessionId = this.auth.sessionid;
		const cookieHeader = this.auth.cookie;
		if (cookieHeader) {
			headers.Cookie = cookieHeader;
		} else {
			const ttwid = this.auth.ttwid ? decodeURIComponent(this.auth.ttwid) : undefined;
			headers.Cookie = ttwid ? `sessionid=${sessionId}; ttwid=${ttwid}` : `sessionid=${sessionId}`;
		}

		return headers;
	}

	private buildQueryParams(): string {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(this.config)) {
			if (value !== undefined && value !== null && key !== "msToken" && key !== "a_bogus") {
				params.append(key, String(value));
			}
		}
		if (this.config.msToken) params.append("msToken", this.config.msToken);
		if (this.config.a_bogus) params.append("a_bogus", this.config.a_bogus);
		return params.toString();
	}

	private mergeMessagesForSamantha(messages: DoubaoMessage[]): string {
		return `${messages
			.map((m) => {
				const role = m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "system";
				return `<|im_start|>${role}\n${m.content}\n`;
			})
			.join("")}<|redacted_im_end|>\n`;
	}

	async init(): Promise<void> {
		try {
			const url = `${DOUBAO_API_BASE}/im/conversation/info?${this.buildQueryParams()}`;
			await fetch(url, { method: "GET", headers: this.getHeaders() });
		} catch {
			// session probe is best-effort
		}
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const queryParams = this.buildQueryParams();
		const url = `${DOUBAO_API_BASE}/samantha/chat/completion?${queryParams}`;
		const text = this.mergeMessagesForSamantha([{ role: "user", content: params.message }]);
		const body = JSON.stringify({
			messages: [
				{
					content: JSON.stringify({ text }),
					content_type: 2001,
					attachments: [],
					references: [],
				},
			],
			completion_option: {
				is_regen: false,
				with_suggest: true,
				need_create_conversation: true,
				launch_stage: 1,
				is_replace: false,
				is_delete: false,
				message_from: 0,
				event_id: "0",
			},
			conversation_id: "0",
			local_conversation_id: `local_16${Date.now().toString().slice(-14)}`,
			local_message_id: crypto.randomUUID(),
		});

		const res = await fetch(url, {
			method: "POST",
			headers: this.getHeaders(),
			body,
			signal: params.signal,
		});

		if (!res.ok) {
			const errText = await res.text().catch(() => "");
			throw new Error(`Doubao API error: ${res.status} ${errText}`);
		}
		if (!res.body) throw new Error("No response body from Doubao API");
		return res.body;
	}

	async parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseDoubaoStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "doubao-seed-2.0", name: "Doubao Seed 2.0 (Web)" },
			{ id: "doubao-pro", name: "Doubao Pro (Web)" },
		];
	}
}
