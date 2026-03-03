import type { WebProviderClient } from "../providers/types.ts";

export async function handleChatCompletions(req: Request, provider: WebProviderClient): Promise<Response> {
	const body = await req.json() as { messages?: Array<{role: string; content: string}>; model?: string };
	const msg = body.messages?.at(-1);
	const message = typeof msg?.content === "string" ? msg.content : "";
	const stream = await provider.sendMessage({ message, model: body.model });
	const result = await provider.parseStream(stream);
	return Response.json({ id: `chatcmpl-${Date.now()}`, object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
		usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
}
