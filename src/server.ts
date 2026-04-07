import { authenticate } from "./auth.ts";
import { BrowserManager } from "./browser/manager.ts";
import { loadConfig } from "./config.ts";
import { handleChatCompletions } from "./openai/chat-completions.ts";
import { listAuthorizedProviders } from "./providers/auth-store.ts";
import { getClientForModel, listAllModels, resolveModelToProvider } from "./providers/registry.ts";

const config = loadConfig();

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(res: Response): Response {
	const headers: Record<string, string> = {};
	res.headers.forEach((v, k) => {
		headers[k] = v;
	});
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers: { ...headers, ...CORS_HEADERS },
	});
}

async function handleRequest(req: Request): Promise<Response> {
	const { pathname } = new URL(req.url);

	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	// Health check is public — no auth required (load balancers, monitoring)
	if (pathname === "/health" || pathname === "/healthz") {
		return withCors(await handleHealthRoute());
	}

	const authError = authenticate(req, config.gatewayApiKey);
	if (authError) return withCors(authError);

	if (pathname === "/v1/chat/completions" && req.method === "POST") {
		return withCors(await handleChatCompletionsRoute(req));
	}

	if (pathname === "/v1/models" && req.method === "GET") {
		return withCors(await handleModelsRoute());
	}

	if (pathname.startsWith("/v1/models/") && req.method === "GET") {
		const modelId = decodeURIComponent(pathname.slice("/v1/models/".length));
		return withCors(await handleModelByIdRoute(modelId));
	}

	return withCors(
		Response.json(
			{
				error: {
					message: `Unknown endpoint: ${req.method} ${pathname}`,
					type: "invalid_request_error",
				},
			},
			{ status: 404 },
		),
	);
}

// ── Route handlers ───────────────────────────────────────────

async function handleHealthRoute(): Promise<Response> {
	const authorized = listAuthorizedProviders();
	const browserHealthy = await BrowserManager.getInstance().isHealthy();
	return Response.json({
		status: browserHealthy ? "ok" : "degraded",
		browser: browserHealthy ? "connected" : "disconnected",
		providers: authorized.length,
		models: (await listAllModels()).length,
	});
}

async function handleChatCompletionsRoute(req: Request): Promise<Response> {
	let body: any;
	try {
		body = await req.json();
	} catch {
		return Response.json(
			{ error: { message: "Invalid JSON body", type: "invalid_request_error" } },
			{ status: 400 },
		);
	}

	const provider = await getClientForModel(body.model || "");
	if (!provider) {
		return Response.json(
			{
				error: {
					message: `No authorized provider found for model "${body.model || ""}". Run 'token-free-gateway webauth' to authorize providers.`,
					type: "invalid_request_error",
				},
			},
			{ status: 404 },
		);
	}

	return handleChatCompletions(body, provider);
}

async function handleModelsRoute(): Promise<Response> {
	const models = await listAllModels();
	const now = Math.floor(Date.now() / 1000);
	const data = await Promise.all(
		models.map(async (m) => ({
			id: m.id,
			object: "model" as const,
			created: now,
			owned_by: (await resolveModelToProvider(m.id)) ?? "web-provider",
		})),
	);
	return Response.json({ object: "list", data });
}

async function handleModelByIdRoute(modelId: string): Promise<Response> {
	const models = await listAllModels();
	const model = models.find((m) => m.id === modelId);
	if (!model) {
		return Response.json(
			{ error: { message: `Model '${modelId}' not found`, type: "invalid_request_error" } },
			{ status: 404 },
		);
	}
	return Response.json({
		id: model.id,
		object: "model",
		created: Math.floor(Date.now() / 1000),
		owned_by: (await resolveModelToProvider(model.id)) ?? "web-provider",
	});
}

// ── Server bootstrap ─────────────────────────────────────────

const server = Bun.serve({ port: config.port, fetch: handleRequest });

const authorized = listAuthorizedProviders();
console.log(`Token-Free Gateway listening on http://localhost:${server.port}`);
console.log(`Auth: ${config.gatewayApiKey ? "enabled (Bearer token)" : "disabled"}`);
console.log(
	`Authorized providers: ${authorized.length > 0 ? authorized.join(", ") : "none — run 'token-free-gateway webauth' to authorize"}`,
);

async function gracefulShutdown(signal: string) {
	console.log(`\nReceived ${signal}, shutting down...`);
	await BrowserManager.getInstance().shutdown();
	server.stop(true);
	process.exit(0);
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

export { server };
