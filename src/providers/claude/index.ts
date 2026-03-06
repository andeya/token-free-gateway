import type { ProviderDefinition } from "../types.ts";
import { loginClaudeWeb } from "./auth.ts";
import { ClaudeWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "claude-web",
	name: "Claude Web",
	models: [
		{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
		{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
		{ id: "claude-opus-4-20250514", name: "Claude Opus 4" },
		{ id: "claude-opus-4-6", name: "Claude Opus 4.6" },
		{ id: "claude-haiku-4-20250514", name: "Claude Haiku 4" },
		{ id: "claude-haiku-4-6", name: "Claude Haiku 4.6" },
	],
	factory: (credentials) => new ClaudeWebClient(credentials as any),
	loginFn: loginClaudeWeb,
};
