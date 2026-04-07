/**
 * Persistent credential store for web AI providers.
 * Stores auth profiles in ~/.token-free-gateway/auth-profiles.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AuthProfile {
	providerId: string;
	credentials: unknown;
	updatedAt: string;
}

export interface AuthStore {
	profiles: Record<string, AuthProfile>;
}

const DEFAULT_STORE_PATH = join(homedir(), ".token-free-gateway", "auth-profiles.json");

/** Returns the active store path. Override with TFG_STORE_PATH (used in tests). */
export function getStorePath(): string {
	return process.env.TFG_STORE_PATH ?? DEFAULT_STORE_PATH;
}

function ensureStoreDir(storePath: string): void {
	const dir = dirname(storePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

export function loadAuthStore(): AuthStore {
	const storePath = getStorePath();
	try {
		if (existsSync(storePath)) {
			const raw = readFileSync(storePath, "utf-8");
			return JSON.parse(raw) as AuthStore;
		}
	} catch (e) {
		console.warn(`[auth-store] Failed to load ${storePath}: ${e}`);
	}
	return { profiles: {} };
}

export function saveAuthStore(store: AuthStore): void {
	const storePath = getStorePath();
	ensureStoreDir(storePath);
	writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
}

export function getCredentials<T = unknown>(providerId: string): T | null {
	const store = loadAuthStore();
	const profile = store.profiles[providerId];
	if (!profile) return null;
	return profile.credentials as T;
}

export function saveCredentials(providerId: string, credentials: unknown): void {
	const store = loadAuthStore();
	store.profiles[providerId] = {
		providerId,
		credentials,
		updatedAt: new Date().toISOString(),
	};
	saveAuthStore(store);
}

export function listAuthorizedProviders(): string[] {
	const store = loadAuthStore();
	return Object.keys(store.profiles);
}
