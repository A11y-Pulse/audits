import { runResizeTextAudit } from "@a11y-pulse/resize-text-audit";
import { PlaywrightAdaptor } from "@a11y-pulse/resize-text-audit/playwright";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.setContent(`
  <p>Copy that is free to wrap onto more lines when the page is zoomed.</p>
  <div style="width: 40vw; height: 30px; overflow: hidden; font: 16px/1.5 sans-serif">
    A promotional banner whose box is one line tall however much text it holds.
  </div>
`);

const result = await runResizeTextAudit(new PlaywrightAdaptor(page));

console.log(result.summary);
console.log(result.findings);

await browser.close();
