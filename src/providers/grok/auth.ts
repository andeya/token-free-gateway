import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";

export interface GrokWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginGrokWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<GrokWebAuth> {
	const onProgress = params.onProgress;
	const cdpUrl = getDefaultCdpUrl();
	onProgress(`Connecting to Chrome at ${cdpUrl}...`);

	let wsUrl: string | null = null;
	for (let i = 0; i < 10; i++) {
		wsUrl = await getChromeWebSocketUrl(cdpUrl, 2000);
		if (wsUrl) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	if (!wsUrl) {
		throw new Error(
			`Failed to connect to Chrome at ${cdpUrl}. Make sure Chrome is running in debug mode.`,
		);
	}

	onProgress("Connecting to browser...");
	const browser = await chromium.connectOverCDP(wsUrl, {
		headers: getHeadersWithAuth(wsUrl),
	});
	const context = browser.contexts()[0];
	if (!context) throw new Error("No browser context available");
	const page = context.pages()[0] || (await context.newPage());

	onProgress("Navigating to Grok...");
	await page.goto("https://grok.com", { waitUntil: "domcontentloaded" });

	const userAgent = await page.evaluate(() => navigator.userAgent);
	onProgress("Please sign in to Grok in the browser window...");
	onProgress("Waiting for session cookies...");

	await page.waitForFunction(
		() => document.cookie.includes("sso") || document.cookie.includes("_ga"),
		{ timeout: 300000 },
	);

	onProgress("Login detected, capturing cookies...");
	const cookies = await context.cookies("https://grok.com");
	const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
	onProgress("Authentication captured successfully.");

	return { cookie: cookieString, userAgent };
}
