import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { GrokWebAuth } from "./auth.ts";
import { parseGrokStream } from "./stream.ts";

export class GrokWebClient implements WebProviderClient {
	readonly providerId = "grok-web";
	constructor(private auth: GrokWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("GrokWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseGrokStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
