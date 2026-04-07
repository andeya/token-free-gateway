import type { Page } from "playwright-core";
import { BrowserManager } from "../../browser/manager.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { GlmIntlWebAuth } from "./auth.ts";
import { parseGlmIntlStream } from "./stream.ts";

export class GlmIntlWebClient implements WebProviderClient {
	readonly providerId = "glm-intl-web";
	private options: GlmIntlWebAuth;
	private page: Page | null = null;
	private initialized = false;

	constructor(auth: GlmIntlWebAuth) {
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
					domain: ".z.ai",
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
		this.page = await bm.getPage("chat.z.ai", "https://chat.z.ai/");
		await bm.addCookies(this.parseCookies());

		this.initialized = true;
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		if (!this.page) {
			throw new Error("GlmIntlWebClient not initialized");
		}
		const page = this.page;

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
				await page.keyboard.type(params.message, { delay: 5 });
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

		if (!sent) {
			throw new Error("GLM Intl UI send failed: no chat input found.");
		}

		await page
			.waitForFunction(
				(prev) => document.querySelectorAll(".chat-assistant").length > prev,
				beforeCount,
				{ timeout: 120000, polling: 500 },
			)
			.catch(() => {});

		const deadline = Date.now() + 120000;
		let stableRounds = 0;
		let lastText = "";
		while (Date.now() < deadline) {
			const text = await page.evaluate(() => {
				const nodes = Array.from(document.querySelectorAll(".chat-assistant"));
				const latest = nodes[nodes.length - 1] as HTMLElement | undefined;
				return (latest?.innerText ?? "").trim();
			});

			if (text && text === lastText) {
				stableRounds += 1;
			} else {
				stableRounds = 0;
				lastText = text;
			}

			if (lastText && stableRounds >= 3) {
				break;
			}
			await new Promise((r) => setTimeout(r, 900));
		}

		if (!lastText) {
			throw new Error("GLM Intl UI reply capture failed: assistant message not found.");
		}

		const payload = `data: ${JSON.stringify({ text: lastText })}\n\n`;
		const encoder = new TextEncoder();
		return new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(payload));
				controller.close();
			},
		});
	}

	async parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseGlmIntlStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "glm-4-plus", name: "GLM-4 Plus" },
			{ id: "glm-4-think", name: "GLM-4 Think" },
		];
	}

	async close(): Promise<void> {
		this.page = null;
		this.initialized = false;
	}
}
