#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { openPage } from "./browsers";
import { parseArgs, USAGE } from "./cli-args";
import { formatSimple } from "./format-simple";
import { runAllAudits } from "./run-audits";
import { toJson } from "./serialise";
import { createSpinner } from "./spinner";

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

	const spinner = createSpinner(process.stderr);
	let report: string;

	try {
		const session = await openPage(parsed.url, parsed.engine, parsed.browser, spinner.update);

		try {
			const results = await runAllAudits(session.adaptors, { onProgress: spinner.update });
			const color = parsed.output === undefined && process.stdout.hasColors?.() === true;

			report = parsed.format === "simple" ? formatSimple(results, color) : toJson(results);
		} finally {
			spinner.update("Closing browser");
			await session.close();
		}
	} finally {
		spinner.stop();
	}

	if (parsed.output === undefined) {
		console.log(report);

		return 0;
	}

	const outputPath = resolve(parsed.output);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${report}\n`);
	console.error(`Results written to ${outputPath}`);

	return 0;
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
