export interface ChatGPTWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginChatGPTWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<ChatGPTWebAuth> {
	throw new Error("loginChatGPTWeb: not yet implemented");
}
