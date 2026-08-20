/**
 * Build a compact, hopefully-unique selector for any given element on the page. This function is
 * serialized and run in the page context, so it must not reference any symbols outside its own
 * scope.
 *
 * Mirrors axe-core's approach: each level contributes the fewest features that discriminate the
 * element (a unique id, the rarest single class, or an :nth-of-type position), and the walk stops
 * as soon as the joined selector matches exactly one element. Selectors stay short because of
 * that early stop, not because of truncation; the length budget is only a backstop.
 */
export function getSelector(root: Node | null): string {
	const MAX_LENGTH = 128;

	const esc = (value: string): string =>
		typeof CSS !== "undefined" && typeof CSS.escape === "function"
			? CSS.escape(value)
			: value;

	const tagName = (node: Node): string =>
		node.nodeType === 1
			? node.nodeName.toLowerCase()
			: node.nodeName.toUpperCase().replace(/^#/, "");

	// A querySelectorAll-capable root (Document or ShadowRoot) for the element,
	// used to confirm uniqueness and class rarity. Absent on the plain objects
	// used in the serialisation unit tests, where we trust ids and walk to the
	// top instead of stopping early.
	const rootOf = (element: Element): ParentNode | null => {
		const node = (
			element as Element & { getRootNode?: () => Node }
		).getRootNode?.();

		return node && typeof (node as ParentNode).querySelectorAll === "function"
			? (node as ParentNode)
			: null;
	};

	const matchCount = (queryRoot: ParentNode, selector: string): number => {
		try {
			return queryRoot.querySelectorAll(selector).length;
		} catch {
			// A selector that fails to parse can't be relied on.
			return Number.POSITIVE_INFINITY;
		}
	};

	// A candidate feature is only usable if it actually selects this element;
	// an escaping or engine mismatch (e.g. CSS string escapes in an attribute
	// value) could otherwise produce a selector that matches nothing. Or a
	// different element entirely.
	const safeMatches = (element: Element, selector: string): boolean => {
		try {
			return typeof element.matches === "function" && element.matches(selector);
		} catch {
			return false;
		}
	};

	const idIsUnique = (element: Element, id: string): boolean => {
		const queryRoot = rootOf(element);

		return queryRoot === null || matchCount(queryRoot, `#${esc(id)}`) === 1;
	};

	// A discriminating feature for one level of the selector: its CSS text plus
	// a predicate telling whether a sibling would match the same feature (used
	// to decide if an :nth-of-type pin is still needed).
	type Feature = {
		feature: string;
		sharedBy: (sibling: Element) => boolean;
	};

	const classFeature = (cls: string): Feature => ({
		feature: `.${esc(cls)}`,
		sharedBy: (sibling) => Array.from(sibling.classList ?? []).includes(cls),
	});

	// The single feature that narrows the element down the most: the class or
	// href attribute with the fewest matches in the root. Hrefs break ties
	// between structurally-identical content blocks, where classes and
	// :nth-of-type (which only pins position within one parent) cannot. Without
	// a queryable root there is no rarity information, so the first class
	// stands in.
	const rarestFeature = (
		element: Element,
		queryRoot: ParentNode | null,
	): Feature | null => {
		const classes = Array.from(element.classList).slice(0, 8);

		if (!queryRoot) {
			const cls = classes[0];

			return cls === undefined ? null : classFeature(cls);
		}

		let best: Feature | null = null;
		let bestCount = Number.POSITIVE_INFINITY;

		for (const cls of classes) {
			const candidate = classFeature(cls);

			if (!safeMatches(element, candidate.feature)) {
				continue;
			}

			const count = matchCount(queryRoot, candidate.feature);

			if (count < bestCount) {
				best = candidate;
				bestCount = count;
			}

			if (count === 1) {
				return best;
			}
		}

		const href =
			typeof element.getAttribute === "function"
				? element.getAttribute("href")
				: null;

		// Skip hrefs with characters that change meaning inside a CSS string
		// (quotes, backslashes), and query strings, which are too volatile
		// across scans to pin a selector to. Fragments (#main) stay eligible.
		// Skip links make stable discriminators.
		if (href && href.length <= 100 && !/["\\?]/.test(href)) {
			const feature = `[href="${href}"]`;

			if (
				safeMatches(element, feature) &&
				matchCount(queryRoot, feature) < bestCount
			) {
				return {
					feature,
					sharedBy: (sibling) =>
						typeof sibling.getAttribute === "function" &&
						sibling.getAttribute("href") === href,
				};
			}
		}

		return best;
	};

	// The element's 1-based position among same-tag siblings, and whether the
	// chosen feature fails to discriminate it from them (so the segment needs
	// an :nth-of-type pin). Siblings are absent on the serialisation test
	// nodes. There we skip the pin.
	const positionAmongSiblings = (
		element: Element,
		sharedBy: (sibling: Element) => boolean,
	): { nth: number; ambiguous: boolean } => {
		const siblings = (element.parentNode as ParentNode | null)?.children;

		if (!siblings) {
			return { nth: 0, ambiguous: false };
		}

		let nth = 0;
		let count = 0;
		let shared = 0;

		for (const sibling of Array.from(siblings)) {
			if (sibling.nodeName !== element.nodeName) {
				continue;
			}

			count++;

			if (sibling === element) {
				nth = count;
			}

			if (sharedBy(sibling)) {
				shared++;
			}
		}

		return { nth, ambiguous: shared > 1 };
	};

	const segmentFor = (
		element: Element,
		queryRoot: ParentNode | null,
	): { segment: string; anchored: boolean } => {
		// Only treat an id as an absolute anchor when it actually resolves to a
		// single element: pages with duplicate ids would otherwise yield a
		// selector (e.g. "#dup>a") that matches several elements.
		if (element.id && idIsUnique(element, element.id)) {
			return { segment: `#${esc(element.id)}`, anchored: true };
		}

		const feature = rarestFeature(element, queryRoot);
		let segment = tagName(element) + (feature === null ? "" : feature.feature);

		// When same-tag siblings share the chosen feature, pin the position so the
		// segment selects exactly this element rather than all of them.
		const { nth, ambiguous } = positionAmongSiblings(
			element,
			feature === null ? () => true : feature.sharedBy,
		);

		if (ambiguous && nth > 0) {
			segment += `:nth-of-type(${nth})`;
		}

		return { segment, anchored: false };
	};

	// A minimal segment for when a level's full segment would blow the budget
	// (e.g. an enormous class name or a long href): just the tag, pinned by
	// position when same-tag siblings would make the bare tag ambiguous.
	const degradedSegmentFor = (element: Element): string => {
		let segment = tagName(element);

		const { nth, ambiguous } = positionAmongSiblings(element, () => true);

		if (ambiguous && nth > 0) {
			segment += `:nth-of-type(${nth})`;
		}

		return segment;
	};

	const segments: string[] = [];
	let node: Node | null = root;
	const queryRoot =
		root && root.nodeType === 1 ? rootOf(root as Element) : null;

	try {
		// Walk only element nodes. Stopping at the first non-element parent (the
		// document, or a ShadowRoot when the target is inside an open shadow root)
		// keeps the selector within its tree and avoids reading `classList` off a
		// node that has none.
		while (node && node.nodeType === 1) {
			const element = node as Element;
			let { segment, anchored } = segmentFor(element, queryRoot);

			// Keep within the budget (the +1 accounts for the ">" that would join
			// this segment to the rest). A level whose full segment doesn't fit is
			// degraded to tag + position rather than discarded, so ancestor context
			// is never lost to one long feature.
			const joinedWith = (candidate: string): number =>
				segments.length
					? candidate.length + 1 + segments.join(">").length
					: candidate.length;

			if (joinedWith(segment) > MAX_LENGTH - 1) {
				segment = degradedSegmentFor(element);
				anchored = false;

				if (joinedWith(segment) > MAX_LENGTH - 1) {
					break;
				}
			}

			segments.unshift(segment);

			if (anchored) {
				break;
			}

			// Stop as soon as the selector already identifies a single element.
			// This, not truncation, is what keeps selectors short.
			if (queryRoot && matchCount(queryRoot, segments.join(">")) === 1) {
				break;
			}

			node = element.parentNode;
		}
	} catch {
		// A malformed node tree must never crash the audit; return what we have.
	}

	return segments.join(">");
}
