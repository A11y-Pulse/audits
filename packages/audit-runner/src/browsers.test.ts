import { describe, expect, it } from "vitest";
import { responseProblem } from "./browsers";

const URL = "https://shop.test/orders";

describe("responseProblem", () => {
	it("accepts a successful HTML or XHTML response, whatever its charset", () => {
		expect(responseProblem(URL, { status: 200, contentType: "text/html" })).toBeUndefined();
		expect(
			responseProblem(URL, { status: 200, contentType: "Text/HTML; charset=utf-8" }),
		).toBeUndefined();
		expect(
			responseProblem(URL, { status: 203, contentType: "application/xhtml+xml" }),
		).toBeUndefined();
	});

	it("accepts a response with no content type, which the browser sniffs", () => {
		expect(responseProblem(URL, { status: 200, contentType: undefined })).toBeUndefined();
	});

	it("names the status of a client or server error, even one served as HTML", () => {
		expect(responseProblem(URL, { status: 404, contentType: "text/html" })).toBe(
			"https://shop.test/orders responded with HTTP 404",
		);
		expect(responseProblem(URL, { status: 503, contentType: undefined })).toBe(
			"https://shop.test/orders responded with HTTP 503",
		);
	});

	it("names the content type of a response the browser would show in its own viewer", () => {
		expect(responseProblem(URL, { status: 200, contentType: "application/json" })).toBe(
			"https://shop.test/orders is application/json, not an HTML page",
		);
		expect(responseProblem(URL, { status: 200, contentType: "text/plain; charset=utf-8" })).toBe(
			"https://shop.test/orders is text/plain, not an HTML page",
		);
	});
});
