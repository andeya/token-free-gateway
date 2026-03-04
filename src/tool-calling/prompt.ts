/**
 * Dynamic tool prompt generation from OpenAI function definitions.
 *
 * Unlike openclaw's hardcoded WEB_CORE_TOOLS, this generates the prompt
 * from whatever tools the CLI sends in the request.
 *
 * Prompt strategy based on:
 * - arXiv:2407.04997 (example-based teaching for tool calling)
 * - OpenAI's own function calling documentation format
 */

import type { ToolDefinition } from "../openai/types.ts";

function toolDefsForPrompt(tools: ToolDefinition[]): string {
	return JSON.stringify(
		tools.map((t) => ({
			name: t.function.name,
			description: t.function.description || "",
			parameters: t.function.parameters || {},
		})),
		null,
		2,
	);
}

const TOOL_EXAMPLE = `Example: to add 1 to number 5, return ONLY:
\`\`\`tool_json
{"tool":"plus_one","parameters":{"number":"5"}}
\`\`\`
(plus_one is just an example, not a real tool)`;

const TOOL_EXAMPLE_CN = `示例: 要给数字5加1，只返回:
\`\`\`tool_json
{"tool":"plus_one","parameters":{"number":"5"}}
\`\`\`
(plus_one仅为示例，非真实工具)`;

export function buildToolPrompt(
	tools: ToolDefinition[],
	lang: "en" | "cn" = "en",
	forceUse = false,
): string {
	const defs = toolDefsForPrompt(tools);

	if (lang === "cn") {
		const forceHint = forceUse
			? "\n\n重要：你必须使用上述工具之一来回应。请不要直接用文字回答，必须调用工具。"
			: "";
		return `你可以使用以下工具。当需要使用工具时，只返回tool_json代码块，不要包含其他文字。

可用工具:
${defs}

${TOOL_EXAMPLE_CN}

需要使用工具时，只返回一个tool_json块。不需要工具则直接回答。${forceHint}

`;
	}

	const forceHint = forceUse
		? "\n\nIMPORTANT: You MUST use one of the tools above. Do NOT answer with plain text."
		: "";
	return `You have access to the following tools. When you need to use a tool, reply ONLY with a tool_json code block, no other text.

Available tools:
${defs}

${TOOL_EXAMPLE}

To use a tool, reply with exactly one tool_json block. If no tool is needed, answer directly.${forceHint}

`;
}

export function detectLanguage(text: string): "en" | "cn" {
	const cnChars = text.match(/[\u4e00-\u9fff]/g);
	return cnChars && cnChars.length > text.length * 0.1 ? "cn" : "en";
}
