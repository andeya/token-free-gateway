import type { ProviderDefinition } from "../types.ts";
import { loginDeepseekWeb } from "./auth.ts";
import { DeepSeekWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "deepseek-web",
	name: "DeepSeek Web",
	models: [],
	factory: (credentials) => new DeepSeekWebClient(credentials as any),
	loginFn: loginDeepseekWeb,
};
