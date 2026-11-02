import type { Identifier, NameSource } from "./browser-scripts";
import { wordsForRole } from "./role-words";
import { DEFAULT_VOCABULARY, fold, type RoleWords, type Vocabulary } from "./vocabulary";

/**
 * - `artefact`: the name is a leftover script value, an unrendered template token or a stock
 *   placeholder such as "undefined", "{{title}}" or "lorem ipsum".
 * - `attribute-match`: the name is a code-shaped value of the element's own `id`, `class`, `name`
 *   or `data-*` attributes.
 * - `identifier-pattern`: the name is shaped like a code identifier: kebab-case with three or more
 *   words, snake_case, or camelCase with three or more words.
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
	/** The matched attribute for `attribute-match`, the matched word for `role-word`. */
	evidence: string | null;
};

export type NameToClassify = {
	name: string;
	source: NameSource;
	role: string;
	identifiers: readonly Identifier[];
};

// Names typed into an attribute that sighted users never see. Visible text that reads
// "undefined" or "Report a broken link" is a content problem, not a naming one.
const HIDDEN_ATTRIBUTE_SOURCES: ReadonlySet<NameSource> = new Set([
	"aria-label",
	"title",
	"placeholder",
]);

const LOREM_IPSUM = /^lorem ipsum\b/;

const TEMPLATE_TOKEN =
	/\{\{.*?\}\}|\{%.*?%\}|\$\{.*?\}|<%.*?%>|#\{.*?\}|\[\[.*?\]\]|__\w+__|%[sd]\b/;

// Thresholds keep two-part words ("e-mail", "check-in") and one-hump brands ("iPhone",
// "PlayStation", "macOS") out.
const IDENTIFIER_PATTERNS: readonly RegExp[] = [
	/^[a-z]+(?:-[a-z]+){2,}(?:-?\d+)?$/,
	/^[a-z]+(?:_[a-z]+)+(?:_?\d+)?$/i,
	/^[a-z]+(?:[A-Z][a-z]+){2,}\d*$/,
	/^[A-Z][a-z]+(?:[A-Z][a-z]+){2,}\d*$/,
];

// "Search" on `id="search"` is a fine name. Only a value with code punctuation, a digit or an
// internal capital, or a placeholder stem, is provably an identifier.
const CODE_SHAPED = /[-_\d]|\p{Ll}\p{Lu}/u;

// A link named "Help button" is announced as "Help button, link".
const MISLEADING_ROLES: Readonly<Record<string, string>> = { link: "button" };

const TERMINAL_PUNCTUATION = /[.!?:;,…]+$/u;

function isArtefact(name: string, vocabulary: Vocabulary): boolean {
	const folded = fold(name);

	return vocabulary.artefacts.has(folded) || LOREM_IPSUM.test(folded) || TEMPLATE_TOKEN.test(name);
}

function matchingIdentifier(
	name: string,
	identifiers: readonly Identifier[],
	vocabulary: Vocabulary,
): Identifier | null {
	const folded = fold(name);

	return (
		identifiers.find(
			({ value }) =>
				fold(value) === folded &&
				(CODE_SHAPED.test(value) || vocabulary.placeholderStems.has(fold(value))),
		) ?? null
	);
}

function roleWordIn(name: string, role: string, roleWords: RoleWords): string | null {
	const text = fold(name).replace(TERMINAL_PUNCTUATION, "");
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
	const { name, source, role, identifiers } = element;
	const fromHiddenAttribute = HIDDEN_ATTRIBUTE_SOURCES.has(source);

	if (fromHiddenAttribute && isArtefact(name, vocabulary)) {
		return { signal: "artefact", evidence: null };
	}

	const identifier =
		source === "content" ? null : matchingIdentifier(name, identifiers, vocabulary);

	if (identifier) {
		return { signal: "attribute-match", evidence: identifier.attribute };
	}

	if (IDENTIFIER_PATTERNS.some((pattern) => pattern.test(name))) {
		return { signal: "identifier-pattern", evidence: null };
	}

	if (vocabulary.placeholderSuffix.test(name)) {
		return { signal: "placeholder-suffix", evidence: null };
	}

	const roleWord = fromHiddenAttribute ? roleWordIn(name, role, roleWords) : null;

	return roleWord ? { signal: "role-word", evidence: roleWord } : null;
}
