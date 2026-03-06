/**
 * Claude Web client (fetch-based).
 * Sends messages to claude.ai API using session cookie authentication.
 */

import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { ClaudeWebAuth } from "./auth.ts";
import { parseClaudeStream } from "./stream.ts";

export class ClaudeWebClient implements WebProviderClient {
	readonly providerId = "claude-web";
	private cookie: string;
	private organizationId?: string;
	private deviceId: string;
	private userAgent: string;
	private readonly baseUrl = "https://claude.ai/api";

	constructor(auth: ClaudeWebAuth) {
		this.cookie = auth.cookie || `sessionKey=${auth.sessionKey}`;
		this.organizationId = auth.organizationId;
		this.userAgent =
			auth.userAgent ||
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
		this.deviceId = crypto.randomUUID();
		const deviceMatch = this.cookie.match(/anthropic-device-id=([^;]+)/);
		if (deviceMatch?.[1]) this.deviceId = deviceMatch[1];
	}

	private headers(): Record<string, string> {
		return {
			"Content-Type": "application/json",
			Cookie: this.cookie,
			"User-Agent": this.userAgent,
			Accept: "text/event-stream",
			Referer: "https://claude.ai/",
			Origin: "https://claude.ai",
			"anthropic-client-platform": "web_claude_ai",
			"anthropic-device-id": this.deviceId,
			"Sec-Fetch-Dest": "empty",
			"Sec-Fetch-Mode": "cors",
			"Sec-Fetch-Site": "same-origin",
		};
	}

	async init(): Promise<void> {
		if (this.organizationId) return;
		try {
			const res = await fetch(`${this.baseUrl}/organizations`, { headers: this.headers() });
			if (!res.ok) return;
			const orgs = (await res.json()) as Array<{ uuid: string }>;
			if (orgs[0]?.uuid) {
				this.organizationId = orgs[0].uuid;
				console.log(`[ClaudeWeb] Discovered organization: ${this.organizationId}`);
			}
		} catch {
			// ignore
		}
	}

	private async createConversation(): Promise<string> {
		const url = this.organizationId
			? `${this.baseUrl}/organizations/${this.organizationId}/chat_conversations`
			: `${this.baseUrl}/chat_conversations`;
		const res = await fetch(url, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({ name: "", uuid: crypto.randomUUID() }),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`Failed to create conversation: ${res.status} ${text}`);
		}
		return ((await res.json()) as { uuid: string }).uuid;
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const conversationId = await this.createConversation();
		const model = params.model || "claude-sonnet-4-20250514";
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const url = this.organizationId
			? `${this.baseUrl}/organizations/${this.organizationId}/chat_conversations/${conversationId}/completion`
			: `${this.baseUrl}/chat_conversations/${conversationId}/completion`;

		const res = await fetch(url, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				prompt: params.message,
				parent_message_uuid: "00000000-0000-4000-8000-000000000000",
				model,
				timezone,
				rendering_mode: "messages",
				attachments: [],
				files: [],
				locale: "en-US",
				personalized_styles: [],
				sync_sources: [],
				tools: [],
			}),
			signal: params.signal,
		});

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			if (res.status === 401) {
				throw new Error("Claude authentication failed. Please run `bun run webauth` to refresh.");
			}
			throw new Error(`Claude API error: ${res.status} ${text}`);
		}
		if (!res.body) throw new Error("No response body from Claude API");
		return res.body;
	}

	async parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return parseClaudeStream(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return [
			{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
			{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
			{ id: "claude-opus-4-20250514", name: "Claude Opus 4" },
			{ id: "claude-opus-4-6", name: "Claude Opus 4.6" },
			{ id: "claude-haiku-4-20250514", name: "Claude Haiku 4" },
			{ id: "claude-haiku-4-6", name: "Claude Haiku 4.6" },
		];
	}
}
