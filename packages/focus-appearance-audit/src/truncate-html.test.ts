import { describe, expect, it } from "vitest";
import { truncateHtml } from "./truncate-html";

describe("truncateHtml", () => {
	it("returns an empty string for empty input", () => {
		expect(truncateHtml("")).toBe("");
	});

	it("leaves a short opening tag untouched", () => {
		const html = '<button type="button" aria-label="News">';
		expect(truncateHtml(html)).toBe(html);
	});

	it("keeps only the opening tag, dropping children and the closing tag", () => {
		expect(truncateHtml("<button>Click me</button>")).toBe("<button>");
	});

	it("truncates a long attribute value but keeps every attribute", () => {
		const html =
			'<button aria-label="News navigation" class="z-10 flex relative items-center justify-center rounded-full" href="/news">';

		const result = truncateHtml(html, { maxAttributeValueLength: 20 });

		expect(result).toBe(
			'<button aria-label="News navigation" class="z-10 flex relative i..." href="/news">',
		);
	});

	it("preserves single-quoted attribute values", () => {
		const html = `<a class='one two three four five six seven eight nine ten'>`;
		const result = truncateHtml(html, { maxAttributeValueLength: 10 });
		expect(result).toBe(`<a class='one two th...'>`);
	});

	it("truncates multiple long attributes independently", () => {
		const html =
			'<div data-a="aaaaaaaaaaaa" data-b="bbbbbbbbbbbb" data-c="short">';
		const result = truncateHtml(html, { maxAttributeValueLength: 5 });
		expect(result).toBe(
			'<div data-a="aaaaa..." data-b="bbbbb..." data-c="short">',
		);
	});

	it("applies an overall length cap as a final guard", () => {
		const html = `<div ${Array.from({ length: 40 }, (_, i) => `data-x${i}="v"`).join(" ")}>`;
		const result = truncateHtml(html, { maxLength: 30 });
		expect(result.length).toBe(33); // 30 chars + "..."
		expect(result.endsWith("...")).toBe(true);
	});

	it("handles a string with no closing bracket", () => {
		expect(
			truncateHtml('<button class="abcdefghij"', {
				maxAttributeValueLength: 5,
			}),
		).toBe('<button class="abcde..."');
	});
});
