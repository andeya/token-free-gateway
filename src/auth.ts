const UNAUTHORIZED = Response.json(
	{ error: { message: "Unauthorized", type: "unauthorized" } },
	{ status: 401 },
);

/**
 * Simple Bearer token authentication.
 * If TFG_API_KEY / config.apiKey is not set, all requests are allowed.
 */
export function authenticate(req: Request, apiKey: string | undefined): Response | null {
	if (!apiKey) return null;
	const auth = req.headers.get("authorization") ?? "";
	if (!auth.toLowerCase().startsWith("bearer ") || auth.slice(7).trim() !== apiKey) {
		return UNAUTHORIZED.clone();
	}
	return null;
}
