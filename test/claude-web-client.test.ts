import { describe, expect, test } from "bun:test";
import { ClaudeWebClient } from "../src/providers/claude/client.ts";

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
