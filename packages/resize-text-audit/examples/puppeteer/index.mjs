import { runResizeTextAudit } from "@a11y-pulse/resize-text-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/resize-text-audit/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch({
	headless: true,
	defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
await page.setContent(`
  <p>Copy that is free to wrap onto more lines when the page is zoomed.</p>
  <div style="width: 40vw; height: 30px; overflow: hidden; font: 16px/1.5 sans-serif">
    A promotional banner whose box is one line tall however much text it holds.
  </div>
`);

const result = await runResizeTextAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
console.log(result.findings);

await browser.close();
