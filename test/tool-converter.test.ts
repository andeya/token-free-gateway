import { describe, expect, test } from "bun:test";
import type { ChatMessage, ToolDefinition } from "../src/openai/types.ts";
import {
	buildPromptFromMessages,
	parseToolResponse,
	resolveEffectiveTools,
} from "../src/tool-calling/converter.ts";

const TOOLS: ToolDefinition[] = [
	{
		type: "function",
		function: {
			name: "exec",
			description: "Run a shell command",
			parameters: {
				type: "object",
				properties: { command: { type: "string" } },
				required: ["command"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "read",
			description: "Read a file",
			parameters: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			},
		},
	},
];

describe("resolveEffectiveTools", () => {
	test("auto returns all tools, no force", () => {
		const result = resolveEffectiveTools(TOOLS, "auto");
		expect(result.tools).toHaveLength(2);
		expect(result.forceUse).toBe(false);
	});

	test("undefined returns all tools, no force", () => {
		const result = resolveEffectiveTools(TOOLS, undefined);
		expect(result.tools).toHaveLength(2);
		expect(result.forceUse).toBe(false);
	});

	test("none returns empty tools", () => {
		const result = resolveEffectiveTools(TOOLS, "none");
		expect(result.tools).toHaveLength(0);
		expect(result.forceUse).toBe(false);
	});

	test("required returns all tools with forceUse", () => {
		const result = resolveEffectiveTools(TOOLS, "required");
		expect(result.tools).toHaveLength(2);
		expect(result.forceUse).toBe(true);
	});

	test("specific function filters to single tool with forceUse", () => {
		const result = resolveEffectiveTools(TOOLS, {
			type: "function",
			function: { name: "exec" },
		});
		expect(result.tools).toHaveLength(1);
		expect(result.tools[0]?.function.name).toBe("exec");
		expect(result.forceUse).toBe(true);
	});

	test("specific function with unknown name returns empty", () => {
		const result = resolveEffectiveTools(TOOLS, {
			type: "function",
			function: { name: "nonexistent" },
		});
		expect(result.tools).toHaveLength(0);
		expect(result.forceUse).toBe(false);
	});
});

describe("buildPromptFromMessages", () => {
	test("builds prompt from simple user message", () => {
		const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];
		const { prompt, hasTools } = buildPromptFromMessages(messages);
		expect(prompt).toContain("Human: Hello");
		expect(hasTools).toBe(false);
	});

	test("injects tool definitions when tools provided", () => {
		const messages: ChatMessage[] = [{ role: "user", content: "List files" }];
		const { prompt, hasTools } = buildPromptFromMessages(messages, TOOLS);
		expect(hasTools).toBe(true);
		expect(prompt).toContain("Available tools:");
		expect(prompt).toContain('"exec"');
		expect(prompt).toContain('"read"');
		expect(prompt).toContain("tool_json");
	});

	test("tool_choice none disables tools", () => {
		const messages: ChatMessage[] = [{ role: "user", content: "List files" }];
		const { prompt, hasTools } = buildPromptFromMessages(messages, TOOLS, "none");
		expect(hasTools).toBe(false);
		expect(prompt).not.toContain("Available tools:");
	});

	test("tool_choice required adds force hint", () => {
		const messages: ChatMessage[] = [{ role: "user", content: "List files" }];
		const { prompt, hasTools } = buildPromptFromMessages(messages, TOOLS, "required");
		expect(hasTools).toBe(true);
		expect(prompt).toContain("MUST use one of the tools");
	});

	test("tool_choice specific function filters tools", () => {
		const messages: ChatMessage[] = [{ role: "user", content: "List files" }];
		const { prompt, hasTools } = buildPromptFromMessages(messages, TOOLS, {
			type: "function",
			function: { name: "exec" },
		});
		expect(hasTools).toBe(true);
		expect(prompt).toContain('"exec"');
		expect(prompt).not.toContain('"read"');
	});

	test("handles system message", () => {
		const messages: ChatMessage[] = [
			{ role: "system", content: "You are a helpful assistant" },
			{ role: "user", content: "Hi" },
		];
		const { prompt } = buildPromptFromMessages(messages);
		expect(prompt).toContain("System: You are a helpful assistant");
		expect(prompt).toContain("Human: Hi");
	});

	test("handles multi-turn tool calling conversation", () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "List files" },
			{
				role: "assistant",
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "exec", arguments: '{"command":"ls"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_1", content: "file1.txt\nfile2.txt" },
		];
		const { prompt } = buildPromptFromMessages(messages, TOOLS);
		expect(prompt).toContain("exec");
		expect(prompt).toContain("<tool_result");
		expect(prompt).toContain("call_1");
		expect(prompt).toContain("file1.txt");
	});

	test("handles tool results without tools (step 4 continuation)", () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "List files" },
			{
				role: "assistant",
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "exec", arguments: '{"command":"ls"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_1", content: "file1.txt\nfile2.txt" },
		];
		// When tools are not re-sent (step 4), still formats correctly
		const { prompt } = buildPromptFromMessages(messages);
		expect(prompt).toContain("file1.txt");
		expect(prompt).toContain("answer");
	});

	test("detects Chinese language and uses CN prompt", () => {
		const messages: ChatMessage[] = [{ role: "user", content: "列出当前目录的文件" }];
		const { prompt } = buildPromptFromMessages(messages, TOOLS);
		expect(prompt).toContain("可用工具:");
	});

	test("handles legacy function role", () => {
		const messages: ChatMessage[] = [
			{ role: "user", content: "Hi" },
			{ role: "function", name: "exec", content: "done" } as any,
		];
		const { prompt } = buildPromptFromMessages(messages);
		expect(prompt).toContain("<tool_result");
		expect(prompt).toContain("done");
	});
});

