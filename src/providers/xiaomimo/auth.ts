import { chromium } from "playwright-core";
import {
	getChromeWebSocketUrl,
	getDefaultCdpUrl,
	getHeadersWithAuth,
} from "../../browser/cdp-helpers.ts";

export interface XiaomiMimoWebAuth {
	cookie: string;
	userAgent: string;
}

const XIAOMIMO_AUTH_URL = "https://aistudio.xiaomimimo.com/#/";

export async function loginXiaomiMimoWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<XiaomiMimoWebAuth> {
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
	let page = context.pages()[0];

	if (!page) {
		page = await context.newPage();
	} else {
		const existingPage = context.pages().find((p) => p.url().includes("xiaomimimo.com"));
		if (existingPage) {
			page = existingPage;
		}
	}

	params.onProgress(`Opening ${XIAOMIMO_AUTH_URL}...`);
	await params.openUrl(XIAOMIMO_AUTH_URL);

	await page
		.goto(XIAOMIMO_AUTH_URL, { waitUntil: "domcontentloaded", timeout: 15_000 })
		.catch(() => {});

	const userAgent = await page.evaluate(() => navigator.userAgent);
	params.onProgress("Please login to Xiaomi MiMo in the opened browser window...");
	params.onProgress("Waiting for authentication token...");

	return await new Promise<XiaomiMimoWebAuth>((resolve, reject) => {
		let capturedToken: string | undefined;
		let resolved = false;
		let checkInterval: ReturnType<typeof setInterval> | undefined;

		const timeout = setTimeout(() => {
			if (!resolved) {
				if (checkInterval) {
					clearInterval(checkInterval);
				}
				reject(new Error("Login timed out (5 minutes)."));
			}
		}, 300_000);

		const tryResolve = async () => {
			if (resolved) {
				return;
			}

			try {
				const cookies = await context.cookies(["https://aistudio.xiaomimimo.com"]);
				if (cookies.length === 0) {
					return;
				}

				const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
				console.log(
					`[XiaomiMimo] Found ${cookies.length} cookies: ${cookies.map((c) => c.name).join(", ")}`,
				);

				const tokenCookie = cookies.find(
					(c) =>
						c.name.toLowerCase().includes("token") ||
						c.name.toLowerCase().includes("session") ||
						c.name.toLowerCase().includes("auth") ||
						c.name.toLowerCase().includes("user"),
				);

				if (tokenCookie || capturedToken) {
					const finalToken = capturedToken || tokenCookie?.value || "";
					if (finalToken && cookies.length > 1) {
						resolved = true;
						clearTimeout(timeout);
						if (checkInterval) {
							clearInterval(checkInterval);
						}
						console.log(`[XiaomiMimo] Auth token captured!`);
						resolve({
							cookie: cookieString,
							userAgent,
						});
					}
				} else {
					console.log(`[XiaomiMimo] Waiting for token cookie... (${cookies.length} cookies found)`);
				}
			} catch (e: unknown) {
				console.error(`[XiaomiMimo] Failed to fetch cookies: ${String(e)}`);
			}
		};

		page.on("request", async (request) => {
			const url = request.url();
			if (url.includes("xiaomimimo.com")) {
				const headers = request.headers();
				const auth = headers.authorization || headers.Authorization;
				const cookie = headers.cookie || headers.Cookie;

				if (auth?.startsWith("Bearer ")) {
					if (!capturedToken) {
						console.log(`[XiaomiMimo] Captured Bearer token from request header.`);
						capturedToken = auth.replace("Bearer ", "");
					}
					void tryResolve();
				} else if (cookie) {
					const tokenMatch = cookie.match(/(?:token|session|auth|user)[^=]*=([^;]+)/i);
					if (tokenMatch && !capturedToken) {
						console.log(`[XiaomiMimo] Captured token from cookie header.`);
						capturedToken = tokenMatch[1];
						void tryResolve();
					}
				}
			}
		});

		page.on("response", async (response) => {
			const url = response.url();
			if (url.includes("xiaomimimo.com") && response.ok()) {
				try {
					const ct = response.headers()["content-type"] || "";
					if (ct.includes("application/json")) {
						const text = await response.text().catch(() => "");
						if (text) {
							const tokenMatch = text.match(/(?:token|session|auth|access_token)[^"]*"([^"]+)"/i);
							if (tokenMatch && !capturedToken) {
								console.log(`[XiaomiMimo] Captured token from response body.`);
								capturedToken = tokenMatch[1];
								void tryResolve();
							}
						}
					}
				} catch {}
				void tryResolve();
			}
		});

		page.on("framenavigated", async () => {
			try {
				const storageData = await page.evaluate(() => {
					const data: Record<string, string> = {};
					try {
						for (let i = 0; i < localStorage.length; i++) {
							const key = localStorage.key(i);
							if (key) {
								const val = localStorage.getItem(key);
								if (val) {
									data[key] = val;
								}
							}
						}
					} catch {}
					return data;
				});

				for (const [key, value] of Object.entries(storageData)) {
					const k = key.toLowerCase();
					if (
						k.includes("token") ||
						k.includes("session") ||
						k.includes("auth") ||
						k.includes("user")
					) {
						try {
							const parsed = JSON.parse(value) as {
								token?: string;
								access_token?: string;
								data?: string;
							};
							const token = parsed?.token || parsed?.access_token || parsed?.data || value;
							if (typeof token === "string" && token.length > 10 && !capturedToken) {
								console.log(`[XiaomiMimo] Captured token from localStorage key: ${key}`);
								capturedToken = token;
								void tryResolve();
							}
						} catch {
							if (value.length > 10 && !capturedToken) {
								console.log(`[XiaomiMimo] Captured token from localStorage key: ${key}`);
								capturedToken = value;
								void tryResolve();
							}
						}
					}
				}
			} catch {}
		});

		page.on("close", () => {
			if (checkInterval) {
				clearInterval(checkInterval);
			}
			reject(new Error("Browser window closed before login was captured."));
		});

		checkInterval = setInterval(tryResolve, 2000);
	});
}
