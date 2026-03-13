import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";

export interface GlmWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginGlmWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<GlmWebAuth> {
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

	params.onProgress("Navigating to ChatGLM...");
	await page.goto("https://chatglm.cn", { waitUntil: "domcontentloaded" });

	const userAgent = await page.evaluate(() => navigator.userAgent);
	params.onProgress("Please login to ChatGLM in the opened browser window...");
	params.onProgress("Waiting for authentication (chatglm_refresh_token cookie)...");

	await page.waitForFunction(
		() => {
			return document.cookie.includes("chatglm_refresh_token");
		},
		{ timeout: 300000 },
	);

	params.onProgress("Login detected, capturing cookies...");
	const cookies = await context.cookies("https://chatglm.cn");
	const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
	params.onProgress("Authentication captured successfully!");

	return { cookie: cookieString, userAgent };
}
