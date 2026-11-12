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
		const html = '<div data-a="aaaaaaaaaaaa" data-b="bbbbbbbbbbbb" data-c="short">';
		const result = truncateHtml(html, { maxAttributeValueLength: 5 });
		expect(result).toBe('<div data-a="aaaaa..." data-b="bbbbb..." data-c="short">');
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

describe("truncateHtml on markup that is awkward to cut", () => {
	it("keeps the whole opening tag when an attribute value contains a >", () => {
		const html = '<a href="/x" title="Next > Step" class="btn primary">Next</a>';

		expect(truncateHtml(html)).toBe('<a href="/x" title="Next > Step" class="btn primary">');
	});

	it("keeps the whole opening tag when a single-quoted value contains a > and a double quote", () => {
		const html = `<div data-tpl='<b class="x">hi</b>' id="card"><p>body</p></div>`;

		expect(truncateHtml(html)).toBe(`<div data-tpl='<b class="x">hi</b>' id="card">`);
	});

	it("does not take an apostrophe in an unquoted value for the start of a quoted one", () => {
		expect(truncateHtml("<p title=it's>one > two</p>")).toBe("<p title=it's>");
	});

	it("drops a character reference whole rather than cutting through it", () => {
		const html = '<a title="Terms &amp; conditions">';

		// A cut at 9 characters would land inside "&amp;".
		expect(truncateHtml(html, { maxAttributeValueLength: 9 })).toBe('<a title="Terms ...">');
		expect(truncateHtml(html, { maxAttributeValueLength: 11 })).toBe('<a title="Terms &amp;...">');
	});

	it("leaves a bare ampersand that is not a character reference alone", () => {
		expect(truncateHtml('<a title="Fish & chips for all">', { maxAttributeValueLength: 8 })).toBe(
			'<a title="Fish & c...">',
		);
	});

	it("does not split a surrogate pair", () => {
		const html = '<span title="ab😀cd">';

		// The emoji is two UTF-16 code units; a cut at 3 would keep only the first.
		expect(truncateHtml(html, { maxAttributeValueLength: 3 })).toBe('<span title="ab...">');
		expect(truncateHtml(html, { maxAttributeValueLength: 4 })).toBe('<span title="ab😀...">');
	});

	it("does not split a surrogate pair or a character reference at the overall cap", () => {
		expect(truncateHtml('<i title="😀">', { maxLength: 11 })).toBe('<i title="...');
		expect(truncateHtml('<i title="&quot;">', { maxLength: 13 })).toBe('<i title="...');
	});

	it("cuts a data: URI back to its media type", () => {
		const html = `<img alt="Logo" src="data:image/png;base64,${"iVBORw0KGgo".repeat(40)}">`;

		expect(truncateHtml(html)).toBe('<img alt="Logo" src="data:image/png;base64,...">');
	});

	it("redacts the value of a text-entry input", () => {
		expect(truncateHtml('<input type="email" name="email" value="jane.doe@example.com">')).toBe(
			'<input type="email" name="email" value="[redacted]">',
		);
		expect(truncateHtml('<input name="q" value="my search">')).toBe(
			'<input name="q" value="[redacted]">',
		);
		expect(truncateHtml('<input type="hidden" name="csrf" value="9f8a7b6c">')).toBe(
			'<input type="hidden" name="csrf" value="[redacted]">',
		);
	});

	it("goes by the input's own type attribute, not by text in another attribute", () => {
		expect(
			truncateHtml('<input aria-label="Card type = submit" type="password" value="hunter2">'),
		).toBe('<input aria-label="Card type = submit" type="password" value="[redacted]">');
		expect(truncateHtml('<input title="set type=checkbox to toggle" value="jane">')).toBe(
			'<input title="set type=checkbox to toggle" value="[redacted]">',
		);
		expect(truncateHtml("<input data-kind='x type=radio' type=text value=\"jane\">")).toBe(
			"<input data-kind='x type=radio' type=text value=\"[redacted]\">",
		);
		// The first type attribute is the one a browser honours.
		expect(truncateHtml('<input TYPE="Submit" value="Search">')).toBe(
			'<input TYPE="Submit" value="Search">',
		);
	});

	it("keeps a value the page author wrote as a label or a choice", () => {
		for (const html of [
			'<input type="submit" value="Search">',
			'<input type="radio" name="size" value="large">',
			'<input type="checkbox" value="newsletter">',
			'<button value="save">',
			'<option value="nz">',
			'<input type="text" value="">',
		]) {
			expect(truncateHtml(html)).toBe(html);
		}
	});
});
