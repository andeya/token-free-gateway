/**
 * Persistent credential store for web AI providers.
 * Stores auth profiles in ~/.token-free-gateway/auth-profiles.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AuthProfile {
	providerId: string;
	credentials: unknown;
	updatedAt: string;
}

export interface AuthStore {
	profiles: Record<string, AuthProfile>;
}

const CONFIG_DIR = join(homedir(), ".token-free-gateway");
const STORE_PATH = join(CONFIG_DIR, "auth-profiles.json");

function ensureConfigDir(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

export function loadAuthStore(): AuthStore {
	try {
		if (existsSync(STORE_PATH)) {
			const raw = readFileSync(STORE_PATH, "utf-8");
			return JSON.parse(raw) as AuthStore;
		}
	} catch (e) {
		console.warn(`[auth-store] Failed to load ${STORE_PATH}: ${e}`);
	}
	return { profiles: {} };
}

export function saveAuthStore(store: AuthStore): void {
	ensureConfigDir();
	writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
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

export function getStorePath(): string {
	return STORE_PATH;
}
