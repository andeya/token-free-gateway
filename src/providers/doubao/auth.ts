export interface DoubaoWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginDoubaoWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<DoubaoWebAuth> {
	throw new Error("loginDoubaoWeb: not yet implemented");
}
