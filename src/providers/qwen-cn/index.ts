import type { ProviderDefinition } from "../types.ts";
import { loginQwenCNWeb } from "./auth.ts";
import { QwenCNWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "qwen-cn-web",
	name: "Qwen CN Web",
	models: [],
	factory: (credentials) => new QwenCNWebClient(credentials as any),
	loginFn: loginQwenCNWeb,
};
