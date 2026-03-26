import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ClaudeWebClient } from "../src/providers/claude/client.ts";

let mockServer: ReturnType<typeof Bun.serve>;
const PORT = 19877;

beforeAll(() => {
	mockServer = Bun.serve({
		port: PORT,
		fetch(req) {
			const url = new URL(req.url);

			if (url.pathname.includes("/organizations")) {
				return Response.json([{ uuid: "org-mock-123" }]);
			}

			if (url.pathname.includes("/chat_conversations") && !url.pathname.includes("/completion")) {
				return Response.json({ uuid: "conv-mock-456" });
			}

			if (url.pathname.includes("/completion")) {
				const encoder = new TextEncoder();
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(
							encoder.encode('data: {"type":"content_block_delta","delta":{"text":"Mock "}}\n\n'),
						);
						controller.enqueue(
							encoder.encode(
								'data: {"type":"content_block_delta","delta":{"text":"response"}}\n\n',
							),
						);
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
	mockServer.stop();
});

describe("ClaudeWebClient", () => {
	test("constructs with session key", () => {
		const client = new ClaudeWebClient({
			sessionKey: "sk-ant-sid01-test",
			cookie: "",
			userAgent: "",
		});
		expect(client).toBeDefined();
	});

	test("constructs with full cookie", () => {
		const client = new ClaudeWebClient({
			sessionKey: "sk-ant-sid01-test",
			cookie: "sessionKey=sk-ant-sid01-test; anthropic-device-id=device123",
			userAgent: "Mozilla/5.0",
		});
		expect(client).toBeDefined();
	});

	test("listModels returns model list", () => {
		const client = new ClaudeWebClient({ sessionKey: "test", cookie: "", userAgent: "" });
		const models = client.listModels();
		expect(models.length).toBeGreaterThan(0);
		expect(models[0]?.id).toBeDefined();
		expect(models[0]?.name).toBeDefined();
	});

	test("providerId is claude-web", () => {
		const client = new ClaudeWebClient({ sessionKey: "test", cookie: "", userAgent: "" });
		expect(client.providerId).toBe("claude-web");
	});
});
