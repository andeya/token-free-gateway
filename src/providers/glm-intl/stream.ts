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

function extractGlmIntlDelta(data: Record<string, unknown>): string {
	let delta = "";
	if (data.parts && Array.isArray(data.parts)) {
		for (const part of data.parts) {
			if (part && typeof part === "object") {
				const p = part as Record<string, unknown>;
				const content = p.content;
				if (Array.isArray(content)) {
					for (const c of content) {
						if (c && typeof c === "object") {
							const cc = c as Record<string, unknown>;
							if (cc.type === "text" && typeof cc.text === "string") {
								delta = cc.text;
								break;
							}
						}
					}
				}
				if (delta) break;
			}
		}
	}
	if (!delta) {
		const t =
			data.text ??
			data.content ??
			data.delta ??
			(typeof data.message === "string" ? data.message : undefined);
		if (typeof t === "string") delta = t;
	}
	return delta;
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

export async function parseGlmIntlStream(
	body: ReadableStream<Uint8Array>,
	onDelta?: (delta: string) => void,
): Promise<StreamResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let accumulatedContent = "";
	let fullText = "";

	function processLine(line: string): void {
		if (!line.startsWith("data:")) return;
		const dataStr = line.slice(5).trim();
		const data = parseSseData(dataStr);
		if (!data) return;
		const delta = extractGlmIntlDelta(data);
		if (typeof delta !== "string" || !delta) return;
		if (delta.length > accumulatedContent.length) {
			const newDelta = delta.slice(accumulatedContent.length);
			accumulatedContent = delta;
			fullText += newDelta;
			onDelta?.(newDelta);
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
