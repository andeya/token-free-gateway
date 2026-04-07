import type { Page } from "playwright-core";
import { BrowserManager } from "../../browser/manager.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { PerplexityWebAuth } from "./auth.ts";
import { parsePerplexityStream } from "./stream.ts";

const PERPLEXITY_BASE_URL = "https://www.perplexity.ai";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PerplexityWebClient implements WebProviderClient {
	readonly providerId = "perplexity-web";
	private options: PerplexityWebAuth;
	private page: Page | null = null;
	private initialized = false;

	constructor(auth: PerplexityWebAuth) {
		this.options = auth;
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
					domain: ".perplexity.ai",
					path: "/",
				};
			})
			.filter((c) => c.name.length > 0);
	}

	async init(): Promise<void> {
		if (this.initialized) {
			return;
		}

		const bm = BrowserManager.getInstance();
		this.page = await bm.getPage("perplexity.ai", PERPLEXITY_BASE_URL);
		await bm.addCookies(this.parseCookies());

		this.initialized = true;
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		if (!this.page) {
			throw new Error("PerplexityWebClient not initialized");
		}

		const page = this.page;

		const newThreadBtn = await page.$(
			'button:has-text("新建问题"), button:has-text("New Thread"), a:has-text("新建问题"), a:has-text("New Thread")',
		);
		if (newThreadBtn) {
			await newThreadBtn.click();
			await delay(1500);
		} else {
			await page.goto("https://www.perplexity.ai/", { waitUntil: "domcontentloaded" });
			await delay(2000);
		}

		const inputSel = 'div[contenteditable="true"], [role="textbox"], textarea';
		const inputHandle = await page.$(inputSel);
		if (!inputHandle) {
			throw new Error("Perplexity DOM: input not found");
		}
		await inputHandle.click();
		await delay(300);

		await page.keyboard.press("Meta+a");
		await page.keyboard.press("Backspace");
		await delay(200);
		await page.keyboard.type(params.message, { delay: 20 });
		await delay(500);

		const urlBeforeSubmit = page.url();

		await page.keyboard.press("Enter");

		try {
			await page.waitForURL(
				(url) =>
					url.href !== urlBeforeSubmit &&
					(url.pathname.startsWith("/search/") || url.pathname.startsWith("/c/")),
				{ timeout: 15000 },
			);
		} catch {
			// continue polling
		}

		const maxWaitMs = 120_000;
		const pollInterval = 3000;
		let lastText = "";
		let stableCount = 0;

		for (let elapsed = 0; elapsed < maxWaitMs; elapsed += pollInterval) {
			await delay(pollInterval);

			const text = await page.evaluate(() => {
				const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
				const selectors = [
					'[class*="prose"]',
					'[class*="break-words"][class*="font-sans"]',
					'[class*="markdown"]',
					'[class*="threadConten"] [class*="gap-y-sm"]',
				];
				for (const sel of selectors) {
					const els = document.querySelectorAll(sel);
					for (let i = els.length - 1; i >= 0; i--) {
						const t = clean((els[i] as HTMLElement).innerText ?? "");
						if (t.length >= 2) {
							return t;
						}
					}
				}
				return "";
			});

			if (text && text.length >= 2) {
				if (text !== lastText) {
					lastText = text;
					stableCount = 0;
				} else {
					stableCount++;
					if (stableCount >= 2) {
						break;
					}
				}
			}
		}

		if (!lastText) {
			throw new Error("Perplexity DOM: no response detected after submit");
		}

		const ssePayload = `data: ${JSON.stringify({ text: lastText })}\n\ndata: [DONE]\n\n`;
		const sseBytes = new TextEncoder().encode(ssePayload);

		return new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(sseBytes);
				controller.close();
			},
		});
	}

	async parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parsePerplexityStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "perplexity-web", name: "Perplexity (Sonar)" },
			{ id: "perplexity-pro", name: "Perplexity Pro" },
		];
	}

	async close(): Promise<void> {
		this.page = null;
		this.initialized = false;
	}
}
