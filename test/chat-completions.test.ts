import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../src/openai/types.ts";
import { parseClaudeStream } from "../src/providers/claude/stream.ts";

let server: ReturnType<typeof Bun.serve>;
const PORT = 19876;

beforeAll(async () => {
	server = Bun.serve({
		port: PORT,
		fetch(req) {
			const url = new URL(req.url);

			if (url.pathname.includes("/organizations")) {
				return Response.json([{ uuid: "org-test-123" }]);
			}

			if (url.pathname.includes("/chat_conversations") && !url.pathname.includes("/completion")) {
				return Response.json({ uuid: "conv-test-123" });
			}

			if (url.pathname.includes("/completion")) {
				const encoder = new TextEncoder();
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(
							encoder.encode(
								'data: {"type":"content_block_delta","delta":{"text":"Hello from Claude!"}}\n\n',
							),
						);
						controller.enqueue(encoder.encode("data: [DONE]\n\n"));
						controller.close();
					},
				});
				return new Response(stream, {
					headers: { "Content-Type": "text/event-stream" },
				});
			}

			return new Response("Not found", { status: 404 });
		},
	});
});

afterAll(() => {
	server.stop();
});

function createMockClient(responseText: string) {
	return {
		providerId: "test-provider",
		init: async () => {},
		sendMessage: async () => {
			const encoder = new TextEncoder();
			const sseData = JSON.stringify({
				type: "content_block_delta",
				delta: { text: responseText },
			});
			return new ReadableStream({
				start(controller) {
					controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
					controller.close();
				},
			});
		},
		parseStream: async (body: ReadableStream<Uint8Array>, onDelta?: (d: string) => void) =>
			parseClaudeStream(body, onDelta),
		listModels: () => [{ id: "test-model", name: "Test" }],
	};
}

describe("chat completions handler (unit)", () => {
	test("rejects empty messages", async () => {
		const { handleChatCompletions } = await import("../src/openai/chat-completions.ts");
		const client = createMockClient("Hello");

		const req = new Request("http://localhost/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ model: "test", messages: [] }),
			headers: { "Content-Type": "application/json" },
		});

		const res = await handleChatCompletions(req, client as any);
		expect(res.status).toBe(400);

		const body = (await res.json()) as { error: { message: string } };
		expect(body.error.message).toContain("messages");
	});

	test("rejects invalid JSON body", async () => {
		const { handleChatCompletions } = await import("../src/openai/chat-completions.ts");
		const client = createMockClient("Hello");

		const req = new Request("http://localhost/v1/chat/completions", {
			method: "POST",
			body: "not json",
			headers: { "Content-Type": "application/json" },
		});

		const res = await handleChatCompletions(req, client as any);
		expect(res.status).toBe(400);
	});
});

describe("chat completions response format", () => {
	test("non-streaming response has correct OpenAI shape", async () => {
		const { handleChatCompletions } = await import("../src/openai/chat-completions.ts");
		const mockClient = createMockClient("Test response");

		const req = new Request("http://localhost/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: "test-model",
				messages: [{ role: "user", content: "Hi" }],
			} satisfies ChatCompletionRequest),
			headers: { "Content-Type": "application/json" },
		});

		const res = await handleChatCompletions(req, mockClient as any);
		expect(res.status).toBe(200);

		const body = (await res.json()) as ChatCompletionResponse;
		expect(body.object).toBe("chat.completion");
		expect(body.id).toMatch(/^chatcmpl-/);
		expect(body.system_fingerprint).toBeDefined();
		expect(body.choices).toHaveLength(1);
		expect(body.choices[0]?.message.role).toBe("assistant");
		expect(body.choices[0]?.finish_reason).toBe("stop");
		expect(body.usage).toBeDefined();
		expect(body.usage.prompt_tokens).toBeGreaterThan(0);
		expect(body.usage.total_tokens).toBeGreaterThan(0);
	});

	test("streaming response produces valid SSE", async () => {
		const { handleChatCompletions } = await import("../src/openai/chat-completions.ts");
		const mockClient = createMockClient("Streamed!");

		const req = new Request("http://localhost/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: "test",
				messages: [{ role: "user", content: "Hi" }],
				stream: true,
			} satisfies ChatCompletionRequest),
			headers: { "Content-Type": "application/json" },
		});

		const res = await handleChatCompletions(req, mockClient as any);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/event-stream");

		const text = await res.text();
		expect(text).toContain("data: ");
		expect(text).toContain('"chat.completion.chunk"');
		expect(text).toContain("[DONE]");
	});

	test("tool_calls response has correct shape", async () => {
		const { handleChatCompletions } = await import("../src/openai/chat-completions.ts");
		const toolResponse = '```tool_json\n{"tool":"exec","parameters":{"command":"ls"}}\n```';
		const mockClient = createMockClient(toolResponse);

		const req = new Request("http://localhost/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: "test",
				messages: [{ role: "user", content: "List files" }],
				tools: [
					{
						type: "function",
						function: {
							name: "exec",
							description: "Run command",
							parameters: { type: "object", properties: { command: { type: "string" } } },
						},
					},
				],
			} satisfies ChatCompletionRequest),
			headers: { "Content-Type": "application/json" },
		});

		const res = await handleChatCompletions(req, mockClient as any);
		expect(res.status).toBe(200);

		const body = (await res.json()) as ChatCompletionResponse;
		expect(body.choices[0]?.finish_reason).toBe("tool_calls");
		expect(body.choices[0]?.message.content).toBeNull();
		expect(body.choices[0]?.message.tool_calls).toHaveLength(1);
		expect(body.choices[0]?.message.tool_calls?.[0]?.type).toBe("function");
		expect(body.choices[0]?.message.tool_calls?.[0]?.id).toMatch(/^call_/);
		expect(body.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("exec");
	});

	test("multi-turn tool flow (step 4: tool result → final answer)", async () => {
		const { handleChatCompletions } = await import("../src/openai/chat-completions.ts");
		const mockClient = createMockClient("The directory contains file1.txt and file2.txt.");

		const req = new Request("http://localhost/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: "test",
				messages: [
					{ role: "user", content: "List files" },
					{
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_abc123",
								type: "function",
								function: { name: "exec", arguments: '{"command":"ls"}' },
							},
						],
					},
					{
						role: "tool",
						tool_call_id: "call_abc123",
						content: "file1.txt\nfile2.txt",
					},
				],
			} satisfies ChatCompletionRequest),
			headers: { "Content-Type": "application/json" },
		});

		const res = await handleChatCompletions(req, mockClient as any);
		expect(res.status).toBe(200);

		const body = (await res.json()) as ChatCompletionResponse;
		expect(body.choices[0]?.finish_reason).toBe("stop");
		expect(body.choices[0]?.message.content).toContain("file1.txt");
		expect(body.choices[0]?.message.tool_calls).toBeUndefined();
	});
});
