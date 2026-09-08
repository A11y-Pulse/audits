export const USAGE = `Usage: npx @a11y-pulse/audit-runner <url>

Runs every A11y Pulse accessibility audit against <url> and writes the
combined results to stdout as JSON.

Options:
  -h, --help  Show this message`;

export type ParsedArgs =
	| { kind: "run"; url: string }
	| { kind: "help" }
	| { kind: "error"; message: string };

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
	if (argv.includes("-h") || argv.includes("--help")) {
		return { kind: "help" };
	}

	const positional = argv.filter((arg) => !arg.startsWith("-"));
	const unknownFlag = argv.find((arg) => arg.startsWith("-"));

	if (unknownFlag) {
		return { kind: "error", message: `Unknown option: ${unknownFlag}` };
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

	return { kind: "run", url: parsed.href };
}
