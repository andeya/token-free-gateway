import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";

export interface DoubaoWebAuth {
	sessionid: string;
	ttwid?: string;
	userAgent: string;
	cookie?: string;
}

export async function loginDoubaoWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<DoubaoWebAuth> {
	const cdpUrl = getDefaultCdpUrl();
	params.onProgress(`Connecting to Chrome at ${cdpUrl}...`);

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

	params.onProgress("Connecting to browser...");
	const browser = await chromium.connectOverCDP(wsUrl, {
		headers: getHeadersWithAuth(wsUrl),
	});
	const context = browser.contexts()[0];
	if (!context) throw new Error("No browser context available");
	const page = context.pages()[0] || (await context.newPage());

	await page.goto("https://www.doubao.com/chat/");
	const userAgent = await page.evaluate(() => navigator.userAgent);

	params.onProgress("Please login to Doubao in the opened browser window...");

	return new Promise<DoubaoWebAuth>((resolve, reject) => {
		let resolved = false;

		const timeout = setTimeout(() => {
			if (!resolved) reject(new Error("Login timed out (5 minutes)."));
		}, 300000);

		const tryResolve = async () => {
			if (resolved) return;
			try {
				const cookies = await context.cookies(["https://www.doubao.com", "https://doubao.com"]);
				if (cookies.length === 0) return;

				const sessionidCookie = cookies.find((c) => c.name === "sessionid");
				const ttwidCookie = cookies.find((c) => c.name === "ttwid");

				if (sessionidCookie) {
					resolved = true;
					clearTimeout(timeout);
					const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
					resolve({
						sessionid: sessionidCookie.value,
						ttwid: ttwidCookie?.value,
						userAgent,
						cookie: cookieString,
					});
				}
			} catch (e: unknown) {
				console.error(`[Doubao] Failed to fetch cookies: ${String(e)}`);
			}
		};

		page.on("request", async (request) => {
			const url = request.url();
			if (url.includes("doubao.com")) {
				const headers = request.headers();
				if (headers.cookie?.includes("sessionid")) await tryResolve();
			}
		});

		page.on("response", async (response) => {
			const url = response.url();
			if (url.includes("doubao.com") && response.ok()) await tryResolve();
		});

		page.on("close", () => {
			reject(new Error("Browser window closed before login was captured."));
		});

		const checkInterval = setInterval(async () => {
			await tryResolve();
			if (resolved) clearInterval(checkInterval);
		}, 2000);
	});
}
