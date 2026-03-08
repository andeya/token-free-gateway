import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { ChatGPTWebAuth } from "./auth.ts";
import { parseChatGPTStream } from "./stream.ts";

export class ChatGPTWebClient implements WebProviderClient {
	readonly providerId = "chatgpt-web";
	constructor(private auth: ChatGPTWebAuth) {}
	async init(): Promise<void> {}
	async sendMessage(p: { message: string; model?: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
		throw new Error("ChatGPTWebClient.sendMessage: not yet implemented");
	}
	async parseStream(body: ReadableStream<Uint8Array>, onDelta?: (delta: string) => void): Promise<StreamResult> {
		return parseChatGPTStream(body, onDelta);
	}
	listModels(): ModelInfo[] { return []; }
}
