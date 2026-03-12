import type { ProviderDefinition } from "../types.ts";
import { loginGeminiWeb } from "./auth.ts";
import { GeminiWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "gemini-web",
	name: "Gemini Web",
	models: [],
	factory: (credentials) => new GeminiWebClient(credentials as any),
	loginFn: loginGeminiWeb,
};
