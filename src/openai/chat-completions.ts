import type { WebProviderClient } from "../providers/types.ts";
import { buildPromptFromMessages, parseToolResponse } from "../tool-calling/converter.ts";
import { makeChunk, sseDone, sseEvent, sseHeaders } from "./sse.ts";
import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
	ToolCallDelta,
	ToolCallOutput,
} from "./types.ts";

function generateId(): string {
	return `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export async function handleChatCompletions(
	body: ChatCompletionRequest,
	client: WebProviderClient,
): Promise<Response> {
	if (!body.messages || body.messages.length === 0) {
		return jsonError("messages is required and must not be empty", 400);
	}

	if (!body.model) {
		return jsonError("model is required", 400);
	}

	const id = generateId();
	const model = body.model;
	const { prompt, hasTools } = buildPromptFromMessages(body.messages, body.tools, body.tool_choice);

	if (!prompt) {
		return jsonError("Could not construct prompt from messages", 400);
	}

	if (body.stream) {
		return handleStreaming(id, model, prompt, hasTools, body, client);
	}
	return handleNonStreaming(id, model, prompt, hasTools, body, client);
}

async function handleNonStreaming(
	id: string,
	model: string,
	prompt: string,
	hasTools: boolean,
	body: ChatCompletionRequest,
	client: WebProviderClient,
): Promise<Response> {
	try {
		const stream = await client.sendMessage({ message: prompt, model });
		const result = await client.parseStream(stream);

		const { content, toolCalls, finishReason } = hasTools
			? parseToolResponse(result.text, body.tools)
			: { content: result.text, toolCalls: undefined, finishReason: "stop" as const };

		const promptTokens = estimateTokens(prompt);
		const completionTokens = estimateTokens(result.text);

		const response: ChatCompletionResponse = {
			id,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model,
			system_fingerprint: `fp_${id.slice(-12)}`,
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content,
						...(toolCalls ? { tool_calls: toolCalls } : {}),
					},
					finish_reason: finishReason,
				},
			],
			usage: {
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				total_tokens: promptTokens + completionTokens,
			},
		};

		return Response.json(response);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[chat-completions] Error: ${message}`);
		return jsonError(message, 502);
	}
}

// ---- Streaming helpers ----

type SseWriter = {
	writeChunk(id: string, model: string, choices: Parameters<typeof makeChunk>[2]): void;
	done(): void;
	error(message: string): void;
	close(): void;
};

function createSseWriter(controller: ReadableStreamDefaultController<Uint8Array>): SseWriter {
	const encoder = new TextEncoder();
	const emit = (data: string) => controller.enqueue(encoder.encode(data));
	return {
		writeChunk(id, model, choices) {
			emit(sseEvent(JSON.stringify(makeChunk(id, model, choices))));
		},
		done() {
			emit(sseDone());
		},
		error(message: string) {
			emit(sseEvent(JSON.stringify({ error: { message, type: "server_error" } })));
		},
		close() {
			controller.close();
		},
	};
}

function emitToolCallDeltas(w: SseWriter, id: string, model: string, toolCalls: ToolCallOutput[]) {
	for (let i = 0; i < toolCalls.length; i++) {
		const tc = toolCalls[i];
		if (!tc) continue;
		const tcStart: ToolCallDelta = {
			index: i,
			id: tc.id,
			type: "function",
			function: { name: tc.function.name, arguments: "" },
		};
		w.writeChunk(id, model, [{ index: 0, delta: { tool_calls: [tcStart] }, finish_reason: null }]);
		const tcArgs: ToolCallDelta = {
			index: i,
			function: { arguments: tc.function.arguments },
		};
		w.writeChunk(id, model, [{ index: 0, delta: { tool_calls: [tcArgs] }, finish_reason: null }]);
	}
}

async function handleStreaming(
	id: string,
	model: string,
	prompt: string,
	hasTools: boolean,
	body: ChatCompletionRequest,
	client: WebProviderClient,
): Promise<Response> {
	const readable = new ReadableStream({
		async start(controller) {
			const w = createSseWriter(controller);
			try {
				const claudeStream = await client.sendMessage({ message: prompt, model });
				w.writeChunk(id, model, [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]);

				if (!hasTools) {
					await streamWithoutTools(w, id, model, claudeStream, client);
				} else {
					await streamWithTools(w, id, model, claudeStream, body, client);
				}

				w.done();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[chat-completions] Stream error: ${message}`);
				w.error(message);
				w.done();
			}
			w.close();
		},
	});

	return new Response(readable, { headers: sseHeaders() });
}

async function streamWithoutTools(
	w: SseWriter,
	id: string,
	model: string,
	providerStream: ReadableStream<Uint8Array>,
	client: WebProviderClient,
) {
	await client.parseStream(providerStream, (delta) => {
		w.writeChunk(id, model, [{ index: 0, delta: { content: delta }, finish_reason: null }]);
	});
	w.writeChunk(id, model, [{ index: 0, delta: {}, finish_reason: "stop" }]);
}

async function streamWithTools(
	w: SseWriter,
	id: string,
	model: string,
	providerStream: ReadableStream<Uint8Array>,
	body: ChatCompletionRequest,
	client: WebProviderClient,
) {
	const result = await client.parseStream(providerStream);
	const { content, toolCalls, finishReason } = parseToolResponse(result.text, body.tools);

	if (finishReason === "tool_calls" && toolCalls) {
		emitToolCallDeltas(w, id, model, toolCalls);
		w.writeChunk(id, model, [{ index: 0, delta: {}, finish_reason: "tool_calls" }]);
	} else {
		if (content) {
			w.writeChunk(id, model, [{ index: 0, delta: { content }, finish_reason: null }]);
		}
		w.writeChunk(id, model, [{ index: 0, delta: {}, finish_reason: "stop" }]);
	}
}

function jsonError(message: string, status: number): Response {
	return Response.json({ error: { message, type: "invalid_request_error" } }, { status });
}
