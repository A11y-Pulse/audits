import { roleWordsFor } from "./role-words";

export const DEFAULT_ARTEFACTS: readonly string[] = [
	"undefined",
	"null",
	"nan",
	"[object object]",
	"todo",
	"tbd",
	"fixme",
	"xxx",
	"placeholder",
	"untitled",
	"button",
	"btn",
	"link",
	"img",
	"cta",
	"widget",
	"component",
	"iframe",
];

/**
 * Whole names that are a leftover as often as not, but are also ordinary words: a quiz answer
 * labelled "True", or "Test", "Label", "Module" and "Banner" on a German, Swedish or French page.
 * They go to review rather than failing.
 */
export const DEFAULT_REVIEW_WORDS: readonly string[] = [
	"true",
	"false",
	"test",
	"label",
	"banner",
	"element",
	"module",
];

export const PLACEHOLDER_STEMS: readonly string[] = [
	"banner",
	"image",
	"img",
	"icon",
	"button",
	"btn",
	"link",
	"item",
	"element",
	"section",
	"block",
	"slide",
	"card",
	"tile",
	"promo",
	"teaser",
	"cta",
	"box",
	"col",
	"column",
	"widget",
	"component",
	"module",
	"test",
	"placeholder",
	"untitled",
	"default",
	"new",
	"label",
	"text",
	"title",
	"name",
	"iframe",
	"frame",
	"embed",
	"video",
	"player",
];

export type RoleWords = Readonly<Record<string, readonly string[]>>;

/**
 * Words for a page in another language, or extra words for the built-in English lists. `mode`
 * applies to every field: `extend` (the default) adds to the built-in words, `replace` uses only
 * the given ones. A field left out keeps the built-in words.
 */
export type VocabularyOverride = {
	mode?: "extend" | "replace";
	/** Whole names that are artefacts, such as "ungültig". */
	artefacts?: readonly string[];
	/** Whole names that may be a leftover but are also ordinary words, such as "test". */
	reviewWords?: readonly string[];
	/** Placeholder stems, matched with a number after them, such as "bild" in "bild1". */
	placeholderStems?: readonly string[];
	/** Role words by computed role, such as `{ button: ["knapp"] }`. Applied to every page language. */
	roleWords?: Readonly<Record<string, readonly string[]>>;
};

export type Vocabulary = {
	artefacts: ReadonlySet<string>;
	reviewWords: ReadonlySet<string>;
	placeholderStems: ReadonlySet<string>;
	placeholderSuffix: RegExp;
	roleWords: (lang: string | null) => RoleWords;
};

// A pattern that matches nothing, for an empty stem list.
const NO_MATCH = /(?!)/;

export function fold(value: string): string {
	return value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickWords(
	defaults: readonly string[],
	given: readonly string[] | undefined,
	replace: boolean,
): string[] {
	if (given === undefined) {
		return [...defaults];
	}

	return replace ? [...given] : [...defaults, ...given];
}

function resolveRoleWords(
	base: RoleWords,
	given: Readonly<Record<string, readonly string[]>> | undefined,
	replace: boolean,
): RoleWords {
	if (given === undefined) {
		return base;
	}

	const folded = Object.fromEntries(
		Object.entries(given).map(([role, words]) => [role, words.map(fold)]),
	);

	if (replace) {
		return folded;
	}

	const merged: Record<string, readonly string[]> = { ...base };

	for (const [role, words] of Object.entries(folded)) {
		merged[role] = [...(merged[role] ?? []), ...words];
	}

	return merged;
}

/**
 * The vocabulary the classifier checks names against: the built-in English words with `override`
 * applied.
 */
export function resolveVocabulary(override: VocabularyOverride = {}): Vocabulary {
	const replace = override.mode === "replace";
	const artefacts = pickWords(DEFAULT_ARTEFACTS, override.artefacts, replace).map(fold);
	const reviewWords = pickWords(DEFAULT_REVIEW_WORDS, override.reviewWords, replace).map(fold);
	const stems = pickWords(PLACEHOLDER_STEMS, override.placeholderStems, replace).map(fold);

	return {
		artefacts: new Set(artefacts),
		// A word given as an artefact is not also a review word.
		reviewWords: new Set(reviewWords.filter((word) => !artefacts.includes(word))),
		placeholderStems: new Set(stems),
		placeholderSuffix:
			stems.length === 0
				? NO_MATCH
				: new RegExp(`^(?:${stems.map(escapeRegExp).join("|")})[\\s_-]?\\d{1,3}$`, "i"),
		roleWords: (lang) => resolveRoleWords(roleWordsFor(lang), override.roleWords, replace),
	};
}

export const DEFAULT_VOCABULARY: Vocabulary = resolveVocabulary();
