import type { ProviderDefinition } from "../types.ts";
import type { QwenWebAuth } from "./auth.ts";
import { loginQwenWeb } from "./auth.ts";
import { QwenWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "qwen-web",
	name: "Qwen Web",
	models: [
		{ id: "qwen3.5-plus", name: "Qwen 3.5 Plus" },
		{ id: "qwen3.5-turbo", name: "Qwen 3.5 Turbo" },
	],
	factory: (credentials) => new QwenWebClient(credentials as QwenWebAuth),
	loginFn: loginQwenWeb,
};
