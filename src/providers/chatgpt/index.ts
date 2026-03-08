import type { ProviderDefinition } from "../types.ts";
import { loginChatGPTWeb } from "./auth.ts";
import { ChatGPTWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "chatgpt-web",
	name: "ChatGPT Web",
	models: [],
	factory: (credentials) => new ChatGPTWebClient(credentials as any),
	loginFn: loginChatGPTWeb,
};
