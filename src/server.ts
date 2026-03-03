import { loadConfig } from "./config.ts";
const config = loadConfig();
const server = Bun.serve({ port: config.port,
	fetch(req: Request) {
		const { pathname } = new URL(req.url);
		if (pathname === "/health") return Response.json({ status: "ok" });
		return Response.json({ error: "Not found" }, { status: 404 });
	},
});
console.log(`Token-Free Gateway listening on http://localhost:${server.port}`);
export { server };
