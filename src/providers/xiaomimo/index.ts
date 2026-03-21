import type { ProviderDefinition } from "../types.ts";
import type { XiaomiMimoWebAuth } from "./auth.ts";
import { loginXiaomiMimoWeb } from "./auth.ts";
import { XiaomiMimoWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "xiaomimo-web",
	name: "Xiaomi MiMo Web",
	models: [{ id: "xiaomimo-chat", name: "MiMo Chat" }],
	factory: (credentials) => new XiaomiMimoWebClient(credentials as XiaomiMimoWebAuth),
	loginFn: loginXiaomiMimoWeb,
};
