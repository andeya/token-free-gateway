#!/usr/bin/env bun
/**
 * postinstall: Patch playwright-core's WebSocket transport for Bun compatibility.
 *
 * Bun's http.ClientRequest doesn't emit the 'upgrade' event (oven-sh/bun#9911),
 * which breaks the `ws` npm package used by playwright-core for CDP connections.
 *
 * This script patches transport.js to use Bun's native WebSocket when running
 * under Bun, while keeping the original `ws` for Node.js.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PATCH_MARKER = "/* BUN_WS_PATCHED */";

function main() {
	let transportPath: string;
	try {
		const pwDir = path.dirname(require.resolve("playwright-core"));
		transportPath = path.join(pwDir, "lib", "server", "transport.js");
	} catch {
		// playwright-core not installed
		return;
	}

	if (!existsSync(transportPath)) return;

	const content = readFileSync(transportPath, "utf8");
	if (content.includes(PATCH_MARKER)) {
		console.log("[postinstall] playwright-core transport.js already patched.");
		return;
	}

	const BUN_WS_SHIM = `
${PATCH_MARKER}
var _BunWsShim;
if (typeof globalThis.Bun !== "undefined") {
  var _events = require("events");
  _BunWsShim = class BunWebSocketShim extends _events.EventEmitter {
    constructor(url) {
      super();
      this.readyState = 0; // CONNECTING
      var self = this;
      var ws = new WebSocket(url);
      this._native = ws;
      ws.addEventListener("open", function() {
        self.readyState = 1;
        self.emit("open");
        self.emit("upgrade", { rawHeaders: [] });
      });
      ws.addEventListener("message", function(e) {
        self.emit("message", { data: e.data, type: "message", target: self });
      });
      ws.addEventListener("close", function(e) {
        self.readyState = 3;
        self.emit("close", { code: e.code, reason: e.reason, type: "close", target: self });
      });
      ws.addEventListener("error", function(e) {
        self.emit("error", { message: (e && e.message) || "WebSocket error", type: "error", target: self });
      });
    }
    send(data) { this._native.send(data); }
    close(code, reason) { this.readyState = 2; this._native.close(code, reason); }
    addEventListener(evt, fn) { this.on(evt, fn); }
    removeEventListener(evt, fn) { this.off(evt, fn); }
  };
  _BunWsShim.CONNECTING = 0;
  _BunWsShim.OPEN = 1;
  _BunWsShim.CLOSING = 2;
  _BunWsShim.CLOSED = 3;
}
`;

	const OLD_LINE = `    this._ws = new import_utilsBundle.ws(url, [], {`;
	const NEW_LINE = `    this._ws = (typeof globalThis.Bun !== "undefined" && _BunWsShim) ? new _BunWsShim(url) : new import_utilsBundle.ws(url, [], {`;

	if (!content.includes(OLD_LINE)) {
		console.warn(
			"[postinstall] Could not find expected WebSocket constructor in transport.js. " +
				"playwright-core version may have changed. Skipping patch.",
		);
		return;
	}

	const patched = BUN_WS_SHIM + content.replace(OLD_LINE, NEW_LINE);
	writeFileSync(transportPath, patched);
	console.log(
		"[postinstall] Patched playwright-core transport.js for Bun WebSocket compatibility.",
	);
}

main();
