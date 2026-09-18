// Probe: raw CDP Page.captureScreenshot with captureBeyondViewport=false and a document-coordinate
// clip, for an element outside and inside the current viewport.
import { PNG } from "pngjs";
import puppeteer from "puppeteer";

const html = `<!doctype html><body style="margin:0;height:5000px;background:#fff">
<div id="box" style="position:absolute;left:100px;top:3000px;width:60px;height:40px;background:#f00"></div></body>`;
const browser = await puppeteer.launch({ defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
await page.goto(`data:text/html,${encodeURIComponent(html)}`);
const cdp = await page.createCDPSession();
await page.evaluate(() => { window.__resizes = 0; addEventListener("resize", () => window.__resizes++); });

for (const beyond of [true, false]) {
	for (const scrollY of [0, 2800, 2990]) {
		await page.evaluate((s) => window.scrollTo(0, s), scrollY);
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
		const before = await page.evaluate(() => window.__resizes);
		const { data } = await cdp.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: beyond,
			clip: { x: 90, y: 2990, width: 80, height: 60, scale: 2 },
		});
		const png = PNG.sync.read(Buffer.from(data, "base64"));
		let red = 0;
		for (let i = 0; i < png.data.length; i += 4) if (png.data[i] > 200 && png.data[i + 1] < 50) red++;
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
		const after = await page.evaluate(() => window.__resizes);
		console.log(`beyond=${beyond} scrollY=${scrollY} size=${png.width}x${png.height} redPixels=${red}/9600 resizeEvents=${after - before}`);
	}
}
await browser.close();
