#!/usr/bin/env node
import puppeteer from "puppeteer";
import { parseArgs, USAGE } from "./cli-args";
import { runAllAudits } from "./run-audits";
import { toJson } from "./serialise";

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

async function main(argv: readonly string[]): Promise<number> {
	const parsed = parseArgs(argv);

	if (parsed.kind === "help") {
		console.log(USAGE);

		return 0;
	}

	if (parsed.kind === "error") {
		console.error(`${parsed.message}\n\n${USAGE}`);

		return 1;
	}

	const browser = await puppeteer.launch({ defaultViewport: DEFAULT_VIEWPORT });

	try {
		const page = await browser.newPage();
		await page.goto(parsed.url, { waitUntil: "networkidle2" });

		console.log(toJson(await runAllAudits(page)));
	} finally {
		await browser.close();
	}

	return 0;
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
