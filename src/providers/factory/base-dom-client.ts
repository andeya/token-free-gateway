import type { Page } from "playwright-core";
import type { BrowserCookie } from "../shared/cookie-parser.ts";
import { ensurePage } from "../shared/page-lifecycle.ts";
import { textToStream } from "../shared/stream-helpers.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { DomClientConfig, NormalizedSendParams } from "./types.ts";

/**
 * Abstract base class for DOM-interaction web providers (Gemini, GLM-Intl,
 * Perplexity, etc.).
 *
 * Subclasses implement `sendViaDom()` which handles input-finding, pasting
 * the message, pressing Enter, and polling for the response text.  The base
 * class provides a reusable `pollForStableText()` helper and takes care of
 * page lifecycle, stream wrapping, model listing, and cleanup.
 *
 * @typeParam TAuth - The credential shape returned by `getCredentials()`.
 */
export abstract class BaseDomClient<TAuth = unknown> implements WebProviderClient {
	abstract readonly providerId: string;
	protected abstract readonly config: DomClientConfig;

	protected page: Page | null = null;
	protected readonly auth: TAuth;

	constructor(auth: TAuth) {
		this.auth = auth;
	}

	// ── Abstract methods ────────────────────────────────────────────

	protected abstract getCookies(): BrowserCookie[];

	/**
	 * Perform the full DOM interaction: find the input element, paste the
	 * message, submit, wait for and return the assistant's reply text.
	 *
	 * Use `this.pollForStableText()` for the common poll-until-stable loop.
	 */
	protected abstract sendViaDom(page: Page, params: NormalizedSendParams): Promise<string>;

	protected abstract parseStreamImpl(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult>;

	// ── Optional hooks ──────────────────────────────────────────────

	protected async onInit(): Promise<void> {}

	/** Build the SSE payload from the captured text. Override to customise. */
	protected formatSsePayload(text: string): string {
		return `data: ${JSON.stringify({ text })}\n\n`;
	}

	// ── Public WebProviderClient implementation ─────────────────────

	async init(): Promise<void> {
		await this.getPage();
		await this.onInit();
	}

	async sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>> {
		const page = await this.getPage();
		const normalized: NormalizedSendParams = {
			message: params.message,
			model: params.model || this.config.models[0]?.id || "default",
			signal: params.signal,
		};

		const text = await this.sendViaDom(page, normalized);
		if (!text) {
			throw new Error(
				`${this.providerId}: no assistant reply detected. Ensure the site is reachable and you are logged in.`,
			);
		}
		return textToStream(this.formatSsePayload(text));
	}

	async parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult> {
		return this.parseStreamImpl(body, onDelta);
	}

	listModels(): ModelInfo[] {
		return this.config.models;
	}

	async close(): Promise<void> {
		this.page = null;
	}

	// ── Protected helpers ────────────────────────────────────────────

	protected async getPage(): Promise<Page> {
		this.page = await ensurePage(this.page, {
			hostKey: this.config.hostKey,
			startUrl: this.config.startUrl,
			cookies: this.getCookies(),
		});
		return this.page;
	}

	/**
	 * Poll the page until the extracted text stabilises for
	 * `config.stabilityThreshold` consecutive reads (default 2).
	 *
	 * @param extractFn - Called each iteration to pull current response
	 *   text from the DOM.  Return empty string while no response is
	 *   visible yet.
	 */
	protected async pollForStableText(
		extractFn: () => Promise<string>,
		signal?: AbortSignal,
	): Promise<string> {
		const interval = this.config.pollIntervalMs ?? 2000;
		const maxWait = this.config.maxWaitMs ?? 120_000;
		const threshold = this.config.stabilityThreshold ?? 2;

		let lastText = "";
		let stableCount = 0;

		for (let elapsed = 0; elapsed < maxWait; elapsed += interval) {
			if (signal?.aborted) throw new Error(`${this.providerId} request aborted`);
			await new Promise<void>((r) => setTimeout(r, interval));

			const text = await extractFn();
			if (text && text.length >= 2) {
				if (text !== lastText) {
					lastText = text;
					stableCount = 0;
				} else {
					stableCount++;
					if (stableCount >= threshold) break;
				}
			}
		}

		return lastText;
	}
}
