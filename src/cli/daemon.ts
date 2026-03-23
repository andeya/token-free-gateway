import { closeSync, openSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DATA_DIR = join(homedir(), ".token-free-gateway");
const PID_FILE = join(DATA_DIR, "gateway.pid");
export const LOG_FILE = join(DATA_DIR, "gateway.log");

async function ensureDataDir() {
	await mkdir(DATA_DIR, { recursive: true });
}

function readPid(): number | null {
	try {
		const content = readFileSync(PID_FILE, "utf8");
		const pid = Number.parseInt(content.trim(), 10);
		return Number.isNaN(pid) ? null : pid;
	} catch {
		return null;
	}
}

function isRunning(pid: number): boolean {
	if (process.platform === "win32") {
		// On Windows, signal 0 semantics differ; query via tasklist instead
		const result = Bun.spawnSync({
			cmd: ["tasklist", "/FI", `PID eq ${pid}`, "/NH"],
			stdout: "pipe",
			stderr: "ignore",
		});
		return result.stdout.toString().includes(String(pid));
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function removePidFile() {
	try {
		await rm(PID_FILE, { force: true });
	} catch {}
}

/**
 * Rebuild the spawn command so it works both in dev (bun index.ts) and
 * as a compiled binary.
 */
function buildSpawnCmd(): string[] {
	const argv0 = process.argv[0] ?? process.execPath;
	const argv1 = process.argv[1] ?? "";
	if (argv1.endsWith(".ts") || argv1.endsWith(".js")) {
		// Dev mode: bun index.ts __serve
		return [argv0, argv1, "__serve"];
	}
	// Compiled binary: ./token-free-gateway __serve
	return [process.execPath, "__serve"];
}

export async function startDaemon() {
	await ensureDataDir();

	const existing = readPid();
	if (existing && isRunning(existing)) {
		console.log(`Gateway is already running (PID: ${existing})`);
		console.log(`Logs: ${LOG_FILE}`);
		return;
	}

	const logFd = openSync(LOG_FILE, "a");

	const proc = Bun.spawn({
		cmd: buildSpawnCmd(),
		detached: true,
		stdout: logFd,
		stderr: logFd,
		stdin: "ignore",
		env: process.env as Record<string, string>,
	});
	proc.unref();

	// Close parent's copy of the fd — child has inherited it
	closeSync(logFd);

	await writeFile(PID_FILE, String(proc.pid));

	// Brief wait to detect immediate crash
	await Bun.sleep(600);

	if (proc.pid && isRunning(proc.pid)) {
		console.log(`Gateway started (PID: ${proc.pid})`);
		console.log(`Logs: ${LOG_FILE}`);
	} else {
		await removePidFile();
		console.error(`Failed to start gateway. Check logs: ${LOG_FILE}`);
		process.exit(1);
	}
}

export async function stopDaemon() {
	const pid = readPid();
	if (!pid) {
		console.log("Gateway is not running (no PID file found)");
		return;
	}

	if (!isRunning(pid)) {
		console.log("Gateway is not running (stale PID file, cleaning up)");
		await removePidFile();
		return;
	}

	if (process.platform === "win32") {
		Bun.spawnSync({ cmd: ["taskkill", "/PID", String(pid)], stdout: "ignore", stderr: "ignore" });
	} else {
		process.kill(pid, "SIGTERM");
	}

	// Wait up to 5 s for graceful shutdown
	let waited = 0;
	while (isRunning(pid) && waited < 5000) {
		await Bun.sleep(200);
		waited += 200;
	}

	if (isRunning(pid)) {
		if (process.platform === "win32") {
			Bun.spawnSync({
				cmd: ["taskkill", "/F", "/PID", String(pid)],
				stdout: "ignore",
				stderr: "ignore",
			});
		} else {
			process.kill(pid, "SIGKILL");
		}
		console.log(`Gateway force-killed (PID: ${pid})`);
	} else {
		console.log(`Gateway stopped (PID: ${pid})`);
	}

	await removePidFile();
}

export async function restartDaemon() {
	await stopDaemon();
	await Bun.sleep(300);
	await startDaemon();
}

export async function statusDaemon() {
	const pid = readPid();
	if (!pid) {
		console.log("Gateway: stopped");
		return;
	}
	if (isRunning(pid)) {
		console.log(`Gateway: running (PID: ${pid})`);
		console.log(`Logs: ${LOG_FILE}`);
	} else {
		console.log("Gateway: stopped (stale PID file)");
		await removePidFile();
	}
}
