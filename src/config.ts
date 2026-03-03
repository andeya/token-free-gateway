export interface GatewayConfig {
	port: number;
	gatewayApiKey: string | undefined;
	cdpUrl: string;
}

export function loadConfig(): GatewayConfig {
	return {
		port: Number.parseInt(process.env.PORT ?? "3456", 10),
		gatewayApiKey: process.env.GATEWAY_API_KEY || undefined,
		cdpUrl: process.env.CDP_URL || "http://127.0.0.1:9222",
	};
}
