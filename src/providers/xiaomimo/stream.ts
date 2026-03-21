import type { StreamResult } from "../types.ts";

const CLOSE_TAG = "</redacted_thinking>";
const OPEN_TAG = "<redacted_thinking>";

function parseSseData(dataStr: string): unknown | null {
	if (!dataStr || dataStr === "[DONE]") {
		return null;
	}
	try {
		return JSON.parse(dataStr);
	} catch {
		return null;
	}
}

class TagAccumulator {
	private currentMode: "text" | "thinking" | "tool_call" = "text";
	private tagBuffer = "";
	text = "";
	thinkingText = "";

	private emit(mode: "text" | "thinking" | "toolcall", delta: string) {
		if (delta === "" && mode !== "toolcall") {
			return;
		}
		if (mode === "thinking") {
			this.thinkingText += delta;
		} else {
			this.text += delta;
		}
	}

	pushDelta(delta: string, forceType?: "text" | "thinking") {
		if (!delta) {
			return;
		}
		if (forceType === "thinking") {
			this.emit("thinking", delta);
			return;
		}
		this.tagBuffer += delta;

		const checkTags = () => {
			const thinkStart = this.tagBuffer.match(/<think\b[^<>]*>/i);
			const thinkEnd = this.tagBuffer.match(/<\/think\b[^<>]*>/i);
			const toolCallStart = this.tagBuffer.match(
				/<tool_call\s*(?:id=['"]?([^'"]+)['"]?\s*)?name=['"]?([^'"]+)['"]?\s*>/i,
			);
			const toolCallEnd = this.tagBuffer.match(/<\/tool_call\s*>/i);

			const indices = [
				{
					type: "think_start" as const,
					idx: thinkStart?.index ?? -1,
					len: thinkStart?.[0].length ?? 0,
				},
				{ type: "think_end" as const, idx: thinkEnd?.index ?? -1, len: thinkEnd?.[0].length ?? 0 },
				{
					type: "tool_start" as const,
					idx: toolCallStart?.index ?? -1,
					len: toolCallStart?.[0].length ?? 0,
				},
				{
					type: "tool_end" as const,
					idx: toolCallEnd?.index ?? -1,
					len: toolCallEnd?.[0].length ?? 0,
				},
			]
				.filter((t) => t.idx !== -1)
				.toSorted((a, b) => a.idx - b.idx);

			if (indices.length > 0) {
				const first = indices[0];
				if (!first) return;
				const before = this.tagBuffer.slice(0, first.idx);
				if (before) {
					if (this.currentMode === "thinking") {
						this.emit("thinking", before);
					} else if (this.currentMode === "tool_call") {
						this.emit("toolcall", before);
					} else {
						this.emit("text", before);
					}
				}

				if (first.type === "think_start") {
					this.currentMode = "thinking";
				} else if (first.type === "think_end") {
					this.currentMode = "text";
				} else if (first.type === "tool_start") {
					this.currentMode = "tool_call";
					this.emit("toolcall", "");
				} else if (first.type === "tool_end") {
					this.currentMode = "text";
				}
				this.tagBuffer = this.tagBuffer.slice(first.idx + first.len);
				checkTags();
			} else {
				const lastAngle = this.tagBuffer.lastIndexOf("<");
				if (lastAngle === -1) {
					const mode =
						this.currentMode === "thinking"
							? "thinking"
							: this.currentMode === "tool_call"
								? "toolcall"
								: "text";
					this.emit(mode, this.tagBuffer);
					this.tagBuffer = "";
				} else if (lastAngle > 0) {
					const safe = this.tagBuffer.slice(0, lastAngle);
					const mode =
						this.currentMode === "thinking"
							? "thinking"
							: this.currentMode === "tool_call"
								? "toolcall"
								: "text";
					this.emit(mode, safe);
					this.tagBuffer = this.tagBuffer.slice(lastAngle);
				}
			}
		};
		checkTags();
	}

	flush() {
		if (!this.tagBuffer) {
			return;
		}
		const mode =
			this.currentMode === "thinking"
				? "thinking"
				: this.currentMode === "tool_call"
					? "toolcall"
					: "text";
		this.emit(mode, this.tagBuffer);
		this.tagBuffer = "";
	}
}

function processMimoContent(
	chunk: string,
	acc: TagAccumulator,
	insideThink: { v: boolean },
	onDelta: ((d: string) => void) | undefined,
) {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: strip NUL bytes from stream
	let content = chunk.replace(/\x00/g, "");

	if (content.includes(OPEN_TAG)) {
		insideThink.v = true;
	}
	if (insideThink.v) {
		const thinkEnd = content.indexOf(CLOSE_TAG);
		if (thinkEnd !== -1) {
			const openIdx = content.indexOf(OPEN_TAG);
			if (openIdx !== -1) {
				const inner = content.slice(openIdx + OPEN_TAG.length, thinkEnd);
				if (inner) {
					acc.thinkingText += inner;
				}
			}
			content = content.slice(thinkEnd + CLOSE_TAG.length);
			insideThink.v = false;
		} else {
			return;
		}
	}

	if (content) {
		acc.pushDelta(content);
		onDelta?.(content);
	}
}

export async function parseXiaomiMimoStream(
	body: ReadableStream<Uint8Array>,
	onDelta?: (delta: string) => void,
): Promise<StreamResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const acc = new TagAccumulator();
	let currentSseEvent = "";
	let accumulatedContent = "";
	const insideThink = { v: false };
	const processLine = (line: string) => {
		if (!line) {
			return;
		}
		if (line.startsWith("event:")) {
			const event = line.slice(6).trim();
			currentSseEvent = event;
			return;
		}
		if (!line.startsWith("data:")) {
			return;
		}

		const dataStr = line.slice(5).trim();
		if (dataStr === "[DONE]" || !dataStr) {
			return;
		}

		try {
			const data = parseSseData(dataStr) as Record<string, unknown> | null;
			if (!data) {
				return;
			}

			if (currentSseEvent && currentSseEvent !== "message") {
				return;
			}

			if (data.content && typeof data.content === "string") {
				processMimoContent(data.content, acc, insideThink, onDelta);
				return;
			}

			const choices = data.choices as Array<{ delta?: { content?: string } }> | undefined;
			const delta = choices?.[0]?.delta?.content ?? data.text ?? data.delta;
			if (typeof delta === "string" && delta) {
				if (delta.length > accumulatedContent.length) {
					const newDelta = delta.slice(accumulatedContent.length);
					accumulatedContent = delta;
					if (newDelta) {
						acc.pushDelta(newDelta);
						onDelta?.(newDelta);
					}
				}
			}
		} catch {
			if (dataStr.length > 0 && !dataStr.startsWith("{")) {
				acc.pushDelta(dataStr);
				onDelta?.(dataStr);
			}
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

	acc.flush();
	return {
		text: acc.text.trim(),
		thinkingText: acc.thinkingText.trim(),
	};
}
