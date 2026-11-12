export const USAGE = `Usage: npx @a11y-pulse/audit-runner <url> [options]

Runs every A11y Pulse accessibility audit against <url> and writes the
combined results to stdout, or to a file with --output.

Options:
  -o, --output <file>  Write the results to <file> instead of stdout
  --format <name>      json (default) for the full axe-core results, or
                       simple for a readable list of the audits that failed
                       and the ones that need review
  --engine <name>      Automation library to drive the page with: puppeteer
                       (default) or playwright
  --browser <name>     Browser to launch: chromium (default), firefox or
                       webkit. Requires --engine playwright
  --timeout <ms>       Milliseconds to wait for the page to load (default
                       30000)
  --max-duration <ms>  Milliseconds the audits may take in total before the
                       rest are reported as incomplete (default 600000, 0
                       for no limit)
  --ignore-http-errors Audit the page even when it responds with an HTTP
                       error status or is not HTML
  --skip <ids>         Comma-separated ids of audits to leave out, such as
                       moving-content,disclosure-operability. May be given
                       more than once. --list-audits prints the ids
  --list-audits        Print the id of every audit and exit
  -h, --help           Show this message

Exit codes:
  0    The audits ran, whether or not the page passed them
  1    The run failed: bad arguments, the page did not load, or the browser
       crashed
  130  Interrupted (Ctrl+C). Nothing is reported
  143  Terminated (SIGTERM). Nothing is reported`;

/** Milliseconds the CLI gives every audit together, unless told otherwise. */
export const DEFAULT_MAX_DURATION = 600_000;

export const ENGINES = ["puppeteer", "playwright"] as const;

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;

export const FORMATS = ["json", "simple"] as const;

export type Engine = (typeof ENGINES)[number];

export type Browser = (typeof BROWSERS)[number];

export type Format = (typeof FORMATS)[number];

export type ParsedArgs =
	| {
			kind: "run";
			url: string;
			engine: Engine;
			browser: Browser;
			format: Format;
			output: string | undefined;
			/** Milliseconds to wait for the page to load, when given. */
			timeout?: number;
			/** Milliseconds every audit together may take, when given. 0 is no limit. */
			maxDuration?: number;
			/** Set when the page should be audited whatever its status or content type. */
			ignoreHttpErrors?: true;
			/** Ids of audits to leave out, when any were given. */
			skip?: string[];
	  }
	| { kind: "help" }
	| { kind: "list-audits" }
	| { kind: "error"; message: string };

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

const OUTPUT_FLAGS = new Set(["-o", "--output"]);

const VALUE_FLAGS = new Set([
	"--engine",
	"--browser",
	"--format",
	"--timeout",
	"--max-duration",
	"--skip",
	...OUTPUT_FLAGS,
]);

const WHOLE_NUMBER = /^\d+$/;

function splitFlag(arg: string): [string, string | undefined] {
	const equals = arg.indexOf("=");

	return equals === -1 ? [arg, undefined] : [arg.slice(0, equals), arg.slice(equals + 1)];
}

/**
 * Parse the command line. `auditIds` are the ids `--skip` accepts; without them any id is taken
 * and left for the run to reject.
 */
export function parseArgs(argv: readonly string[], auditIds?: readonly string[]): ParsedArgs {
	if (argv.includes("-h") || argv.includes("--help")) {
		return { kind: "help" };
	}

	if (argv.includes("--list-audits")) {
		return { kind: "list-audits" };
	}

	const positional: string[] = [];
	let engine: Engine = "puppeteer";
	let browser: Browser = "chromium";
	let browserGiven = false;
	let format: Format = "json";
	let output: string | undefined;
	let timeout: number | undefined;
	let maxDuration: number | undefined;
	let ignoreHttpErrors: true | undefined;
	const skip: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;

		if (!arg.startsWith("-")) {
			positional.push(arg);

			continue;
		}

		const [flag, inline] = splitFlag(arg);

		if (flag === "--ignore-http-errors") {
			if (inline !== undefined) {
				return { kind: "error", message: `${flag} does not take a value.` };
			}

			ignoreHttpErrors = true;

			continue;
		}

		if (!VALUE_FLAGS.has(flag)) {
			return { kind: "error", message: `Unknown option: ${flag}` };
		}

		const value = inline ?? argv[++i];

		if (!value) {
			return { kind: "error", message: `Missing value for ${flag}.` };
		}

		if (OUTPUT_FLAGS.has(flag)) {
			output = value;
		} else if (flag === "--skip") {
			const ids = value
				.split(",")
				.map((id) => id.trim())
				.filter((id) => id !== "");
			const unknown = auditIds ? ids.filter((id) => !auditIds.includes(id)) : [];

			if (ids.length === 0 || unknown.length > 0) {
				return {
					kind: "error",
					message: `Invalid value for ${flag}: ${unknown.join(", ") || value}. Run with --list-audits for the ids it accepts.`,
				};
			}

			skip.push(...ids.filter((id) => !skip.includes(id)));
		} else if (flag === "--timeout" || flag === "--max-duration") {
			const milliseconds = WHOLE_NUMBER.test(value) ? Number(value) : Number.NaN;

			// No limit on the run is a choice. No limit on a page load is a hang waiting to happen.
			if (!Number.isSafeInteger(milliseconds) || (flag === "--timeout" && milliseconds === 0)) {
				return {
					kind: "error",
					message: `Invalid value for ${flag}: ${value}. Expected a number of milliseconds.`,
				};
			}

			if (flag === "--timeout") {
				timeout = milliseconds;
			} else {
				maxDuration = milliseconds;
			}
		} else if (flag === "--format") {
			if (!(FORMATS as readonly string[]).includes(value)) {
				return {
					kind: "error",
					message: `Unsupported format: ${value}. Expected ${FORMATS.join(" or ")}.`,
				};
			}

			format = value as Format;
		} else if (flag === "--engine") {
			if (!(ENGINES as readonly string[]).includes(value)) {
				return {
					kind: "error",
					message: `Unsupported engine: ${value}. Expected ${ENGINES.join(" or ")}.`,
				};
			}

			engine = value as Engine;
		} else {
			if (!(BROWSERS as readonly string[]).includes(value)) {
				return {
					kind: "error",
					message: `Unsupported browser: ${value}. Expected ${BROWSERS.join(", ")}.`,
				};
			}

			browser = value as Browser;
			browserGiven = true;
		}
	}

	if (browserGiven && engine !== "playwright") {
		return { kind: "error", message: "--browser requires --engine playwright." };
	}

	const [url, ...extra] = positional;

	if (url === undefined) {
		return { kind: "error", message: "Missing <url>." };
	}

	if (extra.length > 0) {
		return { kind: "error", message: "Expected exactly one <url>." };
	}

	let parsed: URL;

	try {
		parsed = new URL(url);
	} catch {
		return { kind: "error", message: `Not a valid URL: ${url}` };
	}

	if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
		return { kind: "error", message: `Unsupported protocol: ${parsed.protocol}` };
	}

	return {
		kind: "run",
		url: parsed.href,
		engine,
		browser,
		format,
		output,
		...(timeout !== undefined && { timeout }),
		...(maxDuration !== undefined && { maxDuration }),
		...(ignoreHttpErrors && { ignoreHttpErrors }),
		...(skip.length > 0 && { skip }),
	};
}
