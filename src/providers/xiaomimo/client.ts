import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { XiaomiMimoWebAuth } from "./auth.ts";
import { parseXiaomiMimoStream } from "./stream.ts";

export class XiaomiMimoWebClient implements WebProviderClient {
	readonly providerId = "xiaomimo-web";
	constructor(private auth: XiaomiMimoWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("XiaomiMimoWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseXiaomiMimoStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
