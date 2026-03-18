import type { ProviderDefinition } from "../types.ts";
import { loginKimiWeb } from "./auth.ts";
import { KimiWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "kimi-web",
	name: "Kimi Web",
	models: [],
	factory: (credentials) => new KimiWebClient(credentials as any),
	loginFn: loginKimiWeb,
};
