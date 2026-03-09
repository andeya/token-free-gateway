import type { StreamResult } from "../types.ts";

const JUNK_TOKENS = new Set([
	"<｜end▁of▁thinking｜>",
	"<|end▁of▁thinking|>",
	"<｜end_of_thinking｜>",
	"<|end_of_thinking|>",
	"<|endoftext|>",
]);

export async function parseDeepSeekStream(
	body: ReadableStream<Uint8Array>,
	onDelta?: (delta: string) => void,
	onParentMessageId?: (id: string | number) => void,
): Promise<StreamResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let text = "";
	let thinkingText = "";

	let currentMode: "text" | "thinking" | "tool_call" = "text";
	let tagBuffer = "";

	const emitText = (delta: string) => {
		if (!delta || JUNK_TOKENS.has(delta)) return;
		text += delta;
		onDelta?.(delta);
	};

	const emitThinking = (delta: string) => {
		if (!delta || JUNK_TOKENS.has(delta)) return;
		thinkingText += delta;
	};

	const pushDelta = (delta: string, forceType?: "text" | "thinking") => {
		if (!delta) return;
		if (forceType === "thinking") {
			emitThinking(delta);
			return;
		}
		tagBuffer += delta;

		const checkTags = () => {
			const thinkStartMatch = tagBuffer.match(/<(?:think(?:ing)?|thought)\b[^<>]*>/i);
			const thinkEndMatch = tagBuffer.match(/<\/(?:think(?:ing)?|thought)\b[^<>]*>/i);
			const toolCallStartMatch =
				tagBuffer.match(
					/<tool_call\s+(?:id=['"]?([^'"]+)['"]?\s+)?name=['"]?([^'"]+)['"]?(?:\s+id=['"]?([^'"]+)['"]?)?\s*>/i,
				) || tagBuffer.match(/<tool_call\s+id=['"]?([^'"]+)['"]?\s*>/i);
			const toolCallEndMatch = tagBuffer.match(/<\/tool_call\b[^<>]*>/i);

			const indices = [
				{
					type: "think_start" as const,
					idx: thinkStartMatch?.index ?? -1,
					len: thinkStartMatch?.[0].length ?? 0,
				},
				{
					type: "think_end" as const,
					idx: thinkEndMatch?.index ?? -1,
					len: thinkEndMatch?.[0].length ?? 0,
				},
				{
					type: "tool_start" as const,
					idx: toolCallStartMatch?.index ?? -1,
					len: toolCallStartMatch?.[0].length ?? 0,
					name: toolCallStartMatch?.[2] || toolCallStartMatch?.[1] || "",
				},
				{
					type: "tool_end" as const,
					idx: toolCallEndMatch?.index ?? -1,
					len: toolCallEndMatch?.[0].length ?? 0,
				},
			]
				.filter((t) => t.idx !== -1)
				.toSorted((a, b) => a.idx - b.idx);

			if (indices.length > 0) {
				const first = indices[0];
				if (!first) return;
				const before = tagBuffer.slice(0, first.idx);
				if (before) {
					if (currentMode === "thinking") emitThinking(before);
					else if (currentMode === "tool_call") emitText(before);
					else emitText(before);
				}
				if (first.type === "think_start") {
					currentMode = "thinking";
				} else if (first.type === "think_end") {
					currentMode = "text";
				} else if (first.type === "tool_start") {
					currentMode = "tool_call";
				} else if (first.type === "tool_end") {
					currentMode = "text";
				}
				tagBuffer = tagBuffer.slice(first.idx + first.len);
				checkTags();
			} else {
				const lastAngle = tagBuffer.lastIndexOf("<");
				if (lastAngle === -1) {
					if (currentMode === "thinking") emitThinking(tagBuffer);
					else if (currentMode === "tool_call") emitText(tagBuffer);
					else emitText(tagBuffer);
					tagBuffer = "";
				} else if (lastAngle > 0) {
					const safe = tagBuffer.slice(0, lastAngle);
					if (currentMode === "thinking") emitThinking(safe);
					else if (currentMode === "tool_call") emitText(safe);
					else emitText(safe);
					tagBuffer = tagBuffer.slice(lastAngle);
				}
			}
		};
		checkTags();
	};

	const processLine = (line: string) => {
		if (!line) return;
		if (line.startsWith("event: ")) return;

		if (line.startsWith("data: ")) {
			const dataStr = line.slice(6).trim();
			if (dataStr === "[DONE]" || !dataStr) return;

			try {
				const data = JSON.parse(dataStr) as Record<string, unknown>;

				if (
					typeof data.response_message_id === "number" ||
					typeof data.response_message_id === "string"
				) {
					onParentMessageId?.(data.response_message_id as string | number);
				}

				const pField = data.p;
				const pStr = typeof pField === "string" ? pField : "";
				if (
					(pStr.includes("reasoning") || data.type === "thinking") &&
					typeof data.v === "string"
				) {
					pushDelta(data.v, "thinking");
					return;
				}

				if (data.type === "thinking" && typeof data.content === "string") {
					pushDelta(data.content, "thinking");
					return;
				}

				if (
					typeof data.v === "string" &&
					(!pField || pStr.includes("content") || pStr.includes("choices"))
				) {
					pushDelta(data.v);
					return;
				}
				if (data.type === "text" && typeof data.content === "string") {
					pushDelta(data.content);
					return;
				}

				if (data.type === "search_result" || String(data.p || "").includes("search_results")) {
					const searchData = data.v ?? data.content;
					const query =
						typeof searchData === "string" ? searchData : (searchData as { query?: string })?.query;
					if (query) {
						pushDelta(`\n> [Researching: ${query}...]\n`);
					}
					return;
				}

				if (Array.isArray(data.v)) {
					for (const frag of data.v as Array<Record<string, unknown>>) {
						if (frag.type === "THINKING" || frag.type === "reasoning") {
							pushDelta(String(frag.content || ""), "thinking");
						} else if (frag.content) {
							pushDelta(String(frag.content));
						}
					}
					return;
				}

				const fragments = (data.v as { response?: { fragments?: unknown[] } } | undefined)?.response
					?.fragments;
				if (Array.isArray(fragments)) {
					for (const frag of fragments as Array<{ type?: string; content?: string }>) {
						if (frag.type === "THINKING" || frag.type === "reasoning") {
							pushDelta(frag.content || "", "thinking");
						} else if (frag.content) {
							pushDelta(frag.content);
						}
					}
					return;
				}

				const choice = (
					data.choices as Array<{ delta?: { reasoning_content?: string; content?: string } }>
				)?.[0];
				if (choice?.delta) {
					if (choice.delta.reasoning_content) {
						pushDelta(choice.delta.reasoning_content, "thinking");
					}
					if (choice.delta.content) {
						pushDelta(choice.delta.content);
					}
				}
			} catch {
				// ignore partial JSON
			}
		}
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				if (buffer.trim()) processLine(buffer.trim());
				if (tagBuffer) {
					if ((currentMode as string) === "thinking") emitThinking(tagBuffer);
					else emitText(tagBuffer);
					tagBuffer = "";
				}
				break;
			}
			const chunk = decoder.decode(value, { stream: true });
			const combined = buffer + chunk;
			const parts = combined.split("\n");
			buffer = parts.pop() || "";
			for (const part of parts) {
				processLine(part.trim());
			}
		}
	} finally {
		reader.releaseLock();
	}

	return { text: text.trim(), thinkingText: thinkingText.trim() };
}
