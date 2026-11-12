import { describe, expect, it } from "vitest";
import { classifyName } from "./classify";
import { SCRIPT_VALUES } from "./script-artefacts";
import {
	DEFAULT_ARTEFACTS,
	DEFAULT_REVIEW_WORDS,
	resolveVocabulary,
	type VocabularyOverride,
} from "./vocabulary";

function verdictOf(name: string, override: VocabularyOverride = {}) {
	const vocabulary = resolveVocabulary(override);

	return (
		classifyName(
			{ name, source: "aria-label", role: "button", identifiers: [] },
			vocabulary.roleWords("en"),
			vocabulary,
		)?.verdict ?? null
	);
}

describe("review words", () => {
	it("keeps every shared script value among the failing artefacts", () => {
		for (const value of SCRIPT_VALUES) {
			expect(DEFAULT_ARTEFACTS).toContain(value.toLowerCase());
			expect(verdictOf(value)).toBe("failed");
		}
	});

	it("fails a script value only in the spelling a script writes", () => {
		expect(verdictOf("Nan")).toBeNull();
		expect(verdictOf("Null")).toBeNull();
		// Unless the page's own vocabulary has no such exception to make.
		expect(verdictOf("Nil", { artefacts: ["nil"] })).toBe("failed");
	});

	it("never lists a word as both failing and reviewed", () => {
		expect(DEFAULT_REVIEW_WORDS.filter((word) => DEFAULT_ARTEFACTS.includes(word))).toEqual([]);
	});

	it("reviews a custom word", () => {
		expect(verdictOf("Beispiel")).toBeNull();
		expect(verdictOf("Beispiel", { reviewWords: ["beispiel"] })).toBe("review");
	});

	it("fails a built-in review word that is also given as an artefact", () => {
		expect(verdictOf("Test")).toBe("review");
		expect(verdictOf("Test", { artefacts: ["test"] })).toBe("failed");
	});

	it("drops the built-in review words when they are replaced", () => {
		expect(verdictOf("Test", { mode: "replace", reviewWords: [] })).toBeNull();
		expect(verdictOf("undefined", { mode: "replace", reviewWords: [] })).toBe("failed");
	});
});