describe("parseToolResponse", () => {
	test("returns stop for plain text without tools", () => {
		const result = parseToolResponse("Hello, world!", TOOLS);
		expect(result.finishReason).toBe("stop");
		expect(result.content).toBe("Hello, world!");
		expect(result.toolCalls).toBeUndefined();
	});

	test("parses tool_json response into tool_calls", () => {
		const text = '```tool_json\n{"tool":"exec","parameters":{"command":"ls"}}\n```';
		const result = parseToolResponse(text, TOOLS);
		expect(result.finishReason).toBe("tool_calls");
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls?.[0]?.function.name).toBe("exec");
		expect(JSON.parse(result.toolCalls?.[0]?.function.arguments ?? "{}")).toEqual({
			command: "ls",
		});
	});

	test("tool_calls sets content to null (OpenAI standard)", () => {
		const text = '```tool_json\n{"tool":"exec","parameters":{"command":"ls"}}\n```';
		const result = parseToolResponse(text, TOOLS);
		expect(result.content).toBeNull();
	});

	test("tool_call ids use random format", () => {
		const text = '```tool_json\n{"tool":"exec","parameters":{"command":"ls"}}\n```';
		const result = parseToolResponse(text, TOOLS);
		expect(result.toolCalls?.[0]?.id).toMatch(/^call_[a-f0-9]+$/);
	});

	test("ignores tool calls for tools not in the request", () => {
		const text = '```tool_json\n{"tool":"unknown_tool","parameters":{}}\n```';
		const result = parseToolResponse(text, TOOLS);
		expect(result.finishReason).toBe("stop");
		expect(result.toolCalls).toBeUndefined();
	});

	test("returns stop when no tools requested", () => {
		const text = '```tool_json\n{"tool":"exec","parameters":{"command":"ls"}}\n```';
		const result = parseToolResponse(text, undefined);
		expect(result.finishReason).toBe("stop");
		expect(result.content).toBe(text);
	});
});
