import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { DeepSeekWebCredentials } from "./auth.ts";
import { parseDeepSeekStream } from "./stream.ts";

export class DeepSeekWebClient implements WebProviderClient {
	readonly providerId = "deepseek-web";
	constructor(private auth: DeepSeekWebCredentials) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("DeepSeekWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseDeepSeekStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
