/**
 * Interactive Web Model Auth wizard.
 * Guides users through authenticating with web AI providers via Chrome CDP.
 *
 * Usage: bun run webauth
 */

import { createInterface } from "node:readline";
import { listAuthorizedProviders, saveCredentials } from "../providers/auth-store.ts";
import { listProviderDefinitions } from "../providers/registry.ts";

function question(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
	return new Promise((resolve) => rl.question(prompt, resolve));
}

async function main() {
	console.log("\n🌐 Token-Free Gateway — Web Model Auth\n");

	const definitions = await listProviderDefinitions();
	const authorized = listAuthorizedProviders();

	if (authorized.length > 0) {
		console.log("已授权的 Web 模型 / Authorized providers:");
		for (const id of authorized) {
			const def = definitions.find((d) => d.id === id);
			console.log(`  ✓ ${def?.name || id}`);
		}
		console.log("");
	}

	console.log("请选择要授权的 Web 模型 (多个用逗号分隔):");
	console.log("Select providers to authorize (comma-separated):\n");

	for (let i = 0; i < definitions.length; i++) {
		const def = definitions[i]!;
		const isAuth = authorized.includes(def.id);
		const status = isAuth ? " ✓" : "";
		console.log(`  ${i + 1}. ${def.name}${status}`);
	}

	console.log("\n  0. 退出 / Exit");
	console.log("  a. 授权所有 / Authorize all");
	console.log("");

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const input = await question(rl, "请输入选项 / Enter selection: ");
	rl.close();

	if (input.trim() === "0" || input.trim() === "") {
		console.log("已退出 / Exited.");
		return;
	}

	const selected =
		input.trim() === "a"
			? definitions
			: input
					.split(",")
					.map((s) => Number.parseInt(s.trim(), 10) - 1)
					.filter((i) => i >= 0 && i < definitions.length)
					.map((i) => definitions[i]!);

	if (selected.length === 0) {
		console.log("未选择任何模型 / No providers selected.");
		return;
	}

	console.log(`\n将授权 / Will authorize: ${selected.map((p) => p.name).join(", ")}\n`);

	for (const provider of selected) {
		console.log(`\n━━━ ${provider.name} ━━━`);
		try {
			const credentials = await provider.loginFn({
				onProgress: (msg) => console.log(`  > ${msg}`),
				openUrl: async (url) => {
					console.log(`  > 打开 / Opening: ${url}`);
					return true;
				},
			});

			if (credentials && typeof credentials === "object") {
				saveCredentials(provider.id, credentials);
				console.log(`  ✓ ${provider.name} 授权成功 / Authorization succeeded!`);
			}
		} catch (error) {
			console.error(
				`  ✗ ${provider.name} 授权失败 / Authorization failed:`,
				error instanceof Error ? error.message : error,
			);
		}
	}

	console.log("\n授权完成 / Authorization complete!");
	console.log("启动网关 / Start the gateway: token-free-gateway start\n");
}

main().catch(console.error);
