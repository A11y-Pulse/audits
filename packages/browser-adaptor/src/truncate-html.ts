const DEFAULT_MAX_ATTRIBUTE_VALUE_LENGTH = 50;
const DEFAULT_MAX_LENGTH = 300;
const ELLIPSIS = "...";

export type TruncateHtmlOptions = {
	maxAttributeValueLength?: number;
	maxLength?: number;
};

/**
 * Given an element's outerHTML, produce a truncated version suitable for display in results. For
 * memory efficiency, pass a shallow outerHTML i.e. `Node.cloneNode(false).outerHTML`.
 */
export function truncateHtml(
	html: string,
	options: TruncateHtmlOptions = {},
): string {
	if (!html) {
		return "";
	}

	const maxAttributeValueLength =
		options.maxAttributeValueLength ?? DEFAULT_MAX_ATTRIBUTE_VALUE_LENGTH;
	const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;

	// Keep only the opening tag
	const closingBracket = html.indexOf(">");
	const openingTag =
		closingBracket === -1 ? html : html.slice(0, closingBracket + 1);

	// Shorten long quoted attribute values, preserving the quote style.
	const trimmed = openingTag.replace(
		/=(["'])([\s\S]*?)\1/g,
		(match, quote: string, value: string) => {
			if (value.length <= maxAttributeValueLength) {
				return match;
			}

			return `=${quote}${value.slice(0, maxAttributeValueLength)}${ELLIPSIS}${quote}`;
		},
	);

	if (trimmed.length > maxLength) {
		return `${trimmed.slice(0, maxLength)}${ELLIPSIS}`;
	}

	return trimmed;
}
