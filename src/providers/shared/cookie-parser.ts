export interface BrowserCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	secure?: boolean;
}

/**
 * Parse a raw `Cookie` header string into an array of browser-cookie
 * objects suitable for `BrowserManager.addCookies()`.
 *
 * Handles values containing `=` (e.g. base64 tokens) by rejoining
 * everything after the first `=`.  Skips fragments without `=` and
 * entries whose name is empty.  JSON-shaped strings (`{...}`) are
 * rejected early — callers should pre-parse those.
 */
export function parseCookieHeader(cookieStr: string, domain: string): BrowserCookie[] {
	if (!cookieStr?.trim() || cookieStr.startsWith("{")) return [];
	return cookieStr
		.split(";")
		.filter((c) => c.trim().includes("="))
		.map((c) => {
			const [name, ...valueParts] = c.trim().split("=");
			return {
				name: name?.trim() ?? "",
				value: valueParts.join("=").trim(),
				domain,
				path: "/",
			};
		})
		.filter((c) => c.name.length > 0);
}
