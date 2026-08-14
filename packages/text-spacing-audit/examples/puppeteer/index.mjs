import { runTextSpacingAudit } from "@a11y-pulse/text-spacing-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/text-spacing-audit/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`
  <p>Spacious copy that can reflow when spacing increases.</p>
  <div style="height: 20px; overflow: hidden; font: 16px/1.2 sans-serif; width: 40rem">
    Hello there, a single line of copy.
  </div>
`);

const result = await runTextSpacingAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
console.log(result.findings);

await browser.close();
