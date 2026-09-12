import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { runSkipLinkAudit } from "@a11y-pulse/skip-link-audit";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`
  <a href="#main">Skip to content</a>
  <nav><a href="/about">About</a></nav>
  <main id="main" tabindex="-1">Hello</main>
`);

const result = await runSkipLinkAudit(new PlaywrightAdaptor(page));

console.log(result.summary);
console.log(result.skipLinks);

await browser.close();
