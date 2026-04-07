import type { Page } from "playwright-core";
import { type BrowserCookie, BrowserManager } from "../../browser/manager.ts";
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
	private page: Page | null = null;

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
		this.page = await bm.getPage("doubao.com", "https://www.doubao.com/chat/");

		const cookieHeader = this.auth.cookie;
		if (cookieHeader?.trim() && !cookieHeader.startsWith("{")) {
			const cookies = cookieHeader
				.split(";")
				.map((c) => {
					const [name, ...valueParts] = c.trim().split("=");
					return {
						name: name?.trim() ?? "",
						value: valueParts.join("=").trim(),
						domain: ".doubao.com",
						path: "/",
					};
				})
				.filter((c) => c.name.length > 0);
			await bm.addCookies(cookies);
		} else {
			const sessionId = this.auth.sessionid;
			const ttwid = this.auth.ttwid ? decodeURIComponent(this.auth.ttwid) : undefined;
			const toAdd: BrowserCookie[] = [
				{ name: "sessionid", value: sessionId, domain: ".doubao.com", path: "/" },
			];
			if (ttwid) toAdd.push({ name: "ttwid", value: ttwid, domain: ".doubao.com", path: "/" });
			await bm.addCookies(toAdd);
		}

		return this.page;
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
			const page = await this.ensurePage();
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
			// session probe is best-effort
		}
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const page = await this.ensurePage();
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

		const responseData = (await page.evaluate(
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
				if (!reader) {
					return { ok: false as const, status: 500, error: "No response body from Doubao API" };
				}

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
		return parseDoubaoStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "doubao-seed-2.0", name: "Doubao Seed 2.0 (Web)" },
			{ id: "doubao-pro", name: "Doubao Pro (Web)" },
		];
	}

	async close(): Promise<void> {
		this.page = null;
	}
}
