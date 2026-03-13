import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { GlmWebAuth } from "./auth.ts";
import { parseGlmStream } from "./stream.ts";

export class GlmWebClient implements WebProviderClient {
	readonly providerId = "glm-web";
	constructor(private auth: GlmWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("GlmWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseGlmStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
