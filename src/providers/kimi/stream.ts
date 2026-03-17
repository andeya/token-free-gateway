import type { StreamResult } from "../types.ts";

function parseSseData(dataStr: string): Record<string, unknown> | null {
	if (!dataStr || dataStr === "[DONE]") return null;
	try {
		const v = JSON.parse(dataStr);
		return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function splitRedactedThinking(full: string): { text: string; thinkingText: string } {
	let thinkingText = "";
	const re = /<redacted_thinking>([\s\S]*?)<\/redacted_thinking>/gi;
	for (let m = re.exec(full); m !== null; m = re.exec(full)) {
		thinkingText += (thinkingText ? "\n" : "") + (m[1]?.trim() ?? "");
	}
	const text = full.replace(re, "").trim();
	return { text, thinkingText };
}

export async function parseKimiStream(
	body: ReadableStream<Uint8Array>,
	onDelta?: (delta: string) => void,
): Promise<StreamResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let fullText = "";

	function processLine(line: string): void {
		if (!line.startsWith("data:")) return;
		const dataStr = line.slice(5).trim();
		if (dataStr === "[DONE]" || !dataStr) return;
		const data = parseSseData(dataStr);
		if (!data) return;
		const choices = data.choices as Array<{ delta?: { content?: string } }> | undefined;
		const d = data as Record<string, unknown>;
		const delta = choices?.[0]?.delta?.content ?? d.text ?? d.content ?? d.delta;
		if (typeof delta === "string" && delta) {
			fullText += delta;
			onDelta?.(delta);
		}
	}

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				if (buffer.trim()) processLine(buffer.trim());
				break;
			}
			const chunk = decoder.decode(value, { stream: true });
			const combined = buffer + chunk;
			const parts = combined.split("\n");
			buffer = parts.pop() || "";
			for (const part of parts) {
				const trimmed = part.trim();
				if (trimmed) processLine(trimmed);
			}
		}
	} finally {
		reader.releaseLock();
	}

	const split = splitRedactedThinking(fullText);
	return {
		text: split.text,
		thinkingText: split.thinkingText,
	};
}
