export interface ModelInfo {
	id: string;
	name: string;
}

export interface StreamResult {
	text: string;
	thinkingText: string;
}

export class SessionExpiredError extends Error {
	constructor(
		public readonly providerId: string,
		message?: string,
	) {
		super(
			message ??
				`Session expired for provider "${providerId}". Run 'token-free-gateway webauth' to re-authorize.`,
		);
		this.name = "SessionExpiredError";
	}
}

/**
 * Carries a provider-side HTTP status code so the gateway can return
 * an appropriate HTTP status to the client (e.g. 400 → don't retry).
 */
export class ProviderApiError extends Error {
	constructor(
		public readonly httpStatus: number,
		message: string,
	) {
		super(message);
		this.name = "ProviderApiError";
	}
}

export interface WebProviderClient {
	readonly providerId: string;
	init(): Promise<void>;
	sendMessage(params: {
		message: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<ReadableStream<Uint8Array>>;
	parseStream(
		body: ReadableStream<Uint8Array>,
		onDelta?: (delta: string) => void,
	): Promise<StreamResult>;
	listModels(): ModelInfo[];
	close?(): Promise<void>;
	/** Lightweight session validity check (e.g. cookie expiry, test API call). */
	checkSession?(): Promise<{ valid: boolean; reason?: string }>;
}

export type WebProviderFactory = (credentials: unknown) => WebProviderClient;

/**
 * Race a promise against a timeout. Rejects with a descriptive error on expiry.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "Operation"): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
		),
	]);
}

export interface ProviderDefinition {
	id: string;
	name: string;
	models: ModelInfo[];
	factory: WebProviderFactory;
	loginFn: (params: {
		onProgress: (msg: string) => void;
		openUrl: (url: string) => Promise<boolean>;
	}) => Promise<unknown>;
}
