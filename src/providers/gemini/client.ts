import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { GeminiWebAuth } from "./auth.ts";
import { parseGeminiStream } from "./stream.ts";

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

export class GeminiWebClient implements WebProviderClient {
	readonly providerId = "gemini-web";
	private options: GeminiWebAuth;
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private initialized = false;

	constructor(options: GeminiWebAuth) {
		this.options = options;
	}

	private parseCookies(): Array<{ name: string; value: string; domain: string; path: string }> {
		return this.options.cookie
			.split(";")
			.filter((c) => c.trim().includes("="))
			.map((cookie) => {
				const [name, ...valueParts] = cookie.trim().split("=");
				return {
					name: name?.trim() ?? "",
					value: valueParts.join("=").trim(),
					domain: ".google.com",
					path: "/",
				};
			})
			.filter((c) => c.name.length > 0);
	}

	async init(): Promise<void> {
		if (this.initialized) return;

		const cdpUrl = getDefaultCdpUrl();
		let wsUrl: string | null = null;
		for (let i = 0; i < 10; i++) {
			wsUrl = await getChromeWebSocketUrl(cdpUrl, 2000);
			if (wsUrl) break;
			await delay(500);
		}
		if (!wsUrl) {
			throw new Error(
				`Failed to connect to Chrome at ${cdpUrl}. Make sure Chrome is running in debug mode.`,
			);
		}

		const connectedBrowser = await chromium.connectOverCDP(wsUrl, {
			headers: getHeadersWithAuth(wsUrl),
		});
		this.browser = connectedBrowser;
		this.context = connectedBrowser.contexts()[0] ?? null;
		if (!this.context) throw new Error("No browser context from CDP");

		const pages = this.context.pages();
		const geminiPage = pages.find((p) => p.url().includes("gemini.google.com"));
		if (geminiPage) {
			this.page = geminiPage;
		} else {
			this.page = await this.context.newPage();
			await this.page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });
		}

		const cookies = this.parseCookies();
		if (cookies.length > 0) {
			try {
				await this.context.addCookies(cookies);
			} catch (e) {
				console.warn("[Gemini Web] Failed to add some cookies:", e);
			}
		}

		this.initialized = true;
	}

	private async chatCompletionsViaDOM(params: {
		message: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		if (!this.page) throw new Error("GeminiWebClient not initialized");

		const page = this.page;
		const inputSelectors = [
			'textarea[placeholder*="Gemini"]',
			'textarea[placeholder*="问问"]',
			'textarea[aria-label*="prompt"]',
			"textarea",
			'div[role="textbox"]',
			'[contenteditable="true"]',
		];
		let inputHandle = null;
		for (const sel of inputSelectors) {
			inputHandle = await page.$(sel);
			if (inputHandle) break;
		}
		if (!inputHandle) {
			throw new Error("Gemini: could not find chat input");
		}

		await inputHandle.click();
		await delay(300);
		await page.keyboard.type(params.message, { delay: 20 });
		await delay(300);
		await page.keyboard.press("Enter");

		const maxWaitMs = 120000;
		const pollIntervalMs = 2000;
		let lastText = "";
		let stableCount = 0;
		const signal = params.signal;

		for (let elapsed = 0; elapsed < maxWaitMs; elapsed += pollIntervalMs) {
			if (signal?.aborted) throw new Error("Gemini request aborted");

			await delay(pollIntervalMs);

			const result = await this.page.evaluate(() => {
				const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
				const getText = (el: Element): string => {
					const raw = (el as HTMLElement).innerText ?? "";
					return clean(raw);
				};

				const sidebarRoot = document.querySelector('[aria-label*="对话"], [class*="sidebar"], nav');
				const inputEl = document.querySelector(
					'[contenteditable="true"], textarea, [placeholder*="Gemini"], [placeholder*="问问"]',
				);
				const inputRoot =
					inputEl?.closest("form") ??
					inputEl?.closest("[class*='input']") ??
					inputEl?.parentElement?.parentElement;

				const isExcluded = (el: Element) => sidebarRoot?.contains(el) || inputRoot?.contains(el);

				const noisePatterns = [
					"Ask Gemini",
					"问问 Gemini",
					"Enter a prompt",
					"输入提示",
					"需要我为你做些什么",
					"发起新对话",
					"我的内容",
					"设置和帮助",
					"制作图片",
					"创作音乐",
					"帮我学习",
					"随便写点什么",
					"给我的一天注入活力",
					"升级到 Google AI Plus",
					"正在加载",
					"复制",
					"分享",
					"修改",
					"朗读",
				];
				const isNoise = (t: string) =>
					t.length < 20 ||
					noisePatterns.some((p) => t.includes(p)) ||
					/^(你好|需要我|sage)/i.test(t);

				const stripTrailingUI = (t: string) =>
					t
						.replace(
							/\n?\s*(复制|分享|修改|朗读|Copy|Share|Edit|Read aloud|thumb_up|thumb_down|more_vert)[\s\n]*/gi,
							"",
						)
						.replace(/\s+$/, "");

				const main =
					document.querySelector("main") ??
					document.querySelector('[role="main"]') ??
					document.querySelector('[class*="chat"]') ??
					document.body;
				const scoped = main === document.body ? document : main;

				let text = "";

				const modelSelectors = [
					"model-response message-content",
					'[data-message-author="model"] .message-content',
					'[data-message-author="model"]',
					'[data-sender="model"]',
					'[class*="model-response"] [class*="markdown"]',
					'[class*="model-response"]',
					'[class*="response-content"] [class*="markdown"]',
					'[class*="response-content"]',
				];

				for (const sel of modelSelectors) {
					const els = scoped.querySelectorAll(sel);
					for (let i = els.length - 1; i >= 0; i--) {
						const el = els[i]!;
						if (isExcluded(el)) continue;
						const t = getText(el);
						if (t.length >= 30 && !isNoise(t)) {
							text = stripTrailingUI(t);
							break;
						}
					}
					if (text) break;
				}

				if (!text) {
					const fallbackSelectors = ['[class*="markdown"]', "article"];
					for (const sel of fallbackSelectors) {
						const els = scoped.querySelectorAll(sel);
						for (let i = els.length - 1; i >= 0; i--) {
							const el = els[i]!;
							if (isExcluded(el)) continue;
							const t = getText(el);
							if (t.length >= 30 && !isNoise(t)) {
								text = stripTrailingUI(t);
								break;
							}
						}
						if (text) break;
					}
				}

				const stopBtn = document.querySelector(
					'[aria-label*="Stop"], [aria-label*="stop"], [aria-label*="停止"]',
				);
				const isStreaming = !!stopBtn;
				return { text, isStreaming };
			});

			const minLen = 40;
			if (result.text && result.text.length >= minLen) {
				if (result.text !== lastText) {
					lastText = result.text;
					stableCount = 0;
				} else {
					stableCount++;
					if (!result.isStreaming && stableCount >= 2) break;
				}
			}
		}

		if (!lastText) {
			throw new Error(
				"Gemini: no assistant reply detected. Open gemini.google.com, sign in, and ensure the chat input is visible.",
			);
		}

		const sseLine = `data: ${JSON.stringify({ text: lastText })}\n`;
		const encoder = new TextEncoder();
		return new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sseLine));
				controller.close();
			},
		});
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		if (!this.page) throw new Error("GeminiWebClient not initialized");
		return this.chatCompletionsViaDOM({
			message: params.message,
			signal: params.signal,
		});
	}

	async parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseGeminiStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "gemini-pro", name: "Gemini Pro (Web)" },
			{ id: "gemini-ultra", name: "Gemini Ultra (Web)" },
		];
	}

	async close(): Promise<void> {
		if (this.browser) {
			await this.browser.close();
			this.browser = null;
		}
		this.context = null;
		this.page = null;
		this.initialized = false;
	}
}
