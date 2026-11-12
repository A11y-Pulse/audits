const DEFAULT_MAX_ATTRIBUTE_VALUE_LENGTH = 50;
const DEFAULT_MAX_LENGTH = 300;
const ELLIPSIS = "...";
const REDACTED = "[redacted]";

// Input types whose `value` is a label or a fixed choice the page author wrote, rather than text
// that may have been filled in for the person using the page.
const INPUT_TYPES_WITH_AUTHORED_VALUE = new Set([
	"button",
	"checkbox",
	"color",
	"image",
	"radio",
	"range",
	"reset",
	"submit",
]);

export type TruncateHtmlOptions = {
	maxAttributeValueLength?: number;
	maxLength?: number;
};

/**
 * Where the opening tag ends: the first `>` that is not inside a quoted attribute value. Serialised
 * HTML leaves `>` unescaped in attribute values, so the first one in the string is not always it.
 */
function openingTagEnd(html: string): number {
	let quote: string | null = null;
	let lastSignificant = "";

	for (let i = 0; i < html.length; i++) {
		const char = html[i]!;

		if (quote !== null) {
			if (char === quote) {
				quote = null;
			}
		} else if ((char === '"' || char === "'") && lastSignificant === "=") {
			quote = char;
		} else if (char === ">") {
			return i;
		}

		if (!/\s/.test(char)) {
			lastSignificant = char;
		}
	}

	return -1;
}

/**
 * The value of the opening tag's own `name` attribute, or null without one. The tag is walked one
 * attribute at a time, so text inside another attribute's value is never mistaken for an attribute.
 */
function attributeValue(openingTag: string, name: string): string | null {
	const afterTagName = openingTag.replace(/^<\s*[^\s/>]+/, "");
	const attribute = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

	for (const match of afterTagName.matchAll(attribute)) {
		// As in HTML, the first attribute of a name is the one that counts.
		if (match[1]!.toLowerCase() === name) {
			return match[2] ?? match[3] ?? match[4] ?? "";
		}
	}

	return null;
}

/**
 * The first `length` characters of `text`, shortened further where the cut would otherwise split a
 * surrogate pair or a character reference such as `&amp;`.
 */
function sliceWhole(text: string, length: number): string {
	if (text.length <= length) {
		return text;
	}

	let end = Math.max(length, 0);
	const before = text.charCodeAt(end - 1);

	if (before >= 0xd800 && before <= 0xdbff) {
		end--;
	}

	const ampersand = text.lastIndexOf("&", end - 1);

	if (ampersand !== -1 && !text.slice(ampersand, end).includes(";")) {
		const reference = /^&#?[a-z0-9]{1,31};/i.exec(text.slice(ampersand, ampersand + 34));

		if (reference && ampersand + reference[0].length > end) {
			end = ampersand;
		}
	}

	return text.slice(0, end);
}

/**
 * Given an element's outerHTML, produce a truncated version suitable for display in results. For
 * memory efficiency, pass a shallow outerHTML i.e. `Node.cloneNode(false).outerHTML`.
 *
 * Only the opening tag is kept. Long attribute values are shortened, `data:` URIs are cut back to
 * their media type, and the `value` of a text-entry `<input>` is redacted, since it can hold
 * whatever the page was pre-filled with for the person using it.
 */
export function truncateHtml(html: string, options: TruncateHtmlOptions = {}): string {
	if (!html) {
		return "";
	}

	const maxAttributeValueLength =
		options.maxAttributeValueLength ?? DEFAULT_MAX_ATTRIBUTE_VALUE_LENGTH;
	const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;

	// Keep only the opening tag
	const closingBracket = openingTagEnd(html);
	const openingTag = closingBracket === -1 ? html : html.slice(0, closingBracket + 1);

	const tagName = /^<\s*([^\s/>]+)/.exec(openingTag)?.[1]?.toLowerCase();
	const inputType = (attributeValue(openingTag, "type") ?? "").trim().toLowerCase() || "text";
	const redactValue = tagName === "input" && !INPUT_TYPES_WITH_AUTHORED_VALUE.has(inputType);

	// Shorten long quoted attribute values, preserving the quote style.
	const trimmed = openingTag.replace(
		/([^\s"'<>/=]+)(\s*=\s*)(["'])([\s\S]*?)\3/g,
		(match, name: string, equals: string, quote: string, value: string) => {
			if (redactValue && name.toLowerCase() === "value" && value !== "") {
				return `${name}${equals}${quote}${REDACTED}${quote}`;
			}

			if (value.length <= maxAttributeValueLength) {
				return match;
			}

			const dataUri = /^\s*data:[^,]{0,64},/i.exec(value);
			const kept = dataUri ? dataUri[0] : sliceWhole(value, maxAttributeValueLength);

			return `${name}${equals}${quote}${kept}${ELLIPSIS}${quote}`;
		},
	);

	if (trimmed.length > maxLength) {
		return `${sliceWhole(trimmed, maxLength)}${ELLIPSIS}`;
	}

	return trimmed;
}
