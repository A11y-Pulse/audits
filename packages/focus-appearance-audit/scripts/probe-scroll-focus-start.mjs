// Probe: does scrollIntoView() move Chromium's sequential focus navigation starting point?
import puppeteer from "puppeteer";

const html = `<!doctype html><body style="margin:8px">
<div id="host"></div><button id="after">After</button>
<script>const r=document.getElementById("host").attachShadow({mode:"closed"});r.innerHTML='<button id="inner">Shadow</button>';</script></body>`;
const browser = await puppeteer.launch({ defaultViewport: { width: 800, height: 600 } });
const page = await browser.newPage();
const cdp = await page.createCDPSession();

for (const variant of ["none", "scrollIntoView", "window.scrollBy"]) {
	await page.goto(`data:text/html,${encodeURIComponent(html)}`);
	await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
	await page.keyboard.press("Tab");
	const focusedBefore = await page.evaluate(() => document.activeElement?.id);
	await page.evaluate((v) => {
		const host = document.getElementById("host");
		host.blur();
		if (v === "scrollIntoView") host.scrollIntoView({ block: "center", behavior: "instant" });
		if (v === "window.scrollBy") window.scrollBy({ top: 0, left: 0, behavior: "instant" });
		host.focus({ preventScroll: true });
	}, variant);
	const afterRestore = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
	await page.keyboard.press("Tab");
	const afterTab = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
	console.log(`${variant.padEnd(16)} focused=${focusedBefore} afterBlurRestore=${afterRestore} afterTab=${afterTab}`);
}
await browser.close();
