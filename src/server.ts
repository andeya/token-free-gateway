import { authenticate } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { handleChatCompletions } from "./openai/chat-completions.ts";
import { listAuthorizedProviders } from "./providers/auth-store.ts";
import { getClientForModel, listAllModels, resolveModelToProvider } from "./providers/registry.ts";
import type { WebProviderClient } from "./providers/types.ts";

const config = loadConfig();

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(res: Response): Response {
	const merged: Record<string, string> = {};
	res.headers.forEach((v, k) => {
		merged[k] = v;
	});
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers: { ...merged, ...CORS_HEADERS },
	});
}

async function resolveProvider(body: { model?: string }): Promise<WebProviderClient | null> {
	const model = body.model || "";
	return getClientForModel(model);
}

async function handleRequest(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const { pathname } = url;

	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
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

	if (pathname === "/health" || pathname === "/healthz") {
		const authorized = listAuthorizedProviders();
		return withCors(
			Response.json({
				status: "ok",
				providers: authorized.length,
				models: (await listAllModels()).length,
			}),
		);
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

async function handleChatCompletionsRoute(req: Request): Promise<Response> {
	let body: any;
	try {
		body = await req.clone().json();
	} catch {
		return Response.json(
			{ error: { message: "Invalid JSON body", type: "invalid_request_error" } },
			{ status: 400 },
		);
	}

	const provider = await resolveProvider(body);
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

	return handleChatCompletions(req, provider);
}

async function handleModelsRoute(): Promise<Response> {
	const models = await listAllModels();
	const now = Math.floor(Date.now() / 1000);
	const data = await Promise.all(
		models.map(async (m) => {
			const providerId = await resolveModelToProvider(m.id);
			return {
				id: m.id,
				object: "model" as const,
				created: now,
				owned_by: providerId ?? "web-provider",
			};
		}),
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
	const providerId = await resolveModelToProvider(model.id);
	return Response.json({
		id: model.id,
		object: "model",
		created: Math.floor(Date.now() / 1000),
		owned_by: providerId ?? "web-provider",
	});
}

const server = Bun.serve({
	port: config.port,
	fetch: handleRequest,
});

const authorized = listAuthorizedProviders();
console.log(`Token-Free Gateway listening on http://localhost:${server.port}`);
console.log(`Auth: ${config.gatewayApiKey ? "enabled (Bearer token)" : "disabled"}`);
console.log(
	`Authorized providers: ${authorized.length > 0 ? authorized.join(", ") : "none — run 'token-free-gateway webauth' to authorize"}`,
);

export { server };
