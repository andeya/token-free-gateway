import type { Page } from "playwright-core";
import { pasteText } from "../../browser/dom-input.ts";
import { BaseDomClient } from "../factory/base-dom-client.ts";
import type { DomClientConfig, NormalizedSendParams } from "../factory/types.ts";
import { parseCookieHeader } from "../shared/cookie-parser.ts";
import type { StreamResult } from "../types.ts";
import type { GlmIntlWebAuth } from "./auth.ts";
import { parseGlmIntlStream } from "./stream.ts";

export class GlmIntlWebClient extends BaseDomClient<GlmIntlWebAuth> {
	readonly providerId = "glm-intl-web";

	protected readonly config: DomClientConfig = {
		hostKey: "chat.z.ai",
		startUrl: "https://chat.z.ai/",
		cookieDomain: ".z.ai",
		models: [
			{ id: "glm-4-plus", name: "GLM-4 Plus" },
			{ id: "glm-4-think", name: "GLM-4 Think" },
		],
		pollIntervalMs: 900,
		maxWaitMs: 120_000,
		stabilityThreshold: 3,
	};

	protected getCookies() {
		return parseCookieHeader(this.auth.cookie, this.config.cookieDomain);
	}

	protected async sendViaDom(page: Page, params: NormalizedSendParams): Promise<string> {
		if (!page.url().includes("chat.z.ai")) {
			await page.goto("https://chat.z.ai/", { waitUntil: "domcontentloaded", timeout: 120000 });
		}

		const beforeCount = await page.locator(".chat-assistant").count();

		let sent = false;
		const textarea = page.locator("textarea").first();
		if ((await textarea.count()) > 0) {
			await textarea.click({ timeout: 5000 });
			await textarea.fill(params.message);
			await textarea.press("Enter");
			sent = true;
		}
		if (!sent) {
			const editable = page.locator('[contenteditable="true"]').first();
			if ((await editable.count()) > 0) {
				await editable.click({ timeout: 5000 });
				await pasteText(page, params.message);
				await page.keyboard.press("Enter");
				sent = true;
			}
		}
		if (!sent) {
			const input = page.locator('input[type="text"]').first();
			if ((await input.count()) > 0) {
				await input.click({ timeout: 5000 });
				await input.fill(params.message);
				const sendBtn = page
					.locator('button.sendMessageButton, button[aria-label*="Send"], button:has-text("发送")')
					.first();
				if ((await sendBtn.count()) > 0) {
					await sendBtn.click();
					sent = true;
				} else {
					await input.press("Enter");
					sent = true;
				}
			}
		}
		if (!sent) throw new Error("GLM Intl UI send failed: no chat input found.");

		await page
			.waitForFunction(
				(prev) => document.querySelectorAll(".chat-assistant").length > prev,
				beforeCount,
				{ timeout: 120000, polling: 500 },
			)
			.catch(() => {});

		return this.pollForStableText(async () => {
			return page.evaluate(() => {
				const nodes = Array.from(document.querySelectorAll(".chat-assistant"));
				const latest = nodes[nodes.length - 1] as HTMLElement | undefined;
				return (latest?.innerText ?? "").trim();
			});
		}, params.signal);
	}

	protected parseStreamImpl(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseGlmIntlStream(body, onDelta);
	}
}
