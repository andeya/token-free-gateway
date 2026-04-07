/** Discriminated result returned from `page.evaluate` fetch wrappers. */
export type EvalResult<T = string> =
	| { ok: true; data: T }
	| { ok: false; status: number; error: string };

/**
 * Race an evaluate promise against a wall-clock timeout on the Node
 * side.  If the evaluate hangs (e.g. the browser tab freezes) the
 * caller still gets a clean rejection.
 */
export function withEvalTimeout<T>(
	evalPromise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		evalPromise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)),
				timeoutMs,
			);
		}),
	]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

/**
 * Race a promise against an `AbortSignal`.  If no signal is provided
 * the original promise is returned unchanged.
 */
export function raceAbortSignal<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
	label: string,
): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(new Error(`${label} aborted`));
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			signal.addEventListener("abort", () => reject(new Error(`${label} aborted`)), { once: true });
		}),
	]);
}
