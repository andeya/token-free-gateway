import type { ProviderDefinition } from "../types.ts";
import type { QwenCNWebAuth } from "./auth.ts";
import { loginQwenCNWeb } from "./auth.ts";
import { QwenCNWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "qwen-cn-web",
	name: "Qwen CN Web",
	models: [
		{ id: "Qwen3.5-Plus", name: "Qwen 3.5 Plus (CN)" },
		{ id: "Qwen3.5-Turbo", name: "Qwen 3.5 Turbo (CN)" },
	],
	factory: (credentials) => new QwenCNWebClient(credentials as QwenCNWebAuth),
	loginFn: loginQwenCNWeb,
};
