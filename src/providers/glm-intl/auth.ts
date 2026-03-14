import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";

export interface GlmIntlWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginGlmIntlWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<GlmIntlWebAuth> {
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

	params.onProgress("Navigating to GLM International...");
	await page.goto("https://chat.z.ai/", { waitUntil: "domcontentloaded", timeout: 120000 });

	const userAgent = await page.evaluate(() => navigator.userAgent);
	params.onProgress("Please login to GLM International in the opened browser window...");
	params.onProgress("Waiting for authentication...");

	try {
		await page.waitForFunction(
			() => {
				const cookieStr = document.cookie;
				const currentUrl = window.location.href;
				const hasAuthCookie =
					cookieStr.includes("chatglm_refresh_token") ||
					cookieStr.includes("refresh_token") ||
					cookieStr.includes("auth_token") ||
					cookieStr.includes("access_token") ||
					cookieStr.includes("session") ||
					cookieStr.includes("token");
				const isLoggedInUrl =
					currentUrl.includes("chat") ||
					currentUrl.includes("conversation") ||
					currentUrl.includes("dashboard") ||
					(!currentUrl.includes("login") && !currentUrl.includes("auth"));
				const hasChatElements =
					document.querySelector(
						'textarea, [contenteditable="true"], .chat-input, .message-input',
					) !== null;
				return hasAuthCookie || (isLoggedInUrl && hasChatElements);
			},
			{ timeout: 600000, polling: 1000 },
		);
		params.onProgress("Login detected...");
	} catch (error) {
		params.onProgress(
			`Login detection timed out or failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		const cookies = await context.cookies("https://chat.z.ai");
		const cookieNames = cookies.map((c) => c.name).join(", ");
		if (cookies.length === 0) {
			throw new Error(
				`Login timeout. Please ensure you've logged in to chat.z.ai. Cookies: ${cookieNames || "none"}`,
				{ cause: error },
			);
		}
		params.onProgress("Proceeding with available cookies...");
	}

	params.onProgress("Capturing cookies...");
	const cookies = await context.cookies("https://chat.z.ai");
	const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
	params.onProgress("Authentication captured successfully!");

	return { cookie: cookieString, userAgent };
}
