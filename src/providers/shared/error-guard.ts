import { SessionExpiredError } from "../types.ts";

/**
 * Throw `SessionExpiredError` when the HTTP status indicates the
 * provider session has expired (401 / 403).
 *
 * Call this right after checking `!result.ok` so every provider gets
 * consistent session-expiry semantics without duplicating the check.
 */
export function throwIfSessionExpired(
	providerId: string,
	status: number | undefined,
	fallbackMessage?: string,
): void {
	if (status === 401 || status === 403) {
		throw new SessionExpiredError(
			providerId,
			fallbackMessage ??
				`Authentication failed (${status}). Re-run webauth to refresh the session.`,
		);
	}
}
