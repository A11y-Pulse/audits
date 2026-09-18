// Repro harness: run the production tab-audit stack against unoenergy.it and report how the nav
// links (which draw their focus indicator on a child .btn__content) are classified.
//
//   node scripts/repro-unoenergy.mjs [runs=1] [parallel=1] [url]
//
// Evidence PNGs for failed nav links are written to scripts/out/.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import { createContextChangeOnFocusAudit } from "@a11y-pulse/context-change-on-focus-audit";
import { createFocusNotObscuredAudit } from "@a11y-pulse/focus-not-obscured-audit";
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";
import puppeteer from "puppeteer";
import { createFocusAppearanceAudit } from "../dist/index.js";

const runs = Number(process.argv[2] ?? 1);
const parallel = Number(process.argv[3] ?? 1);
const url = process.argv[4] ?? "https://www.unoenergy.it/";
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(outDir, { recursive: true });

const NAV_LINK = /js-trigger--link/;

async function runOnce(label) {
	const browser = await puppeteer.launch({
		defaultViewport: { width: 1280, height: 800 },
		headless: process.env.HEADLESS === "shell" ? "shell" : true,
		args: (process.env.CHROME_ARGS ?? "").split(" ").filter(Boolean),
	});

	try {
		const page = await browser.newPage();
		if (process.env.CPU_THROTTLE || process.env.NET_THROTTLE) {
			const cdp = await page.createCDPSession();
			if (process.env.CPU_THROTTLE) {
				await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU_THROTTLE) });
			}
			if (process.env.NET_THROTTLE) {
				await cdp.send("Network.enable");
				await cdp.send("Network.emulateNetworkConditions", {
					offline: false,
					latency: 300,
					downloadThroughput: (Number(process.env.NET_THROTTLE) * 1024) / 8,
					uploadThroughput: (64 * 1024) / 8,
				});
			}
		}
		try {
			await page.goto(url, { waitUntil: "networkidle2", timeout: 120_000 });
		} catch (error) {
			console.log(`[${label}] networkidle2 timed out, continuing after load: ${error.message}`);
		}

		if (process.env.CONSENT) {
			// Mimic a runner that dismisses the Cookiebot dialog before auditing.
			const id =
				process.env.CONSENT === "accept"
					? "CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll"
					: "CybotCookiebotDialogBodyButtonDecline";
			try {
				await page.waitForSelector(`#${id}`, { timeout: 15_000 });
				await page.click(`#${id}`);
				await new Promise((r) => setTimeout(r, 1500));
				console.log(`[${label}] consent: clicked ${process.env.CONSENT}`);
			} catch {
				console.log(`[${label}] consent: dialog not found`);
			}
		}
		// Record every viewport size the page itself observes during the audit.
		await page.evaluate(() => {
			window.__sizes = [[performance.now(), innerWidth, innerHeight, "start"]];
			addEventListener("resize", () => window.__sizes.push([performance.now(), innerWidth, innerHeight, "resize"]));
			matchMedia("(width < 1025px)").addEventListener("change", (ev) =>
				window.__sizes.push([performance.now(), innerWidth, innerHeight, ev.matches ? "mq:mobile" : "mq:desktop"]),
			);
		});
		const adaptor = new PuppeteerAdaptor(page);
		if (process.env.BEYOND === "false") {
			adaptor.screenshotClip = async (clip, scale = 1) => {
				await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
				return page.screenshot({ type: "png", optimizeForSpeed: true, captureBeyondViewport: false, clip: { ...clip, scale } });
			};
		}
		// Instrumentation: record focus state around every clipped screenshot so a missing ring can be
		// attributed to lost emulation, moved focus, or a stale frame.
		const shots = [];
		const probeState = () =>
			page.evaluate(() => {
				const a = document.activeElement;
				const c = a?.querySelector?.(".btn__content");
				const cs = c ? getComputedStyle(c) : null;
				return {
					hasFocus: document.hasFocus(),
					active: a ? `${a.tagName.toLowerCase()}#${a.id || ""}` : null,
					matchesFocus: a?.matches?.(":focus") ?? null,
					outline: cs ? `${cs.outlineStyle} ${cs.outlineWidth}` : null,
				};
			});
		const origShot = adaptor.screenshotClip.bind(adaptor);
		adaptor.screenshotClip = async (clip, scale) => {
			const before = await probeState();
			const t0 = Date.now();
			const png = await origShot(clip, scale);
			const after = await probeState();
			shots.push({ before, after, ms: Date.now() - t0, clip });
			return png;
		};
		const focusAppearance = createFocusAppearanceAudit({ elementLimit: 40 });
		const focusNotObscured = createFocusNotObscuredAudit({ elementLimit: 40 });
		const contextChange = createContextChangeOnFocusAudit({ elementLimit: 40 });
		const orchestrator = createTabOrchestrator(adaptor, { markerLimit: 40, baselineElementLimit: 80 });
		orchestrator.attach(focusAppearance);
		orchestrator.attach(focusNotObscured);
		orchestrator.attach(contextChange);
		await orchestrator.run();

		const nav = focusAppearance.result.elements.filter((e) => NAV_LINK.test(e.html));
		const lines = nav.map((e) => {
			const id = (/id="([^"]+)"/.exec(e.html)?.[1] ?? e.selector).replace(/[^\w.-]+/g, "_").slice(0, 80);
			if (e.failureEvidence) {
				writeFileSync(path.join(outDir, `${label}-${id}-focused.png`), e.failureEvidence.focusedScreenshot);
				writeFileSync(path.join(outDir, `${label}-${id}-unfocused.png`), e.failureEvidence.unfocusedScreenshot);
			}
			return `  #${e.tabIndex} ${id.padEnd(14)} ${e.passed ? "PASS" : "FAIL"} ${e.detectionMethod ?? "-"}`;
		});

		for (const shot of shots) {
			const changed = JSON.stringify(shot.before) !== JSON.stringify(shot.after);
			const suspicious = !shot.before.hasFocus || !shot.after.hasFocus || changed;
			if (suspicious || process.env.DUMP_SHOTS) {
				console.log(`  shot ${shot.ms}ms ${suspicious ? "SUSPICIOUS" : ""} before=${JSON.stringify(shot.before)} after=${JSON.stringify(shot.after)}`);
			}
		}
		const sizes = await page.evaluate(() => window.__sizes);
		const odd = sizes.filter(([, w, h]) => w !== 1280 || h !== 800);
		console.log(`  viewport events: ${sizes.length}, not 1280x800: ${odd.length} ${JSON.stringify(odd.slice(0, 12))}`);
		const s = focusAppearance.result.summary;
		console.log(`[${label}] checked=${s.checked} passed=${s.passed} failed=${s.failed} end=${s.sessionEnd} navFailed=${nav.filter((e) => !e.passed).length}/${nav.length}`);
		console.log(lines.join("\n"));
		if (process.env.DUMP_ALL) for (const e of focusAppearance.result.elements) console.log(`  all #${e.tabIndex} ${e.passed ? "PASS" : "FAIL"} ${e.detectionMethod ?? "-"} ${e.selector} ${e.html.slice(0, 120)}`);

		return { nav, all: focusAppearance.result.elements };
	} finally {
		await browser.close();
	}
}

let navFailed = 0;
let navTotal = 0;
for (let i = 0; i < runs; i += parallel) {
	const batch = [];
	for (let j = 0; j < parallel && i + j < runs; j++) {
		batch.push(runOnce(`run${i + j}`));
	}
	for (const r of await Promise.allSettled(batch)) {
		if (r.status === "rejected") {
			console.log(`run failed: ${r.reason?.message ?? r.reason}`);
			continue;
		}
		navTotal += r.value.nav.length;
		navFailed += r.value.nav.filter((e) => !e.passed).length;
	}
}
console.log(`\nnav links failed: ${navFailed}/${navTotal}`);
