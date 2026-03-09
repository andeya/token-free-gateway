import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";

export interface DeepSeekWebCredentials {
	cookie: string;
	bearer: string;
	userAgent: string;
}

export async function loginDeepseekWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<DeepSeekWebCredentials> {
	const cdpUrl = getDefaultCdpUrl();
	params.onProgress("Connecting to Chrome debug port...");

	let wsUrl: string | null = null;
	for (let i = 0; i < 10; i++) {
		wsUrl = await getChromeWebSocketUrl(cdpUrl, 2000);
		if (wsUrl) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	if (!wsUrl) {
		throw new Error(`Failed to resolve Chrome WebSocket URL from ${cdpUrl} after retries.`);
	}

	params.onProgress("Connecting to browser...");
	const browser = await chromium.connectOverCDP(wsUrl, {
		headers: getHeadersWithAuth(wsUrl),
	});
	const context = browser.contexts()[0] || (await browser.newContext());

	const existingPages = context.pages();
	let page = existingPages.find(
		(p) => p.url().includes("deepseek.com") || p.url().includes("chat.deepseek.com"),
	);

	if (!page) {
		page = await context.newPage();
		params.onProgress("Opening DeepSeek page...");
	} else {
		params.onProgress("Found existing DeepSeek page, switching to it...");
		await page.bringToFront();
	}

	params.onProgress("Checking for existing DeepSeek session...");
	const existingCookies = await context.cookies([
		"https://chat.deepseek.com",
		"https://deepseek.com",
	]);
	const cookieString = existingCookies.map((c) => `${c.name}=${c.value}`).join("; ");

	const hasDeviceId = cookieString.includes("d_id=");
	const hasSessionId = cookieString.includes("ds_session_id=");
	const hasSessionInfo = cookieString.includes("HWSID=") || cookieString.includes("uuid=");

	let bearer = "";
	let userAgent = await page.evaluate(() => navigator.userAgent);

	if (
		(hasDeviceId || hasSessionId || hasSessionInfo || existingCookies.length > 3) &&
		cookieString.length > 10
	) {
		params.onProgress("Found existing DeepSeek session!");

		try {
			await page.goto("https://chat.deepseek.com", { timeout: 5000 });
		} catch {
			// ignore navigation errors
		}

		try {
			const storageSnapshot = await page.evaluate(() => {
				const data: Record<string, string> = {};
				const store = globalThis.localStorage;
				for (let i = 0; i < store.length; i++) {
					const key = store.key(i);
					if (key) {
						data[key] = store.getItem(key) ?? "";
					}
				}
				return data;
			});

			for (const [key, value] of Object.entries(storageSnapshot)) {
				if (key.toLowerCase().includes("token") || key.toLowerCase().includes("auth")) {
					try {
						const parsed: unknown = JSON.parse(value);
						if (typeof parsed === "object" && parsed !== null && "token" in parsed) {
							const token = (parsed as { token?: string }).token;
							if (token) bearer = token;
						} else if (typeof parsed === "string" && parsed.length > 20) {
							bearer = parsed;
						}
					} catch {
						if (value.length > 20) {
							bearer = value;
						}
					}
				}
			}
		} catch {
			// ignore localStorage errors
		}

		if (!bearer) {
			params.onProgress("Requesting DeepSeek API to capture token...");
			try {
				const response = await page.request.get("https://chat.deepseek.com/api/v0/users/current", {
					headers: { Cookie: cookieString },
				});
				if (response.ok()) {
					const data = (await response.json()) as {
						data?: { biz_data?: { token?: string } };
					};
					bearer = data?.data?.biz_data?.token || "";
				}
			} catch {
				// ignore API errors
			}
		}

		if (bearer) {
			return {
				cookie: cookieString,
				bearer,
				userAgent,
			};
		}
	}

	await page.goto("https://chat.deepseek.com");
	userAgent = await page.evaluate(() => navigator.userAgent);

	params.onProgress(
		"Please login to DeepSeek in the opened browser window. The session token will be captured automatically once you are logged in.",
	);

	return new Promise<DeepSeekWebCredentials>((resolve, reject) => {
		let capturedBearer: string | undefined;
		let resolved = false;
		let checkInterval: ReturnType<typeof setInterval> | undefined;

		const timeout = setTimeout(() => {
			if (!resolved) {
				if (checkInterval) clearInterval(checkInterval);
				reject(new Error("Login timed out (5 minutes)."));
			}
		}, 300000);

		const tryResolve = async () => {
			if (!capturedBearer || resolved) {
				return;
			}

			try {
				const cookies = await context.cookies([
					"https://chat.deepseek.com",
					"https://deepseek.com",
				]);
				if (cookies.length === 0) {
					return;
				}

				const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
				const hasDId = cookieStr.includes("d_id=");
				const hasSession = cookieStr.includes("ds_session_id=");

				if (hasDId || hasSession || cookies.length > 3) {
					resolved = true;
					clearTimeout(timeout);
					if (checkInterval) clearInterval(checkInterval);
					console.log(`[DeepSeek] Credentials captured`);
					resolve({ cookie: cookieStr, bearer: capturedBearer, userAgent });
				}
			} catch (e: unknown) {
				console.error(`[DeepSeek] Failed to fetch cookies: ${String(e)}`);
			}
		};

		page.on("request", async (request) => {
			const url = request.url();
			if (url.includes("/api/v0/")) {
				const headers = request.headers();
				const auth = headers.authorization;
				if (auth?.startsWith("Bearer ")) {
					if (!capturedBearer) {
						capturedBearer = auth.slice(7);
					}
					await tryResolve();
				}
			}
		});

		page.on("response", async (response) => {
			const url = response.url();
			if (url.includes("/api/v0/users/current") && response.ok()) {
				try {
					const body = (await response.json()) as Record<string, unknown>;
					const bizData = body?.data as Record<string, unknown> | undefined;
					const token = (bizData?.biz_data as Record<string, unknown> | undefined)?.token;
					if (typeof token === "string" && token.length > 0) {
						if (!capturedBearer) {
							capturedBearer = token;
						}
						await tryResolve();
					}
				} catch {}
			}
		});

		page.on("close", () => {
			if (checkInterval) clearInterval(checkInterval);
			reject(new Error("Browser window closed before login was captured."));
		});

		checkInterval = setInterval(tryResolve, 2000);
	});
}
