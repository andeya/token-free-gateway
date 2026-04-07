import type { Page } from "playwright-core";
import { type BrowserCookie, BrowserManager } from "../../browser/manager.ts";
import { BaseApiClient } from "../factory/base-api-client.ts";
import type { ApiClientConfig, NormalizedSendParams } from "../factory/types.ts";
import { parseCookieHeader } from "../shared/cookie-parser.ts";
import type { EvalResult } from "../shared/eval-helpers.ts";
import type { StreamResult } from "../types.ts";
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

export class DoubaoWebClient extends BaseApiClient<DoubaoWebAuth> {
	readonly providerId = "doubao-web";

	protected readonly config: ApiClientConfig = {
		hostKey: "doubao.com",
		startUrl: "https://www.doubao.com/chat/",
		cookieDomain: ".doubao.com",
		defaultModel: "doubao-seed-2.0",
		models: [
			{ id: "doubao-seed-2.0", name: "Doubao Seed 2.0 (Web)" },
			{ id: "doubao-pro", name: "Doubao Pro (Web)" },
		],
	};

	private doubaoConfig: DoubaoWebClientConfig;

	constructor(auth: DoubaoWebAuth | string, extraConfig: DoubaoWebClientConfig = {}) {
		const parsed: DoubaoWebAuth =
			typeof auth === "string"
				? (() => {
						try {
							return JSON.parse(auth);
						} catch {
							return { sessionid: auth, userAgent: "" };
						}
					})()
				: auth;
		super(parsed);

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
		this.doubaoConfig = {
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
			...extraConfig,
		};
	}

	protected getCookies(): BrowserCookie[] {
		return [];
	}

	/** Custom page bootstrapping: Doubao uses either a cookie header string OR sessionid/ttwid objects. */
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

		const cookieHeader = this.auth.cookie;
		if (cookieHeader?.trim() && !cookieHeader.startsWith("{")) {
			await bm.addCookies(parseCookieHeader(cookieHeader, this.config.cookieDomain));
		} else {
			const toAdd: BrowserCookie[] = [
				{
					name: "sessionid",
					value: this.auth.sessionid,
					domain: this.config.cookieDomain,
					path: "/",
				},
			];
			if (this.auth.ttwid) {
				toAdd.push({
					name: "ttwid",
					value: decodeURIComponent(this.auth.ttwid),
					domain: this.config.cookieDomain,
					path: "/",
				});
			}
			await bm.addCookies(toAdd);
		}
		return this.page;
	}

	protected override async onInit(): Promise<void> {
		try {
			const page = await this.getPage();
			const queryParams = this.buildQueryParams();
			const probeUrl = `${DOUBAO_API_BASE}/im/conversation/info?${queryParams}`;
			await page.evaluate(
				async ({ url }: { url: string }) => {
					await fetch(url, {
						method: "GET",
						headers: {
							Accept: "application/json",
							Referer: "https://www.doubao.com/chat/",
							Origin: "https://www.doubao.com",
							"Agw-js-conv": "str",
						},
						credentials: "include",
					});
				},
				{ url: probeUrl },
			);
		} catch {
			/* session probe is best-effort */
		}
	}

	protected async callApi(page: Page, params: NormalizedSendParams): Promise<EvalResult> {
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

		return (await page.evaluate(
			async ({ postUrl, bodyJson }: { postUrl: string; bodyJson: string }) => {
				const res = await fetch(postUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "text/event-stream",
						Referer: "https://www.doubao.com/chat/",
						Origin: "https://www.doubao.com",
						"Agw-js-conv": "str",
					},
					body: bodyJson,
					credentials: "include",
				});
				if (!res.ok) {
					const errText = await res.text().catch(() => "");
					return {
						ok: false as const,
						status: res.status,
						error: `Doubao API error: ${res.status} ${errText.slice(0, 500)}`,
					};
				}
				const reader = res.body?.getReader();
				if (!reader)
					return { ok: false as const, status: 500, error: "No response body from Doubao API" };
				const decoder = new TextDecoder();
				let fullText = "";
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					fullText += decoder.decode(value, { stream: true });
				}
				return { ok: true as const, data: fullText };
			},
			{ postUrl: url, bodyJson: body },
		)) as EvalResult;
	}

	protected parseStreamImpl(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseDoubaoStream(body, onDelta);
	}

	private buildQueryParams(): string {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(this.doubaoConfig)) {
			if (value !== undefined && value !== null && key !== "msToken" && key !== "a_bogus") {
				params.append(key, String(value));
			}
		}
		if (this.doubaoConfig.msToken) params.append("msToken", this.doubaoConfig.msToken);
		if (this.doubaoConfig.a_bogus) params.append("a_bogus", this.doubaoConfig.a_bogus);
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
}
