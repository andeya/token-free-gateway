import type { ProviderDefinition } from "../types.ts";
import { loginGlmWeb } from "./auth.ts";
import { GlmWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "glm-web",
	name: "ChatGLM (Web)",
	models: [{ id: "glm-4-plus", name: "GLM-4 Plus" }],
	factory: (credentials) => new GlmWebClient(credentials as any),
	loginFn: loginGlmWeb,
};
