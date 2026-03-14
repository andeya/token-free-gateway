import type { ProviderDefinition } from "../types.ts";
import { loginGlmIntlWeb } from "./auth.ts";
import { GlmIntlWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "glm-intl-web",
	name: "GLM International (Web)",
	models: [
		{ id: "glm-4-plus", name: "GLM-4 Plus" },
		{ id: "glm-4-think", name: "GLM-4 Think" },
	],
	factory: (credentials) => new GlmIntlWebClient(credentials as any),
	loginFn: loginGlmIntlWeb,
};
