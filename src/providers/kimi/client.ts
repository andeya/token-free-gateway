import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { KimiWebAuth } from "./auth.ts";
import { parseKimiStream } from "./stream.ts";

export class KimiWebClient implements WebProviderClient {
	readonly providerId = "kimi-web";
	constructor(private auth: KimiWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("KimiWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseKimiStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
