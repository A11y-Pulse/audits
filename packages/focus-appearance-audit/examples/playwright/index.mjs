import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { runFocusAppearanceAudit } from "@a11y-pulse/focus-appearance-audit";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`
  <button style="outline: 2px solid blue">ok</button>
  <button style="outline: none">bad</button>
`);

const result = await runFocusAppearanceAudit(new PlaywrightAdaptor(page), {
	elementLimit: 10,
});

console.log(result.summary);
console.log(result.elements);

await browser.close();
