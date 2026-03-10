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

function extractSamanthaLine(line: string): string[] {
	const chunks: string[] = [];
	try {
		const raw = JSON.parse(line) as { event_type?: number; event_data?: string; code?: number };
		if (raw.code != null && raw.code !== 0) return chunks;
		if (raw.event_type === 2003) return chunks;
		if (raw.event_type !== 2001 || !raw.event_data) return chunks;
		const result = JSON.parse(raw.event_data) as {
			message?: { content?: string; content_type?: number };
			is_finish?: boolean;
		};
		if (result.is_finish) return chunks;
		const message = result.message;
		const contentType = message?.content_type;
		if (
			!message ||
			contentType === undefined ||
			![2001, 2008].includes(contentType) ||
			!message.content
		) {
			return chunks;
		}
		const content = JSON.parse(message.content) as { text?: string };
		if (content.text) chunks.push(content.text);
	} catch {
		// not samantha json line
	}
	return chunks;
}

function parseSingleLineSse(line: string): { event: string; data: string } | null {
	const m = line.match(/id:\s*\d+\s+event:\s*(\S+)\s+data:\s*(.+)/);
	if (!m) return null;
	return { event: m[1]?.trim() ?? "", data: m[2]?.trim() ?? "" };
}

function chunksFromEvent(event: string, dataStr: string): string[] {
	const chunks: string[] = [];
	try {
		const data = JSON.parse(dataStr) as Record<string, unknown>;
		switch (event) {
			case "CHUNK_DELTA":
				if (typeof data.text === "string") chunks.push(data.text);
				break;
			case "STREAM_CHUNK": {
				const patchOp = data.patch_op as
					| Array<{ patch_value?: { tts_content?: string } }>
					| undefined;
				if (patchOp) {
					for (const patch of patchOp) {
						const t = patch.patch_value?.tts_content;
						if (t) chunks.push(t);
					}
				}
				break;
			}
			case "STREAM_MSG_NOTIFY": {
				const blocks = (data.content as { content_block?: unknown[] } | undefined)?.content_block;
				if (Array.isArray(blocks)) {
					for (const block of blocks) {
						const text = (block as { content?: { text_block?: { text?: string } } })?.content
							?.text_block?.text;
						if (text) chunks.push(text);
					}
				}
				break;
			}
			case "STREAM_ERROR": {
				const code = data.error_code as number | undefined;
				const msg = (data.error_msg as string) || "Doubao stream error";
				if (code === 710022004) throw new Error(`Doubao rate limit: ${msg} (${code})`);
				throw new Error(`Doubao API error: ${msg} (${code ?? "unknown"})`);
			}
			default:
				break;
		}
	} catch (e) {
		if (e instanceof Error && e.message.startsWith("Doubao")) throw e;
	}
	return chunks;
}

export async function parseDoubaoStream(
	body: ReadableStream<Uint8Array>,
	onDelta?: (delta: string) => void,
): Promise<StreamResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let rawText = "";
	let currentEvent: { id?: string; event?: string; data?: string } = {};

	const flushEvent = () => {
		if (!currentEvent.event || !currentEvent.data) return;
		for (const c of chunksFromEvent(currentEvent.event, currentEvent.data)) {
			rawText += c;
			onDelta?.(c);
		}
		currentEvent = {};
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				if (buffer.trim()) {
					for (const line of buffer.split("\n")) processRawLine(line.trim());
				}
				flushEvent();
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processRawLine(line);
		}
	} finally {
		reader.releaseLock();
	}

	function processRawLine(trimmed: string) {
		if (trimmed === "") {
			flushEvent();
			return;
		}
		const single = parseSingleLineSse(trimmed);
		if (single) {
			for (const c of chunksFromEvent(single.event, single.data)) {
				rawText += c;
				onDelta?.(c);
			}
			currentEvent = {};
			return;
		}
		const dataLine = trimmed.startsWith("data: ") ? trimmed.slice(6).trim() : trimmed;
		if (dataLine && !dataLine.startsWith("id:")) {
			const sam = extractSamanthaLine(dataLine);
			if (sam.length > 0) {
				for (const c of sam) {
					rawText += c;
					onDelta?.(c);
				}
				return;
			}
		}
		if (trimmed.startsWith("id: ")) {
			currentEvent.id = trimmed.substring(4).trim();
		} else if (trimmed.startsWith("event: ")) {
			currentEvent.event = trimmed.substring(7).trim();
		} else if (trimmed.startsWith("data: ")) {
			currentEvent.data = trimmed.substring(6).trim();
		}
	}

	const split = splitThinkingFromText(rawText);
	return {
		text: split.text,
		thinkingText: split.thinkingText,
	};
}
