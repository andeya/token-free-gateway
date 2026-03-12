import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { GeminiWebAuth } from "./auth.ts";
import { parseGeminiStream } from "./stream.ts";

export class GeminiWebClient implements WebProviderClient {
	readonly providerId = "gemini-web";
	constructor(private auth: GeminiWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("GeminiWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseGeminiStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
