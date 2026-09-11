#!/usr/bin/env node
import { openPage } from "./browsers";
import { parseArgs, USAGE } from "./cli-args";
import { runAllAudits } from "./run-audits";
import { toJson } from "./serialise";

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

	const session = await openPage(parsed.url, parsed.engine, parsed.browser);

	try {
		console.log(toJson(await runAllAudits(session.adaptors)));
	} finally {
		await session.close();
	}

	return 0;
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
