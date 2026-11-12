/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they must
 * not reference any symbols outside their own scope. The text measurement itself is not here: it is
 * the text spacing audit's, imported from `@a11y-pulse/text-spacing-audit/measure`.
 */

import type { ViewportMeta } from "./result";

export type LayoutFingerprint = {
	innerWidth: number;
	scrollWidth: number;
	scrollHeight: number;
	clientWidth: number;
	bodyScrollHeight: number;
	childCount: number;
};

/** A cheap summary of the page's layout, for telling when it has stopped changing. */
export function readLayoutFingerprintScript(): LayoutFingerprint {
	const root = document.documentElement;
	const body = document.body;

	return {
		innerWidth: window.innerWidth,
		scrollWidth: root.scrollWidth,
		scrollHeight: root.scrollHeight,
		clientWidth: root.clientWidth,
		bodyScrollHeight: body ? body.scrollHeight : 0,
		childCount: body ? body.childElementCount : 0,
	};
}

/**
 * Read the page's viewport meta tag and work out whether it stops the user zooming to 200%. The
 * last tag wins, as it does in browsers. Serialized; self-contained.
 */
export function readViewportMetaScript(): ViewportMeta | null {
	const tags = Array.from(document.querySelectorAll('meta[name="viewport" i]'));
	const tag = tags[tags.length - 1];

	if (!tag) {
		return null;
	}

	const content = tag.getAttribute("content") ?? "";
	const values = new Map<string, string>();

	for (const part of content.split(/[,;]/)) {
		const [key, ...rest] = part.split("=");
		const name = (key ?? "").trim().toLowerCase();

		if (name !== "") {
			values.set(name, rest.join("=").trim().toLowerCase());
		}
	}

	const scalable = values.get("user-scalable");
	let userScalable = true;

	if (scalable !== undefined) {
		const numeric = Number.parseFloat(scalable);

		// Browsers read a number between -1 and 1 as "no".
		userScalable = !(
			scalable === "no" ||
			scalable === "fixed" ||
			(Number.isFinite(numeric) && Math.abs(numeric) < 1)
		);
	}

	const maximum = values.get("maximum-scale");
	let maximumScale: number | null = null;

	if (maximum !== undefined) {
		const numeric = maximum === "yes" ? 1 : Number.parseFloat(maximum);

		maximumScale = Number.isFinite(numeric) ? numeric : null;
	}

	return {
		content,
		html: (tag.cloneNode(false) as Element).outerHTML,
		userScalable,
		maximumScale,
		blocksZoom: !userScalable || (maximumScale !== null && maximumScale < 2),
	};
}
