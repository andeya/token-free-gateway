import pkg from "./package.json";

const VERSION = pkg.version;
const args = process.argv.slice(2);
const command = args[0];

if (command === "--help" || command === "-h" || command === "help") {
	console.log(`
Token-Free Gateway v${VERSION} — Multi-provider OpenAI-compatible AI gateway

Usage:
  token-free-gateway [command] [options]

Commands:
  serve               Start the gateway server in foreground (default)
  start               Start the gateway server in background (daemon)
  stop                Stop the background gateway server
  restart             Restart the background gateway server
  status              Show gateway server running status
  webauth             Interactive provider authorization wizard
  chrome [start|stop] Launch/stop Chrome in remote-debug mode for webauth

Options:
  --help, -h          Show this help message
  --version, -v       Show version

Environment (override config file):
  TFG_PORT            Server port (default: 3456)
  TFG_API_KEY         Bearer token for client auth (optional, empty = disabled)
  TFG_CDP_URL         Chrome debug port URL (default: http://127.0.0.1:9222)

Config file: ~/.token-free-gateway/config.json (auto-created on first start)

Quick Start:
  1. Install Chrome (or Chromium) on your machine
  2. token-free-gateway webauth    # Authorize providers (auto-starts Chrome)
  3. token-free-gateway start      # Start the gateway in background
`);
	process.exit(0);
}

if (command === "--version" || command === "-v") {
	console.log(`token-free-gateway ${VERSION}`);
	process.exit(0);
}

if (command === "webauth") {
	await import("./src/cli/webauth.ts");
} else if (command === "chrome") {
	const { chromeCommand } = await import("./src/cli/chrome.ts");
	await chromeCommand(args[1]);
} else if (command === "start") {
	const { startDaemon } = await import("./src/cli/daemon.ts");
	await startDaemon();
} else if (command === "stop") {
	const { stopDaemon } = await import("./src/cli/daemon.ts");
	await stopDaemon();
} else if (command === "restart") {
	const { restartDaemon } = await import("./src/cli/daemon.ts");
	await restartDaemon();
} else if (command === "status") {
	const { statusDaemon } = await import("./src/cli/daemon.ts");
	await statusDaemon();
} else if (!command || command === "serve" || command === "__serve") {
	await import("./src/server.ts");
} else {
	console.error(`Unknown command: ${command}\nRun 'token-free-gateway --help' for usage.`);
	process.exit(1);
}
