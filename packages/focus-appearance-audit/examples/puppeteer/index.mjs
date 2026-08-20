import { runFocusAppearanceAudit } from "@a11y-pulse/focus-appearance-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/tab-orchestrator/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`
  <button style="outline: 2px solid blue">ok</button>
  <button style="outline: none">bad</button>
`);

const result = await runFocusAppearanceAudit(new PuppeteerAdaptor(page), {
	elementLimit: 10,
});

console.log(result.summary);
console.log(result.elements);

await browser.close();
