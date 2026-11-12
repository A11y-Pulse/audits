import { fakeStashAdaptor } from "@a11y-pulse/integration-harness/fake-stash-adaptor";
import { describe, expect, it } from "vitest";
import { runSuspiciousNameAudit } from "./audit";
import {
	type CollectedElement,
	collectNamedElementsScript,
	type NamedElementCollection,
} from "./browser-scripts";
import { classifyName, type NameToClassify } from "./classify";
import { ROLE_WORDS } from "./role-words";
import { DEFAULT_VOCABULARY, resolveVocabulary, type VocabularyOverride } from "./vocabulary";

function nameOf(name: string, overrides: Partial<NameToClassify> = {}) {
	return { name, source: "aria-label", role: "button", identifiers: [], ...overrides } as const;
}

function classifyWith(
	name: string,
	override: VocabularyOverride,
	overrides: Partial<NameToClassify> = {},
) {
	const vocabulary = resolveVocabulary(override);

	return classifyName(nameOf(name, overrides), vocabulary.roleWords("sv"), vocabulary);
}

describe("resolveVocabulary", () => {
	it("keeps the built-in words when no override is given", () => {
		const vocabulary = resolveVocabulary();

		expect(vocabulary.artefacts.has("undefined")).toBe(true);
		expect(vocabulary.placeholderStems.has("banner")).toBe(true);
		expect(vocabulary.roleWords("sv")).toEqual(ROLE_WORDS.sv);
		expect(DEFAULT_VOCABULARY.artefacts.has("undefined")).toBe(true);
	});

	it("extends the built-in words by default", () => {
		const vocabulary = resolveVocabulary({ artefacts: ["Ogiltig"], placeholderStems: ["bild"] });

		expect(vocabulary.artefacts.has("undefined")).toBe(true);
		expect(vocabulary.artefacts.has("ogiltig")).toBe(true);
		expect(vocabulary.placeholderStems.has("banner")).toBe(true);
		expect(vocabulary.placeholderStems.has("bild")).toBe(true);
	});

	it("replaces the built-in words in replace mode", () => {
		const vocabulary = resolveVocabulary({
			mode: "replace",
			artefacts: ["ogiltig"],
			placeholderStems: ["bild"],
		});

		expect(vocabulary.artefacts.has("undefined")).toBe(false);
		expect(vocabulary.artefacts.has("ogiltig")).toBe(true);
		expect(vocabulary.placeholderStems.has("banner")).toBe(false);
		expect(vocabulary.placeholderStems.has("bild")).toBe(true);
	});

	it("keeps a field's built-in words when that field is not given", () => {
		const vocabulary = resolveVocabulary({ mode: "replace", artefacts: ["ogiltig"] });

		expect(vocabulary.placeholderStems.has("banner")).toBe(true);
	});

	it("merges role words per role when extending", () => {
		const roleWords = resolveVocabulary({ roleWords: { button: ["knapp"] } }).roleWords("en");

		expect(roleWords.button).toEqual(["button", "knapp"]);
		expect(roleWords.link).toEqual(ROLE_WORDS.en!.link);
	});

	it("uses only the given role words when replacing", () => {
		const roleWords = resolveVocabulary({
			mode: "replace",
			roleWords: { button: ["knapp"] },
		}).roleWords("en");

		expect(roleWords).toEqual({ button: ["knapp"] });
	});

	it("treats stem characters as literal text", () => {
		const vocabulary = resolveVocabulary({ mode: "replace", placeholderStems: ["a.b"] });

		expect(vocabulary.placeholderSuffix.test("a.b2")).toBe(true);
		expect(vocabulary.placeholderSuffix.test("axb2")).toBe(false);
	});

	it("matches no placeholder when replacing with no stems", () => {
		const vocabulary = resolveVocabulary({ mode: "replace", placeholderStems: [] });

		expect(vocabulary.placeholderSuffix.test("banner1")).toBe(false);
		expect(vocabulary.placeholderSuffix.test("1")).toBe(false);
	});
});

describe("classifyName with a vocabulary", () => {
	it("flags a custom artefact on a hidden attribute", () => {
		expect(classifyWith("ogiltig", { artefacts: ["ogiltig"] }, { source: "title" })).toEqual({
			signal: "artefact",
			evidence: null,
			verdict: "failed",
		});
	});

	it("flags a custom placeholder stem with a number", () => {
		expect(classifyWith("bild3", { placeholderStems: ["bild"] })).toEqual({
			signal: "placeholder-suffix",
			evidence: null,
			verdict: "review",
		});
	});

	it("does not flag a built-in placeholder once replaced", () => {
		expect(classifyWith("banner1", { mode: "replace", placeholderStems: ["bild"] })).toBeNull();
	});

	it("reports a custom role word at the end of a name", () => {
		expect(
			classifyWith("Stäng knapp", { roleWords: { button: ["knapp"] } }, { source: "aria-label" }),
		).toEqual({ signal: "role-word", evidence: "knapp", verdict: "review" });
	});
});

describe("runSuspiciousNameAudit with a vocabulary", () => {
	function element(name: string, extra: Partial<CollectedElement> = {}): CollectedElement {
		return {
			name,
			truncated: false,
			source: "aria-label",
			role: "button",
			lang: "sv",
			identifiers: [],
			iconOnly: false,
			linkContext: false,
			html: `<button aria-label="${name}">`,
			...extra,
		};
	}

	function fakePage(elements: CollectedElement[]) {
		const collection: NamedElementCollection = { elements, total: elements.length };

		return fakeStashAdaptor(collectNamedElementsScript, collection, "element");
	}

	it("applies the vocabulary option to every element", async () => {
		const page = fakePage([element("bild2"), element("Lägg i varukorgen")]);

		const result = await runSuspiciousNameAudit(page.adaptor, {
			vocabulary: { placeholderStems: ["bild"] },
		});

		expect(result.needsReview).toMatchObject([{ name: "bild2", signal: "placeholder-suffix" }]);
		expect(result.passed).toMatchObject([{ name: "Lägg i varukorgen" }]);
	});
});
