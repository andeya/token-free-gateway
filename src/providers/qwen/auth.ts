export interface QwenWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginQwenWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<QwenWebAuth> {
	throw new Error("loginQwenWeb: not yet implemented");
}
