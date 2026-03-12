export interface GeminiWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginGeminiWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<GeminiWebAuth> {
	throw new Error("loginGeminiWeb: not yet implemented");
}
