#!/usr/bin/env bun
/**
 * Sync or bump version across the entire project.
 *
 * Source of truth: "version" field in root package.json
 *
 * Usage:
 *   bun scripts/bump-version.ts              — print current version
 *   bun scripts/bump-version.ts patch        — bump patch, then sync everywhere
 *   bun scripts/bump-version.ts minor        — bump minor, then sync everywhere
 *   bun scripts/bump-version.ts major        — bump major, then sync everywhere
 *   bun scripts/bump-version.ts 1.2.3        — set explicit version everywhere
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const NPM_PACKAGES = [
	"packaging/npm/token-free-gateway",
	"packaging/npm/darwin-arm64",
	"packaging/npm/darwin-x64",
	"packaging/npm/linux-x64",
	"packaging/npm/linux-arm64",
	"packaging/npm/win32-x64",
];

const PLATFORM_SCOPES = [
	"@andeya/token-free-gateway-darwin-arm64",
	"@andeya/token-free-gateway-darwin-x64",
	"@andeya/token-free-gateway-linux-x64",
	"@andeya/token-free-gateway-linux-arm64",
	"@andeya/token-free-gateway-win32-x64",
];

const INCREMENTS = ["major", "minor", "patch"] as const;

function readRootVersion(): string {
	const pkgPath = path.join(ROOT, "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
	return pkg.version;
}

function incrementVersion(current: string, level: (typeof INCREMENTS)[number]): string {
	const [major = 0, minor = 0, patch = 0] = current.split(".").map(Number);
	const parts = [major, minor, patch];
	const idx = INCREMENTS.indexOf(level);
	parts[idx]! += 1;
	for (let i = idx + 1; i < 3; i++) parts[i] = 0;
	return parts.join(".");
}

function updatePackageJson(relDir: string, version: string, isRoot = false): void {
	const pkgPath = path.join(ROOT, relDir, "package.json");
	if (!existsSync(pkgPath)) {
		console.warn(`  ⚠ ${pkgPath} not found, skipping`);
		return;
	}
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
		version: string;
		optionalDependencies?: Record<string, string>;
	};
	pkg.version = version;

	if (pkg.optionalDependencies) {
		for (const scope of PLATFORM_SCOPES) {
			if (scope in pkg.optionalDependencies) {
				pkg.optionalDependencies[scope] = version;
			}
		}
	}

	writeFileSync(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
	const label = isRoot ? "package.json (root)" : `${relDir}/package.json`;
	console.log(`  ✓ ${label} → ${version}`);
}

function main(): void {
	const arg = process.argv[2];
	let version: string;
	const current = readRootVersion();

	if (!arg) {
		console.log(`\nCurrent version: ${current}\n`);
		console.log("Usage: bun scripts/bump-version.ts [patch|minor|major|<version>]\n");
		return;
	}

	if ((INCREMENTS as readonly string[]).includes(arg)) {
		version = incrementVersion(current, arg as (typeof INCREMENTS)[number]);
		console.log(`\nBumping ${arg}: ${current} → ${version}\n`);
	} else if (/^\d+\.\d+\.\d+/.test(arg)) {
		version = arg;
		console.log(`\nSetting version: ${current} → ${version}\n`);
	} else {
		console.error(
			`Invalid argument: "${arg}". Use: patch, minor, major, or a semver string (x.y.z).`,
		);
		process.exit(1);
	}

	updatePackageJson(".", version, true);
	for (const dir of NPM_PACKAGES) {
		updatePackageJson(dir, version);
	}

	console.log(`\nDone. All files updated to ${version}.`);
	console.log(`Next: commit, then tag with: git tag v${version} && git push origin v${version}\n`);
}

main();
