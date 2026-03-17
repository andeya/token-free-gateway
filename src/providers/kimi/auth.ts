import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";

export interface KimiWebAuth {
	cookie: string;
	userAgent: string;
	accessToken?: string;
	refreshToken?: string;
}

export async function loginKimiWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<KimiWebAuth> {
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

	params.onProgress("Navigating to Kimi...");
	await page.goto("https://www.kimi.com/", { waitUntil: "domcontentloaded" });

	params.onProgress("Please login in the browser window...");
	params.onProgress("Waiting for authentication...");

	await page.waitForFunction(
		() => {
			return document.cookie.includes("access_token") || !!localStorage.getItem("access_token");
		},
		{ timeout: 300000 },
	);

	params.onProgress("Login detected, capturing credentials...");

	const cookies = await context.cookies();
	const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
	const localStorageData = await page.evaluate(() => {
		const at = localStorage.getItem("access_token");
		const rt = localStorage.getItem("refresh_token");
		const kimiAuth = document.cookie.includes("kimi-auth")
			? (document.cookie
					.split(";")
					.find((c) => c.trim().startsWith("kimi-auth="))
					?.split("=")[1] ?? "")
			: "";
		return { access_token: at, refresh_token: rt, kimiAuthCookie: kimiAuth };
	});
	const userAgent = await page.evaluate(() => navigator.userAgent);

	params.onProgress("Authentication captured successfully!");

	return {
		cookie: cookieString || `kimi-auth=${localStorageData.kimiAuthCookie}`,
		accessToken: localStorageData.access_token || undefined,
		refreshToken: localStorageData.refresh_token || undefined,
		userAgent,
	};
}
