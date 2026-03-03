/**
 * Minimal CDP (Chrome DevTools Protocol) helpers for connecting to Chrome debug port.
 * Extracted from openclaw-zero-token extensions/browser/src/browser/cdp.helpers.ts
 * and chrome.ts — only the essentials needed for webauth flows.
 */

/**
 * Build HTTP headers, injecting Basic auth when URL contains credentials.
 */
export function getHeadersWithAuth(
	url: string,
	headers: Record<string, string> = {},
): Record<string, string> {
	const merged = { ...headers };
	try {
		const parsed = new URL(url);
		const hasAuth = Object.keys(merged).some((k) => k.toLowerCase() === "authorization");
		if (hasAuth) return merged;
		if (parsed.username || parsed.password) {
			const basic = btoa(`${parsed.username}:${parsed.password}`);
			return { ...merged, Authorization: `Basic ${basic}` };
		}
	} catch {
		// ignore
	}
	return merged;
}

interface ChromeVersionInfo {
	webSocketDebuggerUrl?: string;
	Browser?: string;
	"User-Agent"?: string;
}

/**
 * Discover the Chrome DevTools WebSocket URL via the `/json/version` HTTP endpoint.
 * Returns null if Chrome is unreachable or doesn't expose the debugger URL.
 */
export async function getChromeWebSocketUrl(
	cdpUrl: string,
	timeoutMs = 5000,
): Promise<string | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const versionUrl = `${cdpUrl.replace(/\/$/, "")}/json/version`;
		const headers = getHeadersWithAuth(cdpUrl);
		const res = await fetch(versionUrl, { headers, signal: controller.signal });
		if (!res.ok) return null;
		const data = (await res.json()) as ChromeVersionInfo;
		const wsUrl = data.webSocketDebuggerUrl?.trim();
		if (!wsUrl) return null;
		// Normalize: Docker/browserless may return 0.0.0.0 or :: — replace with loopback
		return wsUrl.replace(/ws:\/\/(0\.0\.0\.0|::)/, "ws://127.0.0.1");
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Get the default CDP URL from environment or fallback.
 */
export function getDefaultCdpUrl(): string {
	return process.env.CDP_URL || "http://127.0.0.1:9222";
}
