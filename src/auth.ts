/**
 * Simple Bearer token authentication.
 * If GATEWAY_API_KEY is not set, all requests are allowed.
 */
export function authenticate(req: Request, apiKey: string | undefined): Response | null {
	if (!apiKey) return null;

	const auth = req.headers.get("authorization") ?? "";
	if (!auth.toLowerCase().startsWith("bearer ")) {
		return Response.json(
			{ error: { message: "Unauthorized", type: "unauthorized" } },
			{ status: 401 },
		);
	}

	const token = auth.slice(7).trim();
	if (token !== apiKey) {
		return Response.json(
			{ error: { message: "Unauthorized", type: "unauthorized" } },
			{ status: 401 },
		);
	}

	return null;
}
