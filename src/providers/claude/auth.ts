export interface ClaudeWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginClaudeWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<ClaudeWebAuth> {
	throw new Error("loginClaudeWeb: not yet implemented");
}
