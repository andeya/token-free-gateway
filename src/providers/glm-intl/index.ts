import type { ProviderDefinition } from "../types.ts";
import { loginGlmIntlWeb } from "./auth.ts";
import { GlmIntlWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "glm-intl-web",
	name: "GLM Intl Web",
	models: [],
	factory: (credentials) => new GlmIntlWebClient(credentials as any),
	loginFn: loginGlmIntlWeb,
};
