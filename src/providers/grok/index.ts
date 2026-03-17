import type { ProviderDefinition } from "../types.ts";
import { loginGrokWeb } from "./auth.ts";
import { GrokWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "grok-web",
	name: "Grok Web",
	models: [],
	factory: (credentials) => new GrokWebClient(credentials as any),
	loginFn: loginGrokWeb,
};
