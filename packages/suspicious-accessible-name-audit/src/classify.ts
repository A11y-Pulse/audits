import type { Identifier, NameSource } from "./browser-scripts";
import { wordsForRole } from "./role-words";
import {
	ANY_TOKEN,
	OBJECT_STRING,
	SCRIPT_VALUES,
	WHOLE_TEMPLATE_TOKEN,
	WHOLE_WEAK_TOKEN,
} from "./script-artefacts";
import { DEFAULT_VOCABULARY, fold, type RoleWords, type Vocabulary } from "./vocabulary";

/**
 * - `artefact`: the name is a leftover script value, an unrendered template token or a stock
 *   placeholder such as "undefined", "{{title}}" or "lorem ipsum".
 * - `attribute-match`: the name is a code-shaped value of the element's own `id`, `class`, `name`
 *   or test-id attribute (`data-testid`, `data-cy` and the like).
 * - `identifier-pattern`: the name is shaped like a code identifier: kebab-case with three or more
 *   words, snake_case, camelCase with three or more words, or a translation key such as
 *   "nav.homeTitle" or "common:buttons.submit".
 * - `placeholder-suffix`: the name is a placeholder stem and a number, such as "banner1".
 * - `role-word`: the name ends with the word for the element's role, which screen readers announce
 *   already, or a link's name ends with the word for a button.
 */
export type NameSignal =
	| "artefact"
	| "attribute-match"
	| "identifier-pattern"
	| "placeholder-suffix"
	| "role-word";

export type NameMatch = {
	signal: NameSignal;
	/**
	 * The matched attribute for `attribute-match`, the matched word for `role-word`, the matched
	 * token for an `artefact` that is a template token, and null otherwise.
	 */
	evidence: string | null;
	/**
	 * `failed` when the name is provably not a name, `review` when a person has to decide. Only
	 * `artefact` and `attribute-match` can fail.
	 */
	verdict: "failed" | "review";
};

export type NameToClassify = {
	name: string;
	source: NameSource;
	role: string;
	identifiers: readonly Identifier[];
	/** The host a link points at, when the element is one. */
	hrefHost?: string | null;
};

// Names typed into an attribute that sighted users never see. Visible text that reads
// "undefined" or "Report a broken link" is a content problem, not a naming one.
const HIDDEN_ATTRIBUTE_SOURCES: ReadonlySet<NameSource> = new Set([
	"aria-label",
	"title",
	"placeholder",
]);

const LOREM_IPSUM = /^lorem ipsum\b/;

const SCRIPT_VALUE_WORDS: ReadonlySet<string> = new Set(
	SCRIPT_VALUES.map((value) => value.toLowerCase()),
);

// Thresholds keep two-part words ("e-mail", "check-in") and one-hump brands ("iPhone",
// "PlayStation", "macOS") out.
const IDENTIFIER_PATTERNS: readonly RegExp[] = [
	/^[a-z]+(?:-[a-z]+){2,}(?:-?\d+)?$/,
	/^[a-z]+(?:_[a-z]+)+(?:_?\d+)?$/i,
	/^[a-z]+(?:[A-Z][a-z]+){2,}\d*$/,
	/^[A-Z][a-z]+(?:[A-Z][a-z]+){2,}\d*$/,
];

// A missing translation renders its key: "nav.homeTitle", "common:buttons.submit".
const TRANSLATION_KEY = /^[a-z][a-zA-Z\d_-]*(?:[.:][a-z][a-zA-Z\d_-]*)+$/;

// Lower-case words joined by dots are also a host ("servicos.gov.br"), a package
// ("java.util.concurrent") and a function ("os.path.join"). What those do not have is a namespace
// before a colon, or a part written in camelCase or snake_case.
const KEY_PUNCTUATION = /:|[a-z\d]_[a-z\d]|[a-z][A-Z]/;

// A host ends in a short top-level domain, and a file in a short extension.
const HOST_OR_FILE = /^www\.|\.(?:[a-z]{2,3}|info|html|json)$/;

// "Search" on `id="search"` is a fine name. Only a value with code punctuation, a digit or an
// internal capital is provably an identifier.
const CODE_SHAPED = /[-_\d]|\p{Ll}\p{Lu}/u;

// A visible label generated from the same data as the id ("2023", "iPhone") is still a label, so
// only a separator is taken as a sign of code there.
const SEPARATED = /[\p{L}\d][-_][\p{L}\d]/u;

// A `data-*` attribute usually holds content ("data-brand"); these hold a test hook's identifier.
const TEST_ID_ATTRIBUTE = /^data-(?:test|test-?id|testing|cy|qa|qa-?id|automation-?id|e2e|hook)$/;

// A link named "Help button" is announced as "Help button, link".
const MISLEADING_ROLES: Readonly<Record<string, string>> = { link: "button" };

const TERMINAL_PUNCTUATION = /[.!?:;,…]+$/u;

type Finding = Pick<NameMatch, "evidence" | "verdict">;

