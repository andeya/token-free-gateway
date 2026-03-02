import pkg from "./package.json";
const VERSION = pkg.version;
const args = process.argv.slice(2);
const cmd = args[0];
if (cmd === "--help" || cmd === "-h") {
	console.log(`Token-Free Gateway v${VERSION}`);
	process.exit(0);
}
await import("./src/server.ts");
