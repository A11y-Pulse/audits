import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	describeEachEngine,
	type EngineName,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { AuditRunnerResult } from "../../src/run-audits";
import { type HostileServer, startHostileServer } from "../helpers/hostile-server";

// The built CLI, exactly as `npx @a11y-pulse/audit-runner` runs it. `npm run build` puts it there.
const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

const ENGINE_FLAGS: Record<EngineName, readonly string[]> = {
	puppeteer: [],
	"playwright-chromium": ["--engine", "playwright", "--browser", "chromium"],
	"playwright-firefox": ["--engine", "playwright", "--browser", "firefox"],
	"playwright-webkit": ["--engine", "playwright", "--browser", "webkit"],
};

type Exit = { code: number | null; stdout: string; stderr: string };

type Running = {
	exit: Promise<Exit>;
	pid: number;
	signal: (signal: NodeJS.Signals) => void;
};

/** The processes started directly by `pid`: for the CLI, the browser it launched. */
async function childrenOf(pid: number): Promise<number[]> {
	try {
		const { stdout } = await promisify(execFile)("pgrep", ["-P", String(pid)]);

		return stdout.split("\n").filter(Boolean).map(Number);
	} catch {
		// pgrep exits 1 when there are none.
		return [];
	}
}

function start(args: readonly string[]): Running {
	const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";

	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});

	return {
		exit: new Promise((resolve, reject) => {
			child.on("error", reject);
			child.on("close", (code) => resolve({ code, stdout, stderr }));
		}),
		pid: child.pid ?? 0,
		signal: (signal) => child.kill(signal),
	};
}

let server: HostileServer;
let outputDir: string;

beforeAll(async () => {
	expect(existsSync(CLI), `${CLI} is missing. Run \`npm run build\` first.`).toBe(true);

	server = await startHostileServer();
	outputDir = await mkdtemp(join(tmpdir(), "a11y-pulse-cli-"));
});

afterAll(async () => {
	await server.close();
	await rm(outputDir, { recursive: true, force: true });
});

