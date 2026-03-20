import type { StreamResult } from "../types.ts";

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

function extractCnDelta(data: Record<string, unknown>): string {
	let delta = "";
	const inner = data.data as Record<string, unknown> | undefined;
	const messages = inner?.messages as Array<{ content?: string }> | undefined;
	if (messages && Array.isArray(messages)) {
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg?.content && typeof msg.content === "string") {
				delta = msg.content;
				break;
			}
		}
	}
	if (!delta) {
		const choices = data.choices as Array<{ delta?: { content?: string } }> | undefined;
		delta = choices?.[0]?.delta?.content ?? "";
		if (!delta && inner) {
			const t = inner.text ?? inner.content ?? inner.delta;
			delta = typeof t === "string" ? t : "";
		}
		if (!delta) {
			const comm = data.communication as { text?: string; content?: string } | undefined;
			delta = comm?.text ?? comm?.content ?? "";
		}
		if (!delta) {
			const t = data.text ?? data.content ?? data.delta;
			delta = typeof t === "string" ? t : "";
		}
	}
	return typeof delta === "string" ? delta : "";
}

export async function parseQwenCnStream(
	body: ReadableStream<Uint8Array>,
	onDelta?: (delta: string) => void,
): Promise<StreamResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const acc = new TagAccumulator();
	let lastExtractedContent = "";

	const processLine = (line: string) => {
		if (!line) {
			return;
		}
		if (line.startsWith("event:")) {
			return;
		}
		if (!line.startsWith("data:")) {
			return;
		}

		const dataStr = line.slice(5).trim();
		if (dataStr === "[DONE]" || !dataStr) {
			return;
		}

		const data = parseSseData(dataStr);
		if (!data || typeof data !== "object") {
			return;
		}

		const d = data as Record<string, unknown>;
		const delta = extractCnDelta(d);

		if (typeof delta !== "string" || !delta) {
			return;
		}

		if (delta.length > lastExtractedContent.length && delta.startsWith(lastExtractedContent)) {
			const newPart = delta.slice(lastExtractedContent.length);
			lastExtractedContent = delta;
			if (newPart) {
				acc.pushDelta(newPart);
				onDelta?.(newPart);
			}
		} else if (delta !== lastExtractedContent) {
			lastExtractedContent = delta;
			acc.pushDelta(delta);
			onDelta?.(delta);
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
