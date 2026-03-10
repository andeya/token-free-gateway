import type { ProviderDefinition } from "../types.ts";
import type { DeepSeekWebCredentials } from "./auth.ts";
import { loginDeepseekWeb } from "./auth.ts";
import { DeepSeekWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "deepseek-web",
	name: "DeepSeek Web",
	models: [
		{ id: "deepseek-chat", name: "DeepSeek Chat" },
		{ id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
	],
	factory: (credentials) => new DeepSeekWebClient(credentials as DeepSeekWebCredentials),
	loginFn: loginDeepseekWeb,
};
