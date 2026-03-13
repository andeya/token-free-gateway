import type { ProviderDefinition } from "../types.ts";
import { loginGlmWeb } from "./auth.ts";
import { GlmWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "glm-web",
	name: "GLM Web",
	models: [],
	factory: (credentials) => new GlmWebClient(credentials as any),
	loginFn: loginGlmWeb,
};
