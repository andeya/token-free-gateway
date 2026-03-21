import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { QwenCNWebAuth } from "./auth.ts";
import { parseQwenCnStream } from "./stream.ts";

export class QwenCNWebClient implements WebProviderClient {
	readonly providerId = "qwen-cn-web";
	constructor(private auth: QwenCNWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("QwenCNWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseQwenCnStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
