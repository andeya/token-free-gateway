import type { ChatCompletionTool } from "../openai/types.ts";

export function convertToolsToPrompt(tools: ChatCompletionTool[]): string {
	if (!tools?.length) return "";
	return tools.map((t) => `<tool name="${t.function.name}">${t.function.description||""}</tool>`).join("\n");
}

export function extractToolCallsFromText(_text: string): unknown[] { return []; }
export function formatToolCallsForOpenAI(calls: unknown[]): unknown[] { return calls; }
