import type { ProviderDefinition } from "../types.ts";
import { loginQwenWeb } from "./auth.ts";
import { QwenWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "qwen-web",
	name: "Qwen Web",
	models: [],
	factory: (credentials) => new QwenWebClient(credentials as any),
	loginFn: loginQwenWeb,
};
