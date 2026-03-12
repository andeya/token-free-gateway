import type { StreamResult } from "../types.ts";

function splitThinkingFromText(raw: string): { text: string; thinkingText: string } {
	let text = raw;
	let thinkingText = "";

	const redactedOpen = "<redacted_thinking>";
	const redactedClose = "</redacted_thinking>";
	let start = text.indexOf(redactedOpen);
	while (start !== -1) {
		const end = text.indexOf(redactedClose, start + redactedOpen.length);
		if (end === -1) break;
		thinkingText += text.slice(start + redactedOpen.length, end);
		text = text.slice(0, start) + text.slice(end + redactedClose.length);
		start = text.indexOf(redactedOpen);
	}

	const thinkOpen = "<think>";
	const thinkClose = "</think>";
	start = text.indexOf(thinkOpen);
	while (start !== -1) {
		const end = text.indexOf(thinkClose, start + thinkOpen.length);
		if (end === -1) break;
		thinkingText += text.slice(start + thinkOpen.length, end);
		text = text.slice(0, start) + text.slice(end + thinkClose.length);
		start = text.indexOf(thinkOpen);
	}

	return { text: text.trim(), thinkingText: thinkingText.trim() };
}

export async function parseGeminiStream(
	body: ReadableStream<Uint8Array>,
	onDelta?: (delta: string) => void,
): Promise<StreamResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let raw = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				if (buffer.trim()) processLine(buffer.trim());
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const parts = buffer.split("\n");
			buffer = parts.pop() || "";
			for (const part of parts) processLine(part.trim());
		}
	} finally {
		reader.releaseLock();
	}

	function processLine(line: string) {
		if (!line.startsWith("data:")) return;
		const dataStr = line.slice(5).trim();
		if (dataStr === "[DONE]" || !dataStr) return;
		try {
			const data = JSON.parse(dataStr) as { text?: string; content?: string; delta?: string };
			const delta = data.text ?? data.content ?? data.delta;
			if (typeof delta === "string" && delta) {
				raw += delta;
				onDelta?.(delta);
			}
		} catch {
			// ignore
		}
	}

	const split = splitThinkingFromText(raw);
	return { text: split.text, thinkingText: split.thinkingText };
}
