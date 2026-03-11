import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { DoubaoWebAuth } from "./auth.ts";
import { parseDoubaoStream } from "./stream.ts";

export class DoubaoWebClient implements WebProviderClient {
	readonly providerId = "doubao-web";
	constructor(private auth: DoubaoWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("DoubaoWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseDoubaoStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
