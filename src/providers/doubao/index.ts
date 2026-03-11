import type { ProviderDefinition } from "../types.ts";
import { loginDoubaoWeb } from "./auth.ts";
import { DoubaoWebClient } from "./client.ts";

export const definition: ProviderDefinition = {
	id: "doubao-web",
	name: "Doubao Web",
	models: [
		{ id: "doubao-seed-2.0", name: "Doubao Seed 2.0 (Web)" },
		{ id: "doubao-pro", name: "Doubao Pro (Web)" },
	],
	factory: (credentials) => new DoubaoWebClient(credentials as any),
	loginFn: loginDoubaoWeb,
};
