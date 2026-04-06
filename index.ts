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

Notes:
  Run 'chrome start' before 'webauth' for first-time setup.

Environment:
  PORT                Server port (default: 3456)
  GATEWAY_API_KEY     API key for client authentication (optional)
  CDP_URL             Chrome debug port URL (default: http://127.0.0.1:9222)

Quick Start:
  1. token-free-gateway chrome     # Launch Chrome in debug mode
  2. token-free-gateway webauth    # Log in & authorize providers
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
	// __serve is the internal command used by daemon mode
	await import("./src/server.ts");
} else {
	console.error(`Unknown command: ${command}\nRun 'token-free-gateway --help' for usage.`);
	process.exit(1);
}
