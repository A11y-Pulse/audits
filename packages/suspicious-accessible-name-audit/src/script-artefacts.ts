/**
 * What a script or template leaves behind where a text alternative or name should be.
 *
 * This file is kept byte-for-byte identical in `filename-alt-text-audit` and
 * `suspicious-accessible-name-audit`, so that the two audits agree without depending on each other.
 * A test in each package compares the two copies.
 */

/**
 * Values a script writes when it has nothing to write, exactly as it writes them. Compared with
 * case intact: "Nan" and "Null" are also a name and a word.
 */
export const SCRIPT_VALUES: readonly string[] = ["undefined", "null", "NaN"];

/** Lower case, as it appears in folded text. */
export const OBJECT_STRING = "[object object]";

// Delimiters nobody types into a name by accident. A token's inside stops at the next opening or
// closing delimiter of its own kind, which is what keeps matching linear in the length of the
// text: no two attempts read the same characters. The negated classes also match line breaks.
const TEMPLATE_TOKEN = [
	String.raw`\{\{(?:[^{}]|\{(?!\{)|\}(?!\}))*\}\}`,
	String.raw`\{%(?:[^{%]|\{(?!%)|%(?!\}))*%\}`,
	String.raw`\$\{(?:[^$}]|\$(?!\{))*\}`,
	"<%(?:[^<%]|<(?!%)|%(?!>))*%>",
	String.raw`#\{(?:[^#}]|#(?!\{))*\}`,
	String.raw`\[\[(?:[^[\]]|\[(?!\[)|\](?!\]))*\]\]`,
].join("|");

// Also how documentation writes `__init__` and "%s".
const WEAK_TOKEN = String.raw`__\w+__|%[sd]\b`;

/** Text that is nothing but template tokens such as `{{title}}` or `{{ first }} {{ last }}`. */
export const WHOLE_TEMPLATE_TOKEN: RegExp = new RegExp(`^(?:(?:${TEMPLATE_TOKEN})\\s*)+$`);

/** Text that is nothing but a weaker token: `__TITLE__`, `%s` or `%d`. */
export const WHOLE_WEAK_TOKEN: RegExp = new RegExp(`^(?:${WEAK_TOKEN})$`);

/** A token of either kind anywhere in the text. */
export const ANY_TOKEN: RegExp = new RegExp(`${TEMPLATE_TOKEN}|${WEAK_TOKEN}`);
