import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";

export interface QwenWebAuth {
	sessionToken: string;
	cookie: string;
	userAgent: string;
}

export async function loginQwenWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<QwenWebAuth> {
	const cdpUrl = getDefaultCdpUrl();
	params.onProgress("Connecting to Chrome debug port...");

	let wsUrl: string | null = null;
	for (let i = 0; i < 10; i++) {
		wsUrl = await getChromeWebSocketUrl(cdpUrl, 2000);
		if (wsUrl) {
			break;
		}
		await new Promise((r) => setTimeout(r, 500));
	}

	if (!wsUrl) {
		throw new Error(`Failed to resolve Chrome WebSocket URL from ${cdpUrl} after retries.`);
	}

	params.onProgress("Connecting to browser...");
	const browser = await chromium.connectOverCDP(wsUrl, {
		headers: getHeadersWithAuth(wsUrl),
		timeout: 60_000,
	});
	const context = browser.contexts()[0];
	if (!context) {
		throw new Error("No browser context available");
	}
	const page = context.pages()[0] || (await context.newPage());

	await page.goto("https://chat.qwen.ai/");
	const userAgent = await page.evaluate(() => navigator.userAgent);

	params.onProgress("Please login to Qwen in the opened browser window...");

	return await new Promise<QwenWebAuth>((resolve, reject) => {
		let capturedToken: string | undefined;
		let resolved = false;

		const timeout = setTimeout(() => {
			if (!resolved) {
				reject(new Error("Login timed out (5 minutes)."));
			}
		}, 300_000);

		const tryResolve = async () => {
			if (resolved) {
				return;
			}

			try {
				const cookies = await context.cookies(["https://chat.qwen.ai", "https://qwen.ai"]);
				if (cookies.length === 0) {
					console.log(`[Qwen] No cookies found in context yet.`);
					return;
				}

				const cookieNames = cookies.map((c) => c.name);
				console.log(`[Qwen] Found cookies: ${cookieNames.join(", ")}`);

				const sessionCookie = cookies.find(
					(c) => c.name.includes("session") || c.name.includes("token") || c.name.includes("auth"),
				);

				if (sessionCookie || capturedToken) {
					const finalToken = capturedToken || sessionCookie?.value || "";

					if (finalToken && cookies.length > 2) {
						resolved = true;
						clearTimeout(timeout);
						console.log(`[Qwen] Session token captured!`);

						const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

						resolve({
							sessionToken: finalToken,
							cookie: cookieString,
							userAgent,
						});
					} else {
						console.log(`[Qwen] Waiting for valid session...`);
					}
				} else {
					console.log(`[Qwen] Waiting for session cookie...`);
				}
			} catch (e: unknown) {
				console.error(`[Qwen] Failed to fetch cookies: ${String(e)}`);
			}
		};

		page.on("request", async (request) => {
			const url = request.url();
			if (url.includes("qwen.ai")) {
				const headers = request.headers();
				const auth = headers.authorization;
				const cookie = headers.cookie;

				if (auth) {
					if (!capturedToken) {
						console.log(`[Qwen] Captured authorization token from request.`);
						capturedToken = auth.replace("Bearer ", "");
					}
					await tryResolve();
				} else if (cookie) {
					const tokenMatch = cookie.match(/(?:session|token|auth)[^=]*=([^;]+)/i);
					if (tokenMatch) {
						if (!capturedToken) {
							console.log(`[Qwen] Captured session from cookie.`);
							capturedToken = tokenMatch[1];
						}
						await tryResolve();
					}
				}
			}
		});

		page.on("response", async (response) => {
			const url = response.url();
			if (url.includes("qwen.ai") && response.ok()) {
				await tryResolve();
			}
		});

		page.on("close", () => {
			reject(new Error("Browser window closed before login was captured."));
		});

		const checkInterval = setInterval(async () => {
			await tryResolve();
			if (resolved) {
				clearInterval(checkInterval);
			}
		}, 2000);
	});
}
