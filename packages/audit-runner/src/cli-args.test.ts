import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli-args";

describe("parseArgs", () => {
	it("accepts a single http(s) url", () => {
		expect(parseArgs(["https://example.com/a"])).toEqual({
			kind: "run",
			url: "https://example.com/a",
		});
		expect(parseArgs(["http://localhost:3000"])).toEqual({
			kind: "run",
			url: "http://localhost:3000/",
		});
	});

	it("reports help for -h and --help", () => {
		expect(parseArgs(["-h"])).toEqual({ kind: "help" });
		expect(parseArgs(["https://example.com", "--help"])).toEqual({ kind: "help" });
	});

	it("rejects a missing url", () => {
		expect(parseArgs([])).toEqual({ kind: "error", message: "Missing <url>." });
	});

	it("rejects more than one url", () => {
		expect(parseArgs(["https://a.test", "https://b.test"])).toEqual({
			kind: "error",
			message: "Expected exactly one <url>.",
		});
	});

	it("rejects an unrecognised flag", () => {
		expect(parseArgs(["--json", "https://a.test"])).toEqual({
			kind: "error",
			message: "Unknown option: --json",
		});
	});

	it("rejects an unparseable url", () => {
		expect(parseArgs(["example.com"])).toEqual({
			kind: "error",
			message: "Not a valid URL: example.com",
		});
	});

	it("rejects a non-http protocol", () => {
		expect(parseArgs(["file:///etc/passwd"])).toEqual({
			kind: "error",
			message: "Unsupported protocol: file:",
		});
	});
});
