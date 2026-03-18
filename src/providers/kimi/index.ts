import type { ProviderDefinition } from "../types.ts";
import { loginKimiWeb } from "./auth.ts";
import { KimiWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "kimi-web",
	name: "Kimi (Web)",
	models: [
		{ id: "moonshot-v1-8k", name: "Moonshot v1 8K" },
		{ id: "moonshot-v1-32k", name: "Moonshot v1 32K" },
		{ id: "moonshot-v1-128k", name: "Moonshot v1 128K" },
	],
	factory: (credentials) => new KimiWebClient(credentials as any),
	loginFn: loginKimiWeb,
};
