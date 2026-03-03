import type { ChatCompletionChunk, ChunkChoice } from "./types.ts";

export function sseHeaders(): Record<string, string> {
	return {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	};
}

export function sseEvent(data: string): string {
	return `data: ${data}\n\n`;
}

export function sseDone(): string {
	return "data: [DONE]\n\n";
}

export function makeChunk(id: string, model: string, choices: ChunkChoice[]): ChatCompletionChunk {
	return {
		id,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model,
		choices,
	};
}
