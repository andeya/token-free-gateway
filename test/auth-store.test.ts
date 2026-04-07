import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getCredentials,
	getStorePath,
	loadAuthStore,
	saveCredentials,
} from "../src/providers/auth-store.ts";

const TEST_STORE_PATH = join(tmpdir(), `tfg-test-auth-${process.pid}.json`);

beforeAll(() => {
	process.env.TOKEN_FREE_GATEWAY_STORE_PATH = TEST_STORE_PATH;
});

afterAll(() => {
	delete process.env.TOKEN_FREE_GATEWAY_STORE_PATH;
	if (existsSync(TEST_STORE_PATH)) rmSync(TEST_STORE_PATH);
});

afterEach(() => {
	const storePath = getStorePath();
	if (existsSync(storePath)) rmSync(storePath);
});

describe("auth-store", () => {
	test("loadAuthStore returns empty profiles when no file exists", () => {
		const store = loadAuthStore();
		expect(store.profiles).toEqual({});
	});

	test("saveCredentials and getCredentials round-trip", () => {
		saveCredentials("test-provider", { token: "abc123" });
		const creds = getCredentials<{ token: string }>("test-provider");
		expect(creds).toBeDefined();
		expect(creds?.token).toBe("abc123");
	});

	test("getCredentials returns null for unknown provider", () => {
		expect(getCredentials("nonexistent")).toBeNull();
	});

	test("saveCredentials overwrites existing", () => {
		saveCredentials("test-provider", { v: 1 });
		saveCredentials("test-provider", { v: 2 });
		const creds = getCredentials<{ v: number }>("test-provider");
		expect(creds?.v).toBe(2);
	});

	test("multiple providers", () => {
		saveCredentials("a", { key: "aaa" });
		saveCredentials("b", { key: "bbb" });
		expect(getCredentials<{ key: string }>("a")?.key).toBe("aaa");
		expect(getCredentials<{ key: string }>("b")?.key).toBe("bbb");
	});
});
