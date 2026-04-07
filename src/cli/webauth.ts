/**
 * Interactive Web Model Auth wizard.
 * Guides users through authenticating with web AI providers via Chrome CDP.
 * Automatically starts Chrome in debug mode if it is not already running.
 *
 * Usage: bun run webauth
 */

import { createInterface } from "node:readline";
import { loadConfig } from "../config.ts";
import { listAuthorizedProviders, saveCredentials } from "../providers/auth-store.ts";
import { listProviderDefinitions } from "../providers/registry.ts";

function question(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
	return new Promise((resolve) => rl.question(prompt, resolve));
}

async function isChromeReady(): Promise<boolean> {
	const cdpUrl = loadConfig().cdpUrl;
	try {
		const res = await fetch(`${cdpUrl}/json/version`);
		return res.ok;
	} catch {
		return false;
	}
}

async function main() {
	console.log("\n🌐 Token-Free Gateway — Web Model Auth\n");

	if (!(await isChromeReady())) {
		console.log("Chrome debug mode is not running. Starting Chrome automatically...\n");
		const { startChrome } = await import("./chrome.ts");
		await startChrome();
		const rl0 = createInterface({ input: process.stdin, output: process.stdout });
		await question(
			rl0,
			"\nPlease log in to each provider in the browser tabs, then press Enter to continue: ",
		);
		rl0.close();
		console.log("");
	}

	const definitions = await listProviderDefinitions();
	const authorized = listAuthorizedProviders();

	if (authorized.length > 0) {
		console.log("Authorized providers:");
		for (const id of authorized) {
			const def = definitions.find((d) => d.id === id);
			console.log(`  ✓ ${def?.name ?? id}`);
		}
		console.log("");
	}

	console.log("Select providers to authorize (comma-separated):\n");

	for (let i = 0; i < definitions.length; i++) {
		const def = definitions[i]!;
		const status = authorized.includes(def.id) ? " ✓" : "";
		console.log(`  ${i + 1}. ${def.name}${status}`);
	}

	console.log("\n  0. Exit");
	console.log("  a. Authorize all");
	console.log("");

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const input = await question(rl, "Enter selection: ");
	rl.close();

	const trimmed = input.trim();
	if (trimmed === "0" || trimmed === "") {
		console.log("Exited.");
		process.exit(0);
	}

	const selected =
		trimmed === "a"
			? definitions
			: trimmed
					.split(",")
					.map((s) => Number.parseInt(s.trim(), 10) - 1)
					.filter((i) => i >= 0 && i < definitions.length)
					.map((i) => definitions[i]!);

	if (selected.length === 0) {
		console.log("No providers selected.");
		process.exit(0);
	}

	console.log(`\nWill authorize: ${selected.map((p) => p.name).join(", ")}\n`);

	for (const provider of selected) {
		console.log(`\n━━━ ${provider.name} ━━━`);
		try {
			const credentials = await provider.loginFn({
				onProgress: (msg) => console.log(`  > ${msg}`),
				openUrl: async (url) => {
					console.log(`  > Opening: ${url}`);
					return true;
				},
			});

			if (credentials && typeof credentials === "object") {
				saveCredentials(provider.id, credentials);
				console.log(`  ✓ ${provider.name} authorization succeeded!`);
			}
		} catch (error) {
			console.error(
				`  ✗ ${provider.name} authorization failed:`,
				error instanceof Error ? error.message : error,
			);
		}
	}

	console.log("\nAuthorization complete!");
	console.log("Start the gateway: token-free-gateway start");
	console.log(
		"\nNote: if the process does not exit automatically, press Ctrl+C — credentials are already saved.\n",
	);
	process.exit(0);
}

main().catch(console.error);
