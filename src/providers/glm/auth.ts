export interface GlmWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginGlmWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<GlmWebAuth> {
	throw new Error("loginGlmWeb: not yet implemented");
}
