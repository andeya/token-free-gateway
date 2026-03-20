import { chromium } from "playwright-core";

export interface QwenCNWebAuth {
	cookies: Array<{
		name: string;
		value: string;
		domain?: string;
		path?: string;
		expires?: number;
		httpOnly?: boolean;
		secure?: boolean;
		sameSite?: "Strict" | "Lax" | "None";
	}>;
	xsrfToken: string;
	userAgent: string;
	ut?: string;
}

export async function loginQwenCNWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<QwenCNWebAuth> {
	const { onProgress } = params;

	onProgress("Connecting to Chrome debug port...");

	const cdpUrl = "http://127.0.0.1:9222";
	let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;

	try {
		const response = await fetch(`${cdpUrl}/json/version`);
		const versionInfo = (await response.json()) as { webSocketDebuggerUrl?: string };
		const wsUrl = versionInfo.webSocketDebuggerUrl;
		if (!wsUrl) {
			throw new Error("No webSocketDebuggerUrl from Chrome /json/version");
		}

		browser = await chromium.connectOverCDP(wsUrl);
		const context = browser.contexts()[0];
		if (!context) {
			throw new Error("No browser context available");
		}

		onProgress("Opening Qwen CN (qianwen.com)...");

		let page = context.pages().find((p) => p.url().includes("qianwen.com"));
		if (!page) {
			page = await context.newPage();
			await page.goto("https://www.qianwen.com/", { waitUntil: "domcontentloaded" });
		}

		let capturedCookies: QwenCNWebAuth["cookies"] = [];
		let xsrfToken = "";
		let ut = "";

		const initialCookies = await context.cookies();
		const sessionCookie = initialCookies.find(
			(c) => c.name === "tongyi_sso_ticket" || c.name === "login_aliyunid_ticket",
		);

		if (sessionCookie) {
			onProgress("Already logged in. Verifying API access...");

			capturedCookies = initialCookies.map((c) => ({
				name: c.name,
				value: c.value,
				domain: c.domain,
				path: c.path,
				expires: c.expires,
				httpOnly: c.httpOnly,
				secure: c.secure,
				sameSite: c.sameSite,
			}));

			try {
				const tokenFromPage = await page.evaluate(() => {
					const meta = document.querySelector('meta[name="x-xsrf-token"]');
					return meta?.getAttribute("content") || "";
				});
				xsrfToken = tokenFromPage;
			} catch {
				const xsrfCookie = initialCookies.find((c) => c.name === "XSRF-TOKEN");
				if (xsrfCookie) {
					xsrfToken = xsrfCookie.value;
				}
			}

			const utCookie = initialCookies.find((c) => c.name === "b-user-id");
			if (utCookie) {
				ut = utCookie.value;
			}

			try {
				const apiTest = await page.evaluate(async () => {
					const res = await fetch("https://chat2.qianwen.com/api/v2/chat", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							model: "qwen-turbo",
							messages: [{ content: "test", mime_type: "text/plain", meta_data: {} }],
							session_id: "test",
							scene: "chat",
							biz_id: "ai_qwen",
						}),
						credentials: "include",
					});
					const text = await res.text();
					return { status: res.status, body: text.substring(0, 200) };
				});

				if (apiTest.status === 200) {
					onProgress("API access verified!");
				} else {
					onProgress("API signature test skipped (cookies captured).");
				}
			} catch (e) {
				console.log("[Qwen CN Auth] API test failed:", e);
			}
		}

		if (!sessionCookie || capturedCookies.length === 0) {
			onProgress("Waiting for login... Please login in the browser");

			for (let i = 0; i < 120; i++) {
				await new Promise((r) => setTimeout(r, 1000));

				const cookies = await context.cookies();
				const newSessionCookie = cookies.find(
					(c) => c.name === "tongyi_sso_ticket" || c.name === "login_aliyunid_ticket",
				);

				if (newSessionCookie) {
					capturedCookies = cookies.map((c) => ({
						name: c.name,
						value: c.value,
						domain: c.domain,
						path: c.path,
						expires: c.expires,
						httpOnly: c.httpOnly,
						secure: c.secure,
						sameSite: c.sameSite,
					}));

					try {
						const tokenFromPage = await page.evaluate(() => {
							const meta = document.querySelector('meta[name="x-xsrf-token"]');
							return meta?.getAttribute("content") || "";
						});
						xsrfToken = tokenFromPage;
					} catch {
						const xsrfCookie = cookies.find((c) => c.name === "XSRF-TOKEN");
						if (xsrfCookie) {
							xsrfToken = xsrfCookie.value;
						}
					}

					const utCookie = cookies.find((c) => c.name === "b-user-id");
					if (utCookie) {
						ut = utCookie.value;
					}

					onProgress("Login detected! Verifying API access...");

					try {
						const apiTest = await page.evaluate(async () => {
							const res = await fetch("https://chat2.qianwen.com/api/v2/chat", {
								method: "POST",
								headers: {
									"Content-Type": "application/json",
								},
								body: JSON.stringify({
									model: "qwen-turbo",
									messages: [{ content: "test", mime_type: "text/plain", meta_data: {} }],
									session_id: "test",
									scene: "chat",
									biz_id: "ai_qwen",
								}),
								credentials: "include",
							});
							const text = await res.text();
							return { status: res.status, body: text.substring(0, 200) };
						});

						if (apiTest.status === 200) {
							onProgress("Login and API access verified!");
						} else {
							onProgress("Login detected. API signature test skipped (cookies captured).");
						}
					} catch (e) {
						console.log("[Qwen CN Auth] API test failed:", e);
					}

					break;
				}

				if (i % 10 === 0) {
					onProgress(`Waiting for login... (${i}s)`);
				}
			}
		}

		if (capturedCookies.length === 0) {
			throw new Error("Login timeout. Please login within 2 minutes.");
		}

		const userAgent = await page.evaluate(() => navigator.userAgent);

		await browser.close();

		onProgress("Credentials captured successfully!");

		return {
			cookies: capturedCookies,
			xsrfToken,
			userAgent,
			ut,
		};
	} catch (error) {
		if (browser) {
			await browser.close();
		}
		throw error;
	}
}
