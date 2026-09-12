export const USAGE = `Usage: npx @a11y-pulse/audit-runner <url> [options]

Runs every A11y Pulse accessibility audit against <url> and writes the
combined results to stdout as JSON.

Options:
  --engine <name>   Automation library to drive the page with: puppeteer
                    (default) or playwright
  --browser <name>  Browser to launch: chromium (default), firefox or
                    webkit. Requires --engine playwright
  -h, --help        Show this message`;

export const ENGINES = ["puppeteer", "playwright"] as const;

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;

export type Engine = (typeof ENGINES)[number];

export type Browser = (typeof BROWSERS)[number];

export type ParsedArgs =
	| { kind: "run"; url: string; engine: Engine; browser: Browser }
	| { kind: "help" }
	| { kind: "error"; message: string };

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

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

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;

		if (!arg.startsWith("-")) {
			positional.push(arg);

			continue;
		}

		const [flag, inline] = splitFlag(arg);

		if (flag !== "--engine" && flag !== "--browser") {
			return { kind: "error", message: `Unknown option: ${flag}` };
		}

		const value = inline ?? argv[++i];

		if (value === undefined) {
			return { kind: "error", message: `Missing value for ${flag}.` };
		}

		if (flag === "--engine") {
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

	return { kind: "run", url: parsed.href, engine, browser };
}
