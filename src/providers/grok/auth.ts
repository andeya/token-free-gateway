export interface GrokWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginGrokWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<GrokWebAuth> {
	throw new Error("loginGrokWeb: not yet implemented");
}
