import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { GlmIntlWebAuth } from "./auth.ts";
import { parseGlmIntlStream } from "./stream.ts";

export class GlmIntlWebClient implements WebProviderClient {
	readonly providerId = "glm-intl-web";
	constructor(private auth: GlmIntlWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("GlmIntlWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseGlmIntlStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
