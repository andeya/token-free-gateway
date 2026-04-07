import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface GatewayConfig {
	port: number;
	gatewayApiKey: string | undefined;
	cdpUrl: string;
}

interface ConfigFile {
	port?: number;
	apiKey?: string;
	cdpUrl?: string;
}

const DEFAULTS: Required<ConfigFile> = {
	port: 3456,
	apiKey: "",
	cdpUrl: "http://127.0.0.1:9222",
};

export const CONFIG_FILE_PATH = join(homedir(), ".token-free-gateway", "config.json");

function loadConfigFile(): ConfigFile {
	try {
		if (existsSync(CONFIG_FILE_PATH)) {
			const raw = readFileSync(CONFIG_FILE_PATH, "utf-8");
			return JSON.parse(raw) as ConfigFile;
		}
	} catch {
		// ignore malformed or unreadable config file
	}
	return {};
}

/**
 * Create <homedir>/.token-free-gateway/config.json with default values if it does not exist.
 * Called once at server startup so users always have a reference file to edit.
 */
export function ensureConfigFile(): void {
	if (existsSync(CONFIG_FILE_PATH)) return;
	try {
		mkdirSync(dirname(CONFIG_FILE_PATH), { recursive: true });
		writeFileSync(CONFIG_FILE_PATH, `${JSON.stringify(DEFAULTS, null, 2)}\n`, "utf-8");
		console.log(`Created default config: ${CONFIG_FILE_PATH}`);
	} catch {
		// non-fatal: config file is optional
	}
}

/**
 * Load gateway configuration.
 *
 * Priority (highest to lowest):
 *   1. TFG_* environment variables
 *   2. <homedir>/.token-free-gateway/config.json
 *   3. Built-in defaults
 */
export function loadConfig(): GatewayConfig {
	const file = loadConfigFile();
	return {
		port: Number.parseInt(process.env.TFG_PORT ?? String(file.port ?? DEFAULTS.port), 10),
		gatewayApiKey: (process.env.TFG_API_KEY ?? file.apiKey ?? DEFAULTS.apiKey) || undefined,
		cdpUrl: process.env.TFG_CDP_URL ?? file.cdpUrl ?? DEFAULTS.cdpUrl,
	};
}
