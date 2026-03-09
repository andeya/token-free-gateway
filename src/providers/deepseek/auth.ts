export interface DeepSeekWebCredentials {
	cookie: string;
	userAgent: string;
}

export async function loginDeepseekWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<DeepSeekWebCredentials> {
	throw new Error("loginDeepseekWeb: not yet implemented");
}
