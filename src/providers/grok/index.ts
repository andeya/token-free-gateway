import type { ProviderDefinition } from "../types.ts";
import { loginGrokWeb } from "./auth.ts";
import { GrokWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "grok-web",
	name: "Grok Web",
	models: [
		{ id: "grok-1", name: "Grok 1 (Web)" },
		{ id: "grok-2", name: "Grok 2 (Web)" },
	],
	factory: (credentials) => new GrokWebClient(credentials as any),
	loginFn: loginGrokWeb,
};
