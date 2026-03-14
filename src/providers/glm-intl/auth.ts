export interface GlmIntlWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginGlmIntlWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<GlmIntlWebAuth> {
	throw new Error("loginGlmIntlWeb: not yet implemented");
}
