/**
 * Return the candidate URLs in a `srcset` attribute value, without their width or density
 * descriptors.
 */
export function parseSrcset(srcset: string): string[] {
	const urls: string[] = [];
	let position = 0;

	// Follows the HTML srcset parsing algorithm closely enough to keep commas inside URLs (common in
	// image CDN transforms) and inside descriptor parentheses.
	while (position < srcset.length) {
		while (position < srcset.length && /[\s,]/.test(srcset[position]!)) {
			position++;
		}

		const start = position;

		while (position < srcset.length && !/\s/.test(srcset[position]!)) {
			position++;
		}

		let url = srcset.slice(start, position);

		if (url.endsWith(",")) {
			url = url.replace(/,+$/, "");
		} else {
			let inParens = false;

			while (position < srcset.length) {
				const char = srcset[position]!;

				if (char === "(") {
					inParens = true;
				} else if (char === ")") {
					inParens = false;
				} else if (char === "," && !inParens) {
					break;
				}

				position++;
			}
		}

		if (url) {
			urls.push(url);
		}
	}

	return urls;
}

/**
 * Return the decoded last path segment of `url`, resolved against `base`, or null when the URL has
 * no filename to compare against.
 */
export function filenameOf(url: string, base?: string): string | null {
	let parsed: URL;

	try {
		parsed = new URL(url, base);
	} catch {
		return null;
	}

	if (parsed.protocol === "data:" || parsed.protocol === "blob:") {
		return null;
	}

	const segment = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1);

	if (!segment) {
		return null;
	}

	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
