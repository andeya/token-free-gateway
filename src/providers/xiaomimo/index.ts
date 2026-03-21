import type { ProviderDefinition } from "../types.ts";
import { loginXiaomiMimoWeb } from "./auth.ts";
import { XiaomiMimoWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "xiaomimo-web",
	name: "Xiaomimo Web",
	models: [],
	factory: (credentials) => new XiaomiMimoWebClient(credentials as any),
	loginFn: loginXiaomiMimoWeb,
};
