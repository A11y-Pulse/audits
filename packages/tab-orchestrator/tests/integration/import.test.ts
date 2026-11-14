import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);
const packageDir = fileURLToPath(new URL("../..", import.meta.url));

// Runs the built package in a process of its own, because the flag is per process.
it("can be imported by a host that forbids building code from strings", async () => {
	if (!existsSync(new URL("../../dist/index.js", import.meta.url))) {
		throw new Error("This test imports the built package. Run `npm run build` first.");
	}

	// Composing page scripts into one function is the only thing that builds code from a string,
	// and it must wait until a session first sends one. Such a host then gets one call per script.
	const { stdout } = await run(
		process.execPath,
		[
			"--disallow-code-generation-from-strings",
			"--input-type=module",
			"--eval",
			[
				'const orchestrator = await import("@a11y-pulse/tab-orchestrator");',
				"console.log(typeof orchestrator.createTabOrchestrator);",
			].join("\n"),
		],
		{ cwd: packageDir },
	);

	expect(stdout.trim()).toBe("function");
});
