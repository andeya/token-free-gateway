export interface KimiWebAuth {
	cookie: string;
	userAgent: string;
}

export async function loginKimiWeb(params: {
	onProgress: (msg: string) => void;
	openUrl: (url: string) => Promise<boolean>;
}): Promise<KimiWebAuth> {
	throw new Error("loginKimiWeb: not yet implemented");
}
