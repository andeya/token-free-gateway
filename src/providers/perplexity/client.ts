import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { PerplexityWebAuth } from "./auth.ts";
import { parsePerplexityStream } from "./stream.ts";

export class PerplexityWebClient implements WebProviderClient {
	readonly providerId = "perplexity-web";
	constructor(private auth: PerplexityWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("PerplexityWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parsePerplexityStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
