export const USAGE = `Usage: npx @a11y-pulse/audit-runner <url> [options]

Runs every A11y Pulse accessibility audit against <url> and writes the
combined results to stdout, or to a file with --output.

Options:
  -o, --output <file>  Write the results to <file> instead of stdout
  --format <name>      json (default) for the full axe-core results, or
                       simple for a readable list of failed audits
  --engine <name>      Automation library to drive the page with: puppeteer
                       (default) or playwright
  --browser <name>     Browser to launch: chromium (default), firefox or
                       webkit. Requires --engine playwright
  -h, --help           Show this message`;

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
	  }
	| { kind: "help" }
	| { kind: "error"; message: string };

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

const OUTPUT_FLAGS = new Set(["-o", "--output"]);

function splitFlag(arg: string): [string, string | undefined] {
	const equals = arg.indexOf("=");

	return equals === -1 ? [arg, undefined] : [arg.slice(0, equals), arg.slice(equals + 1)];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
	if (argv.includes("-h") || argv.includes("--help")) {
		return { kind: "help" };
	}

	const positional: string[] = [];
	let engine: Engine = "puppeteer";
	let browser: Browser = "chromium";
	let browserGiven = false;
	let format: Format = "json";
	let output: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;

		if (!arg.startsWith("-")) {
			positional.push(arg);

			continue;
		}

		const [flag, inline] = splitFlag(arg);

		if (
			flag !== "--engine" &&
			flag !== "--browser" &&
			flag !== "--format" &&
			!OUTPUT_FLAGS.has(flag)
		) {
			return { kind: "error", message: `Unknown option: ${flag}` };
		}

		const value = inline ?? argv[++i];

		if (!value) {
			return { kind: "error", message: `Missing value for ${flag}.` };
		}

		if (OUTPUT_FLAGS.has(flag)) {
			output = value;
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

	return { kind: "run", url: parsed.href, engine, browser, format, output };
}
