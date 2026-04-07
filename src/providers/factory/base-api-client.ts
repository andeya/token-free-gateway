import type { Page } from "playwright-core";
import type { BrowserCookie } from "../shared/cookie-parser.ts";
import { throwIfSessionExpired } from "../shared/error-guard.ts";
import type { EvalResult } from "../shared/eval-helpers.ts";
import { ProviderApiError } from "../types.ts";
import { ensurePage } from "../shared/page-lifecycle.ts";
import { textToStream } from "../shared/stream-helpers.ts";
import type { ModelInfo, StreamResult, WebProviderClient } from "../types.ts";
import type { ApiClientConfig, NormalizedSendParams } from "./types.ts";

/**
 * Abstract base class for API-based web providers.
 *
 * Subclasses supply the provider-specific `callApi()` logic while the
 * base handles page lifecycle, error routing, stream wrapping, and
 * model listing.
 *
 * @typeParam TAuth - The credential shape returned by `getCredentials()`.
 */
export abstract class BaseApiClient<TAuth = unknown> implements WebProviderClient {
	abstract readonly providerId: string;
	protected abstract readonly config: ApiClientConfig;

	protected page: Page | null = null;
	protected readonly auth: TAuth;

	constructor(auth: TAuth) {
		this.auth = auth;
	}

	// ── Abstract methods that every subclass MUST implement ──────────

	/** Build browser cookies from the stored auth credentials. */
	protected abstract getCookies(): BrowserCookie[];

	/**
	 * Execute the provider-specific API call inside the browser page.
	 * Return an `EvalResult` — the base class handles error routing
	 * and stream wrapping.
	 */
	protected abstract callApi(page: Page, params: NormalizedSendParams): Promise<EvalResult>;

	/** Delegate to the provider-specific SSE / stream parser. */
	protected abstract parseStreamImpl(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult>;

	// ── Optional hooks (override when needed) ───────────────────────

	/** Extra initialisation after the page is ready (e.g. org discovery, token refresh). */
	protected async onInit(): Promise<void> {}

	/**
	 * Called when `sendMessage` catches an error.  Return a stream to
	 * use an alternative path (e.g. DOM fallback); rethrow or return
	 * `null` to propagate the original error.
	 */
	protected async handleError(
		err: Error,
		_page: Page,
		_params: NormalizedSendParams,
	): Promise<ReadableStream<Uint8Array> | null> {
		throw err;
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
			model: params.model || this.config.defaultModel,
			signal: params.signal,
		};

		try {
			const result = await this.callApi(page, normalized);
			if (!result.ok) {
				throwIfSessionExpired(this.providerId, result.status);
				const msg = `${this.providerId} API error: ${result.status} - ${result.error}`;
				// Propagate provider 4xx as ProviderApiError so callers can
				// return the same status to the client (avoid pointless retries).
				if (result.status && result.status >= 400 && result.status < 500) {
					throw new ProviderApiError(result.status, msg);
				}
				throw new Error(msg);
			}
			return textToStream(result.data);
		} catch (err) {
			const fallback = await this.handleError(err as Error, page, normalized);
			if (fallback) return fallback;
			throw err;
		}
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

	/**
	 * Return a live browser page, creating one via `BrowserManager` if
	 * necessary.  Subclasses may override for custom page bootstrapping
	 * (e.g. ChatGPT's oaistatic wait).
	 */
	protected async getPage(): Promise<Page> {
		this.page = await ensurePage(this.page, {
			hostKey: this.config.hostKey,
			startUrl: this.config.startUrl,
			cookies: this.getCookies(),
		});
		return this.page;
	}
}
