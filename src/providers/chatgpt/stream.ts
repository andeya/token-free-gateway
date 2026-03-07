import type { StreamResult } from "../types.ts";

export async function parseChatGPTStream(
	body: ReadableStream<Uint8Array>,
	onDelta?: (delta: string) => void,
	onMeta?: (meta: { conversationId?: string; parentMessageId?: string }) => void,
): Promise<StreamResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let accumulatedContent = "";
	let text = "";
	const thinkingText = "";

	const processLine = (line: string) => {
		if (!line?.startsWith("data: ")) {
			return;
		}

		const dataStr = line.slice(6).trim();
		if (dataStr === "[DONE]") {
			return;
		}
		if (!dataStr) {
			return;
		}

		try {
			const data = JSON.parse(dataStr) as {
				conversation_id?: string;
				message?: {
					id?: string;
					author?: { role?: string };
					role?: string;
					content?: { parts?: unknown[] };
				};
			};

			if (data.conversation_id) {
				onMeta?.({ conversationId: data.conversation_id });
			}
			if (data.message?.id) {
				onMeta?.({ parentMessageId: data.message.id });
			}

			const role = data.message?.author?.role ?? data.message?.role;
			if (role && role !== "assistant") {
				return;
			}

			const rawPart = data.message?.content?.parts?.[0];
			const content =
				typeof rawPart === "string"
					? rawPart
					: typeof rawPart === "object" &&
							rawPart !== null &&
							"text" in rawPart &&
							typeof (rawPart as { text?: string }).text === "string"
						? (rawPart as { text: string }).text
						: undefined;
			if (typeof content === "string" && content) {
				const delta = content.slice(accumulatedContent.length);
				if (delta) {
					accumulatedContent = content;
					text += delta;
					onDelta?.(delta);
				}
			}
		} catch {
			// ignore partial or non-JSON lines
		}
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				if (buffer.trim()) {
					processLine(buffer.trim());
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
