/**
 * Converts between OpenAI tool protocol and Claude Web text-based tool calling.
 *
 * Flow:
 * 1. buildPromptFromMessages: Converts OpenAI tools + messages into a single prompt
 * 2. parseToolResponse: Parses Claude's text response into OpenAI tool_calls format
 * 3. applyToolChoice: Enforces tool_choice semantics on both prompt and response
 */

import type {
	AssistantMessage,
	ChatMessage,
	ToolCallOutput,
	ToolChoice,
	ToolDefinition,
	ToolMessage,
} from "../openai/types.ts";
import { extractToolCalls, hasToolCall } from "./parser.ts";
import { buildToolPrompt, detectLanguage } from "./prompt.ts";

export interface ConvertedPrompt {
	prompt: string;
	/** Whether tools are active after applying tool_choice */
	hasTools: boolean;
}

function detectLang(messages: ChatMessage[]): "en" | "cn" {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role === "user") {
			const text = typeof msg.content === "string" ? msg.content : "";
			return detectLanguage(text);
		}
	}
	return "en";
}

function extractTextContent(content: string | { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((p) => p.type === "text")
		.map((p) => p.text ?? "")
		.join("");
}

function formatAssistantMsg(msg: AssistantMessage): string | null {
	if (msg.tool_calls && msg.tool_calls.length > 0) {
		const calls = msg.tool_calls.map(
			(tc) =>
				`\`\`\`tool_json\n{"tool":"${tc.function.name}","parameters":${tc.function.arguments}}\n\`\`\``,
		);
		return `Assistant: [Called tools]\n${calls.join("\n")}`;
	}
	return msg.content ? `Assistant: ${msg.content}` : null;
}

function formatToolResult(msg: ToolMessage): string {
	return [`<tool_result tool_call_id="${msg.tool_call_id}">`, msg.content, "</tool_result>"].join(
		"\n",
	);
}

function formatMessage(msg: ChatMessage): string | null {
	switch (msg.role) {
		case "system":
		case "developer":
			return `System: ${msg.content}`;

		case "user":
			return `Human: ${extractTextContent(msg.content)}`;

		case "assistant":
			return formatAssistantMsg(msg as AssistantMessage);

		case "tool":
			return formatToolResult(msg as ToolMessage);

		// Legacy OpenAI "function" role → treat same as "tool"
		default: {
			const legacy = msg as any;
			if (legacy.role === "function" && typeof legacy.content === "string") {
				return formatToolResult({
					role: "tool",
					tool_call_id: legacy.name ?? "unknown",
					content: legacy.content,
				});
			}
			return null;
		}
	}
}

/**
 * Resolve effective tools list based on tool_choice.
 *
 * - "none" → no tools (empty list)
 * - "auto" / undefined → all tools
 * - "required" → all tools + force hint
 * - { function: { name } } → single specified tool only
 */
export function resolveEffectiveTools(
	tools: ToolDefinition[] | undefined,
	toolChoice: ToolChoice | undefined,
): { tools: ToolDefinition[]; forceUse: boolean } {
	if (!tools || tools.length === 0) return { tools: [], forceUse: false };

	if (toolChoice === "none") return { tools: [], forceUse: false };

	if (toolChoice === "required") return { tools, forceUse: true };

	if (typeof toolChoice === "object" && toolChoice.type === "function") {
		const target = toolChoice.function.name;
		const filtered = tools.filter((t) => t.function.name === target);
		return { tools: filtered, forceUse: filtered.length > 0 };
	}

	// "auto" or undefined
	return { tools, forceUse: false };
}

/**
 * Build a single prompt string from OpenAI messages + tools for Claude Web.
 */
export function buildPromptFromMessages(
	messages: ChatMessage[],
	tools?: ToolDefinition[],
	toolChoice?: ToolChoice,
): ConvertedPrompt {
	const effective = resolveEffectiveTools(tools, toolChoice);
	const hasTools = effective.tools.length > 0;
	const parts: string[] = [];
	const lang = detectLang(messages);

	if (hasTools) {
		parts.push(buildToolPrompt(effective.tools, lang, effective.forceUse));
	}

	for (const msg of messages) {
		const formatted = formatMessage(msg);
		if (formatted) parts.push(formatted);
	}

	// When the last message contains tool results, add a continuation hint
	const lastMsg = messages[messages.length - 1];
	const endsWithToolResult = lastMsg?.role === "tool" || (lastMsg as any)?.role === "function";
	if (endsWithToolResult) {
		parts.push(
			lang === "cn"
				? "请根据以上工具执行结果回答用户的问题。"
				: "Please answer the user's question based on the tool results above.",
		);
	}

	return { prompt: parts.join("\n\n"), hasTools };
}

/**
 * Parse Claude's text response and detect tool calls.
 * Returns either tool_calls or plain text content.
 *
 * When tool_calls are detected, content is set to null per OpenAI standard
 * (GPT-4 returns content: null when making tool calls).
 */
export function parseToolResponse(
	text: string,
	requestedTools?: ToolDefinition[],
): {
	content: string | null;
	toolCalls: ToolCallOutput[] | undefined;
	finishReason: "stop" | "tool_calls";
} {
	if (!requestedTools || requestedTools.length === 0 || !hasToolCall(text)) {
		return { content: text, toolCalls: undefined, finishReason: "stop" };
	}

	const validToolNames = new Set(requestedTools.map((t) => t.function.name));
	const parsed = extractToolCalls(text);
	const validCalls = parsed.filter((c) => validToolNames.has(c.name));

	if (validCalls.length === 0) {
		return { content: text, toolCalls: undefined, finishReason: "stop" };
	}

	const toolCalls: ToolCallOutput[] = validCalls.map((call) => ({
		id: `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
		type: "function" as const,
		function: {
			name: call.name,
			arguments: JSON.stringify(call.arguments),
		},
	}));

	// Per OpenAI standard: content is null when assistant produces tool_calls
	return { content: null, toolCalls, finishReason: "tool_calls" };
}
