import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	ANY_TOKEN,
	SCRIPT_VALUES,
	WHOLE_TEMPLATE_TOKEN,
	WHOLE_WEAK_TOKEN,
} from "./script-artefacts";

const OTHER_PACKAGE = "filename-alt-text-audit";

describe("script artefacts", () => {
	it(`is the same file as the copy in ${OTHER_PACKAGE}`, () => {
		const own = readFileSync(new URL("./script-artefacts.ts", import.meta.url), "utf8");
		const other = readFileSync(
			new URL(`../../${OTHER_PACKAGE}/src/script-artefacts.ts`, import.meta.url),
			"utf8",
		);

		expect(own).toBe(other);
	});

	it("spells the script values as a script writes them", () => {
		expect(SCRIPT_VALUES).toEqual(["undefined", "null", "NaN"]);
	});

	it("tells a whole token from a token among other words", () => {
		expect(WHOLE_TEMPLATE_TOKEN.test("{{ image.alt }}")).toBe(true);
		expect(WHOLE_TEMPLATE_TOKEN.test("{{ first }} {{ last }}")).toBe(true);
		expect(WHOLE_TEMPLATE_TOKEN.test("Photo of {{ name }}")).toBe(false);
		expect(WHOLE_TEMPLATE_TOKEN.test("{{ first }} and {{ last }}")).toBe(false);
		expect(WHOLE_WEAK_TOKEN.test("__TITLE__")).toBe(true);
		expect(WHOLE_WEAK_TOKEN.test("%s")).toBe(true);
		expect(WHOLE_WEAK_TOKEN.test("50%")).toBe(false);
		expect(ANY_TOKEN.exec("Photo of {{ name }} here")?.[0]).toBe("{{ name }}");
		expect(ANY_TOKEN.test("Save 50% today")).toBe(false);
	});

	it.each([
		"{{ title }}",
		"{% trans 'title' %}",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the unrendered token is the subject.
		"${item.title}",
		"<%= title %>",
		"#{title}",
		"[[title]]",
		"{{ user | json: { indent: 2 } }}",
		"{{\n\timage.alt\n}}",
		"<%=\n  title\n%>",
	])("matches the whole token %j", (token) => {
		expect(WHOLE_TEMPLATE_TOKEN.test(token)).toBe(true);
		expect(ANY_TOKEN.exec(`Photo of ${token} here`)?.[0]).toBe(token);
	});

	it.each(["{{ title", "title }}", "{ title }", "$title", "[title]", "<title>", "50% {off}"])(
		"does not match %j",
		(text) => {
			expect(ANY_TOKEN.test(text)).toBe(false);
			expect(WHOLE_TEMPLATE_TOKEN.test(text)).toBe(false);
		},
	);

	// A pattern that rescans the rest of the text from every unclosed delimiter takes seconds on
	// these (7.5s for the lazy `.*?` form at this size); a linear one takes a few milliseconds.
	it.each<[string, string]>([
		["unclosed openers", "{{".repeat(100_000)],
		["unclosed openers of every kind", "{{ {% ${ <% #{ [[ ".repeat(12_000)],
		["openers with text between", "{{ title ".repeat(25_000)],
		["closed tokens and then a stray word", `${"{{ a }} ".repeat(25_000)}!`],
		["double underscores", "__a ".repeat(50_000)],
	])("stays linear on 200,000 characters of %s", (_, hostile) => {
		const started = performance.now();

		ANY_TOKEN.test(hostile);
		WHOLE_TEMPLATE_TOKEN.test(hostile);
		WHOLE_WEAK_TOKEN.test(hostile);

		expect(performance.now() - started).toBeLessThan(1000);
	});
});
