import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { QwenWebAuth } from "./auth.ts";
import { parseQwenStream } from "./stream.ts";

export class QwenWebClient implements WebProviderClient {
	readonly providerId = "qwen-web";
	constructor(private auth: QwenWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("QwenWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseQwenStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