describeEachEngine<null>(
	"a11y-pulse-runner CLI (e2e)",
	{
		// Only here to pick the engines and skip the ones with no browser: the CLI launches its own.
		adaptor: { puppeteer: () => null, playwright: () => null },
		unsupported: {
			"playwright-webkit": WEBKIT_PARTIAL_TAB_LOOP,
		},
	},
	(engine) => {
		const run = (...args: string[]): Promise<Exit> =>
			start([...args, ...ENGINE_FLAGS[engine.name]]).exit;

		it("exits 0 and writes the JSON report to stdout", async () => {
			const { code, stdout } = await run(`${server.url}/ok.html`);

			expect(code).toBe(0);

			const report = JSON.parse(stdout) as AuditRunnerResult;
			expect(report.url).toBe(`${server.url}/ok.html`);
			expect(report.passes.map((audit) => audit.id)).toEqual(
				expect.arrayContaining(["document-title", "skip-link-activation"]),
			);
		});

		it("writes the report to --output, creating its directory, and leaves stdout empty", async () => {
			const output = join(outputDir, engine.name, "nested", "report.json");
			const { code, stdout, stderr } = await run(`${server.url}/ok.html`, "--output", output);

			expect(code).toBe(0);
			expect(stdout).toBe("");
			expect(stderr).toContain(`Results written to ${output}`);

			const report = JSON.parse(await readFile(output, "utf8")) as AuditRunnerResult;
			expect(report.url).toBe(`${server.url}/ok.html`);
			expect(report.testEngine.name).toBe("axe-core");
		});

		it("prints the readable summary with --format simple", async () => {
			const { code, stdout } = await run(`${server.url}/ok.html`, "--format", "simple");

			expect(code).toBe(0);
			expect(stdout).toContain("No failed audits");
			expect(() => JSON.parse(stdout)).toThrow();
		});

		it("shows a finding that only needs review with --format simple", async () => {
			const { stdout } = await run(`${server.url}/trap.html`, "--format", "simple");
			const [failed, review] = stdout.split("⚠");

			expect(failed).toContain("No failed audits");
			expect(review).toMatch(/audits? needs? review/);
			expect(review).toContain("keyboard-trap");
			expect(review).toContain("#toolbar");
			expect(review).toContain("did not leave via");
		});

		it("leaves out the audits named by --skip", async () => {
			const { code, stdout } = await run(
				`${server.url}/ok.html`,
				"--skip",
				"moving-content,disclosure-operability",
			);

			expect(code).toBe(0);

			const report = JSON.parse(stdout) as AuditRunnerResult;
			const ids = [report.violations, report.incomplete, report.passes, report.inapplicable]
				.flat()
				.map((audit) => audit.id);

			expect(ids).not.toContain("moving-content");
			expect(ids).not.toContain("disclosure-operability");
			expect(ids).toContain("resize-text");
		});

		it("reports the audits that are not skipped, the five-second watch among them", async () => {
			const { code, stdout } = await run(`${server.url}/ok.html`);

			expect(code).toBe(0);

			const report = JSON.parse(stdout) as AuditRunnerResult;
			const ids = [report.violations, report.incomplete, report.passes, report.inapplicable]
				.flat()
				.map((audit) => audit.id);

			expect(ids).toEqual(
				expect.arrayContaining([
					"moving-content",
					"accessible-authentication",
					"keyboard-reachability",
					"control-without-role",
					"resize-text",
					"disclosure-operability",
				]),
			);
		});

		it("exits 1 without a report when the page responds with an HTTP error", async () => {
			for (const [path, status] of [
				["/missing", 404],
				["/error", 500],
			] as const) {
				const { code, stdout, stderr } = await run(`${server.url}${path}`, "--format", "simple");

				expect(code).toBe(1);
				expect(stdout).toBe("");
				expect(stderr).toContain(`responded with HTTP ${status}`);
				expect(stderr).toContain("--ignore-http-errors");
			}
		});

		it("exits 1 without a report when the response is not HTML", async () => {
			const { code, stdout, stderr } = await run(`${server.url}/data.json`);

			expect(code).toBe(1);
			expect(stdout).toBe("");
			expect(stderr).toContain("is application/json, not an HTML page");
		});

		it("audits an error page when told to, and says so", async () => {
			const { code, stdout, stderr } = await run(`${server.url}/missing`, "--ignore-http-errors");

			expect(code).toBe(0);
			expect(stderr).toContain("Warning:");
			expect(stderr).toContain("responded with HTTP 404. Auditing it anyway.");
			expect((JSON.parse(stdout) as AuditRunnerResult).url).toBe(`${server.url}/missing`);
		});

		it("audits a page whose network never goes idle, with a warning", async () => {
			const { code, stdout, stderr } = await run(
				`${server.url}/never-idle.html`,
				"--timeout",
				"1500",
			);

			expect(code).toBe(0);
			expect(stderr).toContain("The network was still busy after 1500ms");
			expect((JSON.parse(stdout) as AuditRunnerResult).url).toBe(`${server.url}/never-idle.html`);
		});

		it("exits 1 when the page does not load within --timeout", async () => {
			const { code, stdout, stderr } = await run(`${server.url}/hang`, "--timeout", "1000");

			expect(code).toBe(1);
			expect(stdout).toBe("");
			expect(stderr).toContain("did not finish loading within 1000ms");
		});

		it("gets past a dialog raised while the page loads", async () => {
			const { code, stdout } = await run(`${server.url}/alert-on-load.html`);

			expect(code).toBe(0);
			expect((JSON.parse(stdout) as AuditRunnerResult).url).toBe(
				`${server.url}/alert-on-load.html`,
			);
		});

		it("reports every audit as incomplete when --max-duration leaves no time for any", async () => {
			const { code, stdout } = await run(`${server.url}/ok.html`, "--max-duration", "1");

			expect(code).toBe(0);

			const report = JSON.parse(stdout) as AuditRunnerResult;
			const unfinished = report.incomplete.filter((audit) =>
				audit.tags.includes("a11y-pulse.audit-failed"),
			);

			expect(unfinished.map((audit) => audit.id)).toContain("reflow");
			expect(unfinished[0]?.description).toContain("1ms time limit");
			expect(report.passes.some((audit) => audit.id === "reflow")).toBe(false);
		});

		it("keeps what the tab pass saw when --max-duration runs out part-way through it", async () => {
			const { code, stdout, stderr } = await run(
				`${server.url}/many-buttons.html`,
				"--max-duration",
				"12000",
				"--skip",
				"moving-content",
			);

			expect(code).toBe(0);
			expect(stderr).toContain("The tab pass reached its limit after");

			const report = JSON.parse(stdout) as AuditRunnerResult;
			const unfinished = report.incomplete
				.filter((audit) => audit.tags.includes("a11y-pulse.audit-failed"))
				.map((audit) => audit.id);

			// The audits that share the pass report on the buttons it reached, not on a timeout.
			expect(unfinished).not.toContain("focus-appearance");
			expect(unfinished).not.toContain("focus-not-obscured");
			expect(unfinished).not.toContain("keyboard-reachability");

			const seen = [report.violations, report.incomplete, report.passes]
				.flat()
				.filter((audit) => audit.id === "focus-not-obscured")
				.flatMap((audit) => audit.nodes);

			expect(seen.length).toBeGreaterThan(10);
			expect(seen.length).toBeLessThan(800);
		});

		it("returns within --max-duration from a page that has stopped responding", async () => {
			const startedAt = Date.now();
			const { code, stdout } = await run(`${server.url}/blocked.html`, "--max-duration", "4000");
			const took = Date.now() - startedAt;

			expect(code).toBe(0);
			// The limit, plus launching and closing a browser whose page will not close cleanly.
			expect(took).toBeLessThan(4000 + 15_000);

			const report = JSON.parse(stdout) as AuditRunnerResult;

			expect(report.url).toBe(`${server.url}/blocked.html`);
			expect(report.passes).toEqual([]);
			expect(report.violations).toEqual([]);
			expect(
				report.incomplete.every((audit) => audit.tags.includes("a11y-pulse.audit-failed")),
			).toBe(true);
			expect(report.incomplete.map((audit) => audit.id)).toEqual(
				expect.arrayContaining(["axe-core", "focus-appearance", "reflow"]),
			);
		});

		it("exits 143 on SIGTERM during the tab pass, reporting nothing", async () => {
			const output = join(outputDir, engine.name, "terminated.json");
			const tabbing = server.requested("/tabbing");
			const running = start([
				`${server.url}/many-buttons.html`,
				"--skip",
				"moving-content",
				"--output",
				output,
				...ENGINE_FLAGS[engine.name],
			]);

			await tabbing;
			running.signal("SIGTERM");

			const { code, stdout, stderr } = await running.exit;

			expect(code).toBe(143);
			expect(stdout).toBe("");
			expect(stderr).not.toContain("Results written");
			expect(existsSync(output)).toBe(false);
			expect(await childrenOf(running.pid)).toEqual([]);
		});

		it("exits 1 without a report when the browser dies mid-run", async () => {
			const tabbing = server.requested("/tabbing");
			const running = start([
				`${server.url}/many-buttons.html`,
				"--skip",
				"moving-content",
				...ENGINE_FLAGS[engine.name],
			]);

			await tabbing;

			const browsers = await childrenOf(running.pid);
			expect(browsers.length).toBeGreaterThan(0);

			for (const pid of browsers) {
				process.kill(pid, "SIGKILL");
			}

			const { code, stdout, stderr } = await running.exit;

			expect(code).toBe(1);
			expect(stdout).toBe("");
			expect(stderr).toContain("closed during the run");
		});

		it("exits 130 when interrupted, without leaving a report", async () => {
			const running = start([`${server.url}/hang`, ...ENGINE_FLAGS[engine.name]]);

			// Long enough for the browser to be up and waiting on a response that never comes.
			await new Promise((resolve) => setTimeout(resolve, 3000));
			running.signal("SIGINT");

			const { code, stdout } = await running.exit;

			expect(code).toBe(130);
			expect(stdout).toBe("");
		});
	},
);

it("exits 1 with the usage on bad arguments, and 0 for --help", async () => {
	const bad = await start(["--nope"]).exit;

	expect(bad.code).toBe(1);
	expect(bad.stderr).toContain("Unknown option: --nope");
	expect(bad.stderr).toContain("Usage:");

	const help = await start(["--help"]).exit;

	expect(help.code).toBe(0);
	expect(help.stdout).toContain("Exit codes:");
	expect(help.stdout).toContain("143  Terminated");
	expect(help.stdout).toContain("need review");

	const unknown = await start(["https://example.com", "--skip", "not-an-audit"]).exit;

	expect(unknown.code).toBe(1);
	expect(unknown.stderr).toContain("Invalid value for --skip: not-an-audit");

	const list = await start(["--list-audits"]).exit;

	expect(list.code).toBe(0);
	expect(list.stdout.trim().split("\n")).toEqual(
		expect.arrayContaining(["axe-core", "moving-content", "disclosure-operability", "reflow"]),
	);
});
