/**
 * Wrap a string (typically buffered SSE text) into a single-chunk
 * ReadableStream<Uint8Array>.
 */
export function textToStream(text: string): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(text);
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}
