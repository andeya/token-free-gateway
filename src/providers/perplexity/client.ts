import type { Page } from "playwright-core";
import { pasteText } from "../../browser/dom-input.ts";
import { BaseDomClient } from "../factory/base-dom-client.ts";
import type { DomClientConfig, NormalizedSendParams } from "../factory/types.ts";
import { parseCookieHeader } from "../shared/cookie-parser.ts";
import type { StreamResult } from "../types.ts";
import type { PerplexityWebAuth } from "./auth.ts";
import { parsePerplexityStream } from "./stream.ts";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PerplexityWebClient extends BaseDomClient<PerplexityWebAuth> {
	readonly providerId = "perplexity-web";

	protected readonly config: DomClientConfig = {
		hostKey: "perplexity.ai",
		startUrl: "https://www.perplexity.ai",
		cookieDomain: ".perplexity.ai",
		models: [
			{ id: "perplexity-web", name: "Perplexity (Sonar)" },
			{ id: "perplexity-pro", name: "Perplexity Pro" },
		],
		pollIntervalMs: 3000,
		maxWaitMs: 120_000,
		stabilityThreshold: 2,
	};

	protected getCookies() {
		return parseCookieHeader(this.auth.cookie, this.config.cookieDomain);
	}

	protected async sendViaDom(page: Page, params: NormalizedSendParams): Promise<string> {
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
		if (!inputHandle) throw new Error("Perplexity DOM: input not found");
		await inputHandle.click();
		await delay(300);
		await page.keyboard.press("Meta+a");
		await page.keyboard.press("Backspace");
		await delay(200);
		await pasteText(page, params.message, inputHandle);
		await delay(300);

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
			/* continue polling */
		}

		return this.pollForStableText(async () => {
			return page.evaluate(() => {
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
						if (t.length >= 2) return t;
					}
				}
				return "";
			});
		}, params.signal);
	}

	protected override formatSsePayload(text: string): string {
		return `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`;
	}

	protected parseStreamImpl(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parsePerplexityStream(body, onDelta);
	}
}
