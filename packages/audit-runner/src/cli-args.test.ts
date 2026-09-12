import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli-args";

describe("parseArgs", () => {
	it("accepts a single http(s) url, defaulting to puppeteer and chromium", () => {
		expect(parseArgs(["https://example.com/a"])).toEqual({
			kind: "run",
			url: "https://example.com/a",
			engine: "puppeteer",
			browser: "chromium",
		});
		expect(parseArgs(["http://localhost:3000"])).toEqual({
			kind: "run",
			url: "http://localhost:3000/",
			engine: "puppeteer",
			browser: "chromium",
		});
	});

	it("accepts an engine and browser, spelled either way", () => {
		expect(parseArgs(["--engine", "playwright", "https://a.test"])).toEqual({
			kind: "run",
			url: "https://a.test/",
			engine: "playwright",
			browser: "chromium",
		});
		expect(parseArgs(["https://a.test", "--engine=playwright", "--browser=webkit"])).toEqual({
			kind: "run",
			url: "https://a.test/",
			engine: "playwright",
			browser: "webkit",
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
