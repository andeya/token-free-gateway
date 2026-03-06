import type { ProviderDefinition } from "../types.ts";
import { loginClaudeWeb } from "./auth.ts";
import { ClaudeWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "claude-web",
	name: "Claude Web",
	models: [],
	factory: (credentials) => new ClaudeWebClient(credentials as any),
	loginFn: loginClaudeWeb,
};