function artefactIn(name: string, hidden: boolean, vocabulary: Vocabulary): Finding | null {
	const folded = fold(name);

	if (folded.includes(OBJECT_STRING)) {
		// Visible text around it may be an article about the bug.
		return {
			evidence: "[object Object]",
			verdict: hidden || folded === OBJECT_STRING ? "failed" : "review",
		};
	}

	const trimmed = name.trim();

	// A script value only counts in the spelling a script writes: "Nan" is a name and "Null" a word.
	const misspeltScriptValue = SCRIPT_VALUE_WORDS.has(folded) && !SCRIPT_VALUES.includes(trimmed);

	if (
		hidden &&
		!misspeltScriptValue &&
		(vocabulary.artefacts.has(folded) || LOREM_IPSUM.test(folded))
	) {
		return { evidence: null, verdict: "failed" };
	}

	if (WHOLE_TEMPLATE_TOKEN.test(trimmed)) {
		return { evidence: trimmed, verdict: "failed" };
	}

	if (WHOLE_WEAK_TOKEN.test(trimmed)) {
		return { evidence: trimmed, verdict: hidden ? "failed" : "review" };
	}

	const token = ANY_TOKEN.exec(name)?.[0];

	// A token among other words is an unrendered template, or documentation about one.
	if (token) {
		return { evidence: token, verdict: "review" };
	}

	return hidden && vocabulary.reviewWords.has(folded)
		? { evidence: null, verdict: "review" }
		: null;
}

function matchingIdentifier(
	name: string,
	source: NameSource,
	identifiers: readonly Identifier[],
): Finding | null {
	if (source === "content") {
		return null;
	}

	const folded = fold(name);
	const hidden = HIDDEN_ATTRIBUTE_SOURCES.has(source);
	const identifier = identifiers.find(({ attribute, value }) => {
		if (fold(value) !== folded) {
			return false;
		}

		if (attribute.startsWith("data-") && !TEST_ID_ATTRIBUTE.test(attribute)) {
			return false;
		}

		// A field called "name", "title" or "text" is named by that word too: a match on a plain word
		// says nothing, only one on a value that is written as code.
		return (hidden ? CODE_SHAPED : SEPARATED).test(value);
	});

	// A label, a labelling element and a button's value are on screen, where an author would have
	// seen and kept them.
	return identifier
		? { evidence: identifier.attribute, verdict: hidden ? "failed" : "review" }
		: null;
}

function hostOf(value: string): string {
	return fold(value).replace(/^www\./, "");
}

function isTranslationKey(name: string, hrefHost: string | null): boolean {
	if (!TRANSLATION_KEY.test(name) || !KEY_PUNCTUATION.test(name) || HOST_OR_FILE.test(name)) {
		return false;
	}

	// A link named after the site it goes to.
	return hrefHost === null || hostOf(name) !== hostOf(hrefHost);
}

function roleWordIn(name: string, role: string, roleWords: RoleWords): string | null {
	const text = fold(name).replace(TERMINAL_PUNCTUATION, "");

	// "Please select" on a dropdown is an instruction that ends in a verb, not the role.
	if (text.startsWith("please ")) {
		return null;
	}

	const misleading = MISLEADING_ROLES[role];
	const words = [
		...wordsForRole(roleWords, role),
		...(misleading ? wordsForRole(roleWords, misleading) : []),
	];

	return words.find((word) => text === word || text.endsWith(` ${word}`)) ?? null;
}

/**
 * Find what, if anything, makes an element's accessible name code or a placeholder rather than a
 * name. `roleWords` are the role words for the element's language.
 */
export function classifyName(
	element: NameToClassify,
	roleWords: RoleWords,
	vocabulary: Vocabulary = DEFAULT_VOCABULARY,
): NameMatch | null {
	const { name, source, role, identifiers, hrefHost = null } = element;
	const fromHiddenAttribute = HIDDEN_ATTRIBUTE_SOURCES.has(source);

	const artefact = artefactIn(name, fromHiddenAttribute, vocabulary);

	if (artefact?.verdict === "failed") {
		return { signal: "artefact", ...artefact };
	}

	const identifier = matchingIdentifier(name, source, identifiers);

	// A reviewed word that is also written as code in the element's id is a failure.
	if (identifier && (identifier.verdict === "failed" || !artefact)) {
		return { signal: "attribute-match", ...identifier };
	}

	if (artefact) {
		return { signal: "artefact", ...artefact };
	}

	if (
		IDENTIFIER_PATTERNS.some((pattern) => pattern.test(name)) ||
		isTranslationKey(name, hrefHost)
	) {
		return { signal: "identifier-pattern", evidence: null, verdict: "review" };
	}

	if (vocabulary.placeholderSuffix.test(name)) {
		return { signal: "placeholder-suffix", evidence: null, verdict: "review" };
	}

	const roleWord = fromHiddenAttribute ? roleWordIn(name, role, roleWords) : null;

	return roleWord ? { signal: "role-word", evidence: roleWord, verdict: "review" } : null;
}
