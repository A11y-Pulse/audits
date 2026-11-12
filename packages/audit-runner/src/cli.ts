#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { openPage, type Session } from "./browsers";
import { DEFAULT_MAX_DURATION, parseArgs, USAGE } from "./cli-args";
import { formatSimple } from "./format-simple";
import { AUDIT_IDS, runAllAudits } from "./run-audits";
import { toJson } from "./serialise";
import { createSpinner } from "./spinner";

const EXIT_OK = 0;
const EXIT_FAILED = 1;

// The shell convention for a process ended by a signal: 128 plus the signal's number.
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

// Milliseconds the process is given to exit by itself once it has finished, before it is made to.
// A browser that had to be abandoned mid-step can leave a handle open that would keep it alive.
const EXIT_GRACE_MS = 5_000;

// Set by the first signal. From then on nothing is reported: a run cut short has no results, only
// whatever the audits made of a browser closing under them.
let interruption: { code: number } | undefined;

/** End the process with the signal's exit code if one has arrived, closing the browser first. */
async function stopIfInterrupted(session: Session | undefined): Promise<void> {
	if (interruption === undefined) {
		return;
	}

	await session?.close().catch(() => {});
	process.exit(interruption.code);
}

async function main(argv: readonly string[]): Promise<number> {
	const parsed = parseArgs(argv, AUDIT_IDS);

	if (parsed.kind === "help") {
		console.log(USAGE);

		return EXIT_OK;
	}

	if (parsed.kind === "list-audits") {
		console.log(AUDIT_IDS.join("\n"));

		return EXIT_OK;
	}

	if (parsed.kind === "error") {
		console.error(`${parsed.message}\n\n${USAGE}`);

		return EXIT_FAILED;
	}

	const spinner = createSpinner(process.stderr);
	// Held back until the spinner has stopped, so they are not drawn over.
	const warnings: string[] = [];
	const onWarning = (message: string): void => {
		warnings.push(message);
	};

	let session: Session | undefined;

	// Both automation libraries kill their browser on a signal, but only once it has launched and
	// without waiting for this process to tidy up. Closing it here covers the rest of the run.
	const signalHandlers = Object.entries(SIGNAL_EXIT_CODES).map(([signal, code]) => {
		const handler = (): void => {
			if (interruption !== undefined) {
				return;
			}

			interruption = { code };
			spinner.stop();

			void stopIfInterrupted(session);
		};

		process.on(signal, handler);

		return [signal, handler] as const;
	});

	let report: string;

	try {
		session = await openPage(parsed.url, parsed.engine, parsed.browser, {
			onProgress: spinner.update,
			onWarning,
			timeout: parsed.timeout,
			ignoreHttpErrors: parsed.ignoreHttpErrors,
		});

		// A signal that arrived while the browser was launching found no session to close.
		await stopIfInterrupted(session);

		try {
			const results = await runAllAudits(session.adaptors, {
				onProgress: spinner.update,
				onWarning,
				maxDuration: parsed.maxDuration ?? DEFAULT_MAX_DURATION,
				skip: parsed.skip,
				url: parsed.url,
			});
			const color = parsed.output === undefined && process.stdout.hasColors?.() === true;

			report = parsed.format === "simple" ? formatSimple(results, color) : toJson(results);
		} finally {
			// Whatever the run returned or threw after a signal is what the audits made of the browser
			// being closed under them, so it is neither reported nor allowed to set the exit code.
			await stopIfInterrupted(session);

			spinner.update("Closing browser");
			await session.close();
		}
	} finally {
		spinner.stop();

		for (const [signal, handler] of signalHandlers) {
			process.off(signal, handler);
		}

		for (const warning of warnings) {
			console.error(`Warning: ${warning}`);
		}
	}

	await stopIfInterrupted(session);

	if (parsed.output === undefined) {
		console.log(report);

		return EXIT_OK;
	}

	const outputPath = resolve(parsed.output);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${report}\n`);
	console.error(`Results written to ${outputPath}`);

	return EXIT_OK;
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	await stopIfInterrupted(undefined);

	console.error(error instanceof Error ? error.message : error);
	process.exitCode = EXIT_FAILED;
}

// Unreferenced, so it only fires when something else is still holding the process open.
setTimeout(() => process.exit(), EXIT_GRACE_MS).unref();
