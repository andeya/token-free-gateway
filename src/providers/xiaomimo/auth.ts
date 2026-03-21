export interface XiaomiMimoWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginXiaomiMimoWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<XiaomiMimoWebAuth> {
	throw new Error("loginXiaomiMimoWeb: not yet implemented");
}
