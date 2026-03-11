import type { ProviderDefinition } from "../types.ts";
import { loginDoubaoWeb } from "./auth.ts";
import { DoubaoWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "doubao-web",
	name: "Doubao Web",
	models: [],
	factory: (credentials) => new DoubaoWebClient(credentials as any),
	loginFn: loginDoubaoWeb,
};
