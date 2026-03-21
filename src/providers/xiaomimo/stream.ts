import type { StreamResult } from "../types.ts";

export async function parseXiaomiMimoStream(
	body: ReadableStream<Uint8Array>,
	onDelta?: (delta: string) => void,
): Promise<StreamResult> {
	const reader = body.getReader();
	const dec = new TextDecoder();
	let text = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		text += dec.decode(value, { stream: true });
	}
	return { text, thinkingText: "" };
}
