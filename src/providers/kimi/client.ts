import type { BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { KimiWebAuth } from "./auth.ts";
import { parseKimiStream } from "./stream.ts";

export class KimiWebClient implements WebProviderClient {
	readonly providerId = "kimi-web";
	private cookie: string;
	private accessToken: string;
	private baseUrl = "https://www.kimi.com";
	private browser: BrowserContext | null = null;
	private page: Page | null = null;

	constructor(auth: KimiWebAuth) {
		this.cookie = auth.cookie || "";
		this.accessToken = auth.accessToken || "";
	}

	private async ensureBrowser(): Promise<{ browser: BrowserContext; page: Page }> {
		if (this.browser && this.page) {
			return { browser: this.browser, page: this.page };
		}

		const cdpUrl = getDefaultCdpUrl();
		let wsUrl: string | null = null;
		for (let i = 0; i < 10; i++) {
			wsUrl = await getChromeWebSocketUrl(cdpUrl, 2000);
			if (wsUrl) break;
			await new Promise((r) => setTimeout(r, 500));
		}
		if (!wsUrl) {
			throw new Error(
				`Failed to connect to Chrome at ${cdpUrl}. Make sure Chrome is running in debug mode (./start-chrome-debug.sh)`,
			);
		}

		this.browser = (
			await chromium.connectOverCDP(wsUrl, { headers: getHeadersWithAuth(wsUrl) })
		).contexts()[0]!;
		if (!this.browser) throw new Error("No browser context");

		const pages = this.browser.pages();
		const kimiPage = pages.find(
			(p) => p.url().includes("kimi.com") || p.url().includes("moonshot.cn"),
		);
		if (kimiPage) {
			this.page = kimiPage;
		} else {
			this.page = await this.browser.newPage();
			await this.page.goto(`${this.baseUrl}/`, { waitUntil: "domcontentloaded" });
		}

		if (this.cookie.trim()) {
			const pageUrl = this.page?.url() ?? this.baseUrl;
			const domain = pageUrl.includes("moonshot.cn") ? ".moonshot.cn" : ".kimi.com";

			const rawCookies = this.cookie.split(";").map((c) => {
				const [name, ...valueParts] = c.trim().split("=");
				const nameStr = name?.trim() ?? "";
				const valueStr = valueParts.join("=").trim();
				if (!nameStr) {
					return null;
				}
				const cookie: {
					name: string;
					value: string;
					domain: string;
					path: string;
					secure?: boolean;
				} = {
					name: nameStr,
					value: valueStr,
					domain,
					path: "/",
				};
				if (nameStr.startsWith("__Secure-") || nameStr.startsWith("__Host-")) {
					cookie.secure = true;
				}
				return cookie;
			});
			const cookies = rawCookies.filter((c): c is NonNullable<typeof c> => c !== null);
			if (cookies.length > 0) {
				try {
					await this.browser.addCookies(cookies);
				} catch (err) {
					console.warn(
						`[KimiWeb] addCookies failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}
		}

		return { browser: this.browser, page: this.page! };
	}

	async init(): Promise<void> {
		await this.ensureBrowser();
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const { browser, page } = await this.ensureBrowser();

		const cookies = await browser.cookies([this.baseUrl]);
		const kimiAuthCookie = cookies.find((c) => c.name === "kimi-auth")?.value;
		const authToken = this.accessToken || kimiAuthCookie;
		if (!authToken) {
			throw new Error(
				"Kimi: no credentials (accessToken or kimi-auth cookie). Run webauth to refresh login.",
			);
		}

		const model = params.model || "moonshot-v1-32k";
		const result = await page.evaluate(
			async ({
				baseUrl,
				message,
				kimiAuthToken,
				scenario,
			}: {
				baseUrl: string;
				message: string;
				kimiAuthToken: string;
				scenario: string;
			}) => {
				const req = {
					scenario,
					message: {
						role: "user" as const,
						blocks: [{ message_id: "", text: { content: message } }],
						scenario,
					},
					options: { thinking: false },
				};
				const enc = new TextEncoder().encode(JSON.stringify(req));
				const buf = new ArrayBuffer(5 + enc.byteLength);
				const dv = new DataView(buf);
				dv.setUint8(0, 0x00);
				dv.setUint32(1, enc.byteLength, false);
				new Uint8Array(buf, 5).set(enc);

				const res = await fetch(`${baseUrl}/apiv2/kimi.gateway.chat.v1.ChatService/Chat`, {
					method: "POST",
					headers: {
						"Content-Type": "application/connect+json",
						"Connect-Protocol-Version": "1",
						Accept: "*/*",
						Origin: baseUrl,
						Referer: `${baseUrl}/`,
						"X-Language": "zh-CN",
						"X-Msh-Platform": "web",
						Authorization: `Bearer ${kimiAuthToken}`,
					},
					body: buf,
				});

				if (!res.ok) {
					const text = await res.text();
					return { ok: false as const, error: text.slice(0, 400) };
				}
				const arr = await res.arrayBuffer();
				const u8 = new Uint8Array(arr);
				const texts: string[] = [];
				let o = 0;
				while (o + 5 <= u8.length) {
					const len = new DataView(u8.buffer, u8.byteOffset + o + 1, 4).getUint32(0, false);
					if (o + 5 + len > u8.length) {
						break;
					}
					const chunk = u8.slice(o + 5, o + 5 + len);
					try {
						const obj = JSON.parse(new TextDecoder().decode(chunk));
						if (obj.error) {
							return {
								ok: false as const,
								error:
									obj.error.message || obj.error.code || JSON.stringify(obj.error).slice(0, 200),
							};
						}
						const op = obj.op || "";
						if (obj.block?.text?.content && (op === "append" || op === "set")) {
							texts.push(obj.block.text.content);
						} else if (obj.text?.content && (op === "append" || op === "set")) {
							texts.push(obj.text.content);
						}
						if (!op && obj.message?.role === "assistant" && obj.message?.blocks) {
							for (const blk of obj.message.blocks) {
								if (blk.text?.content) {
									texts.push(blk.text.content);
								}
							}
						}
						if (obj.done) {
							break;
						}
					} catch {
						// ignore
					}
					o += 5 + len;
				}
				return { ok: true as const, text: texts.join("") };
			},
			{
				baseUrl: this.baseUrl,
				message: params.message,
				kimiAuthToken: authToken,
				scenario: model.includes("search")
					? "SCENARIO_SEARCH"
					: model.includes("research")
						? "SCENARIO_RESEARCH"
						: model.includes("k1")
							? "SCENARIO_K1"
							: "SCENARIO_K2",
			},
		);

		if (!result.ok) {
			throw new Error(`Kimi API error: ${result.error}`);
		}

		const escaped = JSON.stringify(result.text);
		const sse = `data: {"text":${escaped}}\n\ndata: [DONE]\n\n`;
		const encoder = new TextEncoder();
		return new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sse));
				controller.close();
			},
		});
	}

	async parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseKimiStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "moonshot-v1-8k", name: "Moonshot v1 8K" },
			{ id: "moonshot-v1-32k", name: "Moonshot v1 32K" },
			{ id: "moonshot-v1-128k", name: "Moonshot v1 128K" },
		];
	}

	async close(): Promise<void> {
		this.browser = null;
		this.page = null;
	}
}
