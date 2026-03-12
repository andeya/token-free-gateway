import type { ProviderDefinition } from "../types.ts";
import { loginGeminiWeb } from "./auth.ts";
import { GeminiWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "gemini-web",
	name: "Gemini Web",
	models: [
		{ id: "gemini-pro", name: "Gemini Pro (Web)" },
		{ id: "gemini-ultra", name: "Gemini Ultra (Web)" },
	],
	factory: (credentials) => new GeminiWebClient(credentials as any),
	loginFn: loginGeminiWeb,
};
