export interface PerplexityWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginPerplexityWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<PerplexityWebAuth> {
	throw new Error("loginPerplexityWeb: not yet implemented");
}
