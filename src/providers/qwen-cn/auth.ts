export interface QwenCNWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginQwenCNWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<QwenCNWebAuth> {
	throw new Error("loginQwenCNWeb: not yet implemented");
}
