import { getCredentials } from "./auth-store.ts";
import type { ModelInfo, ProviderDefinition, WebProviderClient } from "./types.ts";

let _definitions: ProviderDefinition[] | null = null;

	async function loadDefinitions(): Promise<ProviderDefinition[]> {
		if (_definitions) return _definitions;
		const [
			claude,
			chatgpt,
			deepseek,
			doubao,
			gemini,
			glm,
			glmIntl,
		] = await Promise.all([
			import("./claude/index.ts"),
			import("./chatgpt/index.ts"),
			import("./deepseek/index.ts"),
			import("./doubao/index.ts"),
			import("./gemini/index.ts"),
			import("./glm/index.ts"),
			import("./glm-intl/index.ts"),
		]);
		_definitions = [
			claude.definition,
			chatgpt.definition,
			deepseek.definition,
			doubao.definition,
			gemini.definition,
			glm.definition,
			glmIntl.definition,
		];
		return _definitions;
	}

const clientCache = new Map<string, WebProviderClient>();

export async function getProviderClient(providerId: string): Promise<WebProviderClient | null> {
	if (clientCache.has(providerId)) return clientCache.get(providerId)!;
	const creds = getCredentials(providerId);
	if (!creds) return null;
	const defs = await loadDefinitions();
	const def = defs.find((d) => d.id === providerId);
	if (!def) return null;
	const client = def.factory(creds);
	await client.init();
	clientCache.set(providerId, client);
	return client;
}

export async function resolveModelToProvider(model: string): Promise<string | null> {
	const defs = await loadDefinitions();
	if (model.includes("/")) {
		const pid = model.split("/")[0];
		if (defs.some((d) => d.id === pid)) return pid!;
	}
	for (const def of defs) {
		if (def.models.some((m) => m.id === model)) return def.id;
	}
	return null;
}

export async function getClientForModel(model: string): Promise<WebProviderClient | null> {
	const pid = await resolveModelToProvider(model);
	if (!pid) return null;
	return getProviderClient(pid);
}

export async function listAllModels(): Promise<ModelInfo[]> {
	const defs = await loadDefinitions();
	const models: ModelInfo[] = [];
	for (const def of defs) {
		const creds = getCredentials(def.id);
		if (!creds) continue;
		models.push(...def.models);
	}
	return models;
}

export async function listProviderDefinitions(): Promise<ProviderDefinition[]> {
	return loadDefinitions();
}

export function clearProviderCache(providerId: string): void {
	const client = clientCache.get(providerId);
	if (client?.close) client.close();
	clientCache.delete(providerId);
}
