import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli-args";

describe("parseArgs", () => {
	it("accepts a single http(s) url, defaulting to puppeteer and chromium", () => {
		expect(parseArgs(["https://example.com/a"])).toEqual({
			kind: "run",
			url: "https://example.com/a",
			engine: "puppeteer",
			browser: "chromium",
			format: "json",
		});
		expect(parseArgs(["http://localhost:3000"])).toEqual({
			kind: "run",
			url: "http://localhost:3000/",
			engine: "puppeteer",
			browser: "chromium",
			format: "json",
		});
	});

	it("accepts an engine and browser, spelled either way", () => {
		expect(parseArgs(["--engine", "playwright", "https://a.test"])).toEqual({
			kind: "run",
			url: "https://a.test/",
			engine: "playwright",
			browser: "chromium",
			format: "json",
		});
		expect(parseArgs(["https://a.test", "--engine=playwright", "--browser=webkit"])).toEqual({
			kind: "run",
			url: "https://a.test/",
			engine: "playwright",
			browser: "webkit",
			format: "json",
		});
	});

	it("rejects an unsupported engine or browser", () => {
		expect(parseArgs(["--engine", "selenium", "https://a.test"])).toEqual({
			kind: "error",
			message: "Unsupported engine: selenium. Expected puppeteer or playwright.",
		});
		expect(parseArgs(["--engine", "playwright", "--browser", "edge", "https://a.test"])).toEqual({
			kind: "error",
			message: "Unsupported browser: edge. Expected chromium, firefox, webkit.",
		});
	});

	it("accepts an output file, spelled any way", () => {
		const expected = {
			kind: "run",
			url: "https://a.test/",
			engine: "puppeteer",
			browser: "chromium",
			format: "json",
			output: "out/results.json",
		};

		expect(parseArgs(["https://a.test", "-o", "out/results.json"])).toStrictEqual(expected);
		expect(parseArgs(["--output", "out/results.json", "https://a.test"])).toStrictEqual(expected);
		expect(parseArgs(["https://a.test", "--output=out/results.json"])).toStrictEqual(expected);
	});

	it("accepts a format", () => {
		expect(parseArgs(["https://a.test", "--format", "simple"])).toMatchObject({
			kind: "run",
			format: "simple",
		});
		expect(parseArgs(["https://a.test"])).toMatchObject({ kind: "run", format: "json" });
	});

	it("rejects an unsupported format", () => {
		expect(parseArgs(["https://a.test", "--format=pretty"])).toEqual({
			kind: "error",
			message: "Unsupported format: pretty. Expected json or simple.",
		});
	});

	it("rejects an empty output file", () => {
		expect(parseArgs(["https://a.test", "--output="])).toEqual({
			kind: "error",
			message: "Missing value for --output.",
		});
	});

	it("rejects --browser without playwright", () => {
		expect(parseArgs(["--browser", "firefox", "https://a.test"])).toEqual({
			kind: "error",
			message: "--browser requires --engine playwright.",
		});
	});

	it("rejects a flag with no value", () => {
		expect(parseArgs(["https://a.test", "--engine"])).toEqual({
			kind: "error",
			message: "Missing value for --engine.",
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
