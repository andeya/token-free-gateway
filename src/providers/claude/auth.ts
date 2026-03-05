/**
 * Claude Web authentication via Chrome CDP.
 * Captures sessionKey cookie from claude.ai after user logs in.
 */

import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";

export interface ClaudeWebAuth {
	sessionKey: string;
	cookie: string;
	userAgent: string;
	organizationId?: string;
}

export async function loginClaudeWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<ClaudeWebAuth> {
	const cdpUrl = getDefaultCdpUrl();
	params.onProgress("Connecting to Chrome debug port...");

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

	params.onProgress("Connecting to browser...");
	const browser = await chromium.connectOverCDP(wsUrl, {
		headers: getHeadersWithAuth(wsUrl),
	});
	const context = browser.contexts()[0];
	if (!context) throw new Error("No browser context available");
	const page = context.pages()[0] || (await context.newPage());

	await page.goto("https://claude.ai/");
	const userAgent = await page.evaluate(() => navigator.userAgent);
	params.onProgress("Please login to Claude in the opened browser window...");

	return new Promise<ClaudeWebAuth>((resolve, reject) => {
		let capturedSessionKey: string | undefined;
		let resolved = false;

		const timeout = setTimeout(() => {
			if (!resolved) reject(new Error("Login timed out (5 minutes)."));
		}, 300000);

		const tryResolve = async () => {
			if (resolved) return;
			try {
				const cookies = await context.cookies(["https://claude.ai", "https://www.claude.ai"]);
				if (cookies.length === 0) return;

				const sessionKeyCookie = cookies.find(
					(c) =>
						c.name === "sessionKey" ||
						c.value.startsWith("sk-ant-sid01-") ||
						c.value.startsWith("sk-ant-sid02-"),
				);

				const finalKey = capturedSessionKey || sessionKeyCookie?.value || "";
				if (finalKey.startsWith("sk-ant-sid01-") || finalKey.startsWith("sk-ant-sid02-")) {
					resolved = true;
					clearTimeout(timeout);
					const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
					resolve({ sessionKey: finalKey, cookie: cookieString, userAgent });
				}
			} catch (e) {
				console.error(`[Claude] Failed to fetch cookies: ${e}`);
			}
		};

		page.on("request", async (request) => {
			if (request.url().includes("claude.ai")) {
				const cookie = request.headers().cookie;
				if (cookie) {
					const match = cookie.match(/sessionKey=([^;]+)/);
					if (match?.[1]?.startsWith("sk-ant-sid01-") || match?.[1]?.startsWith("sk-ant-sid02-")) {
						if (!capturedSessionKey) capturedSessionKey = match[1];
						await tryResolve();
					}
				}
			}
		});

		page.on("response", async (response) => {
			if (response.url().includes("claude.ai") && response.ok()) await tryResolve();
		});

		page.on("close", () => reject(new Error("Browser window closed before login.")));

		const interval = setInterval(async () => {
			await tryResolve();
			if (resolved) clearInterval(interval);
		}, 2000);
	});
}
