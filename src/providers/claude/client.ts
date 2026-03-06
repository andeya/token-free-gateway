import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { ClaudeWebAuth } from "./auth.ts";
import { parseClaudeStream } from "./stream.ts";

export class ClaudeWebClient implements WebProviderClient {
	readonly providerId = "claude-web";
	constructor(private auth: ClaudeWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("ClaudeWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseClaudeStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
