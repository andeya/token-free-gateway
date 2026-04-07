import type { ElementHandle, Page } from "playwright-core";

/**
 * Paste text into the currently focused element using a synthetic
 * ClipboardEvent.  Falls back to Ctrl/Cmd+V if the synthetic event
 * does not produce visible input.
 *
 * This is far more reliable than `page.keyboard.type()` for long
 * strings in contenteditable elements and rich-text editors.
 */
export async function pasteText(
	page: Page,
	text: string,
	inputHandle?: ElementHandle | null,
): Promise<void> {
	await page.evaluate((t: string) => {
		const dt = new DataTransfer();
		dt.setData("text/plain", t);
		const el = document.activeElement;
		el?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
	}, text);
	await page.waitForTimeout(400);

	const actual = inputHandle
		? await inputHandle.innerText().catch(() => "")
		: await page.evaluate(() => (document.activeElement as HTMLElement)?.innerText ?? "");

	if (actual.trim().length >= Math.min(text.length * 0.5, 20)) {
		return;
	}

	console.log("[dom-input] synthetic paste missed, retrying via Ctrl+V");
	await page.evaluate(async (t: string) => {
		await navigator.clipboard.writeText(t);
	}, text);
	await page.waitForTimeout(200);
	const mod = process.platform === "darwin" ? "Meta" : "Control";
	await page.keyboard.press(`${mod}+KeyV`);
	await page.waitForTimeout(400);
}
