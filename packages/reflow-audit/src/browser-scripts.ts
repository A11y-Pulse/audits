/**
 * IMPORTANT: Functions in this file that are serialized and injected into the audited page must not
 * reference any symbols outside their own scope. Type-only imports are erased by the compiler, so
 * they don't count.
 */

import type { Rect } from "@a11y-pulse/browser-adaptor";

export const REFLOW_WIDTH = 320;
export const MIN_REFLOW_HEIGHT = 1024;
export const ROUNDING_TOLERANCE = 2;
export const SCROLLBAR_TOLERANCE = 20;

export type LayoutFingerprint = {
	scrollWidth: number;
	clientWidth: number;
	bodyScrollWidth: number;
	bodyClientWidth: number;
	childCount: number;
};

/**
 * - `element-overflow`: an element's box extends past the viewport and adds horizontal scroll.
 * - `text-overflow`: text spills out of its element past the viewport and adds horizontal scroll.
 * - `fixed-width-container`: a layout container with a px width wider than the viewport.
 * - `media-overflow`: an `img`, `video` or `iframe` wider than the viewport.
 * - `clipped-content`: content extends past the viewport where it cannot be scrolled to (clipped by
 *   the page's `overflow-x`, or inside `position: fixed`).
 * - `scrolling-container`: most of the page sits in a container that scrolls horizontally. Its
 *   `overflowing` lists what inside it is too wide.
 */
export type ReflowOffenderReason =
	| "element-overflow"
	| "text-overflow"
	| "fixed-width-container"
	| "media-overflow"
	| "clipped-content"
	| "scrolling-container";

/** Content that is too wide for the horizontal scroller it sits in. */
export type ReflowOverflowingContent = {
	selector: string;
	html: string;
	/** How far the content reaches past the scroller's edge. */
	overflowPx: number;
	/** Box of the content, in document coordinates. */
	rect: Rect;
};

export type ReflowMeasureOffender = {
	selector: string;
	html: string;
	overflowPx: number;
	reason: ReflowOffenderReason;
	/** Box of the offending element (or of its overflowing text), in document coordinates. */
	rect: Rect;
	/**
	 * `scrolling-container` only: the outermost content inside the scroller that is wider than it,
	 * first few only.
	 */
	overflowing?: ReflowOverflowingContent[];
};

export type ReflowMeasure = {
	documentOverflowPx: number;
	explainedByExempt: boolean;
	offenders: ReflowMeasureOffender[];
};

/**
 * Read a layout fingerprint used by the settle loop. Serialized and run in the page.
 */
export function readLayoutFingerprintScript(): LayoutFingerprint {
	const root = document.documentElement;
	const body = document.body;

	return {
		scrollWidth: root.scrollWidth,
		clientWidth: root.clientWidth,
		bodyScrollWidth: body ? body.scrollWidth : 0,
		bodyClientWidth: body ? body.clientWidth : 0,
		childCount: body ? body.childElementCount : 0,
	};
}

export function pageDimensionsScript(): { width: number; height: number } {
	return {
		width: document.documentElement.scrollWidth,
		height: document.documentElement.scrollHeight,
	};
}

/**
 * Scroll the window to `x` (keeping its vertical position unless `y` is given) without animation,
 * and return where it was. Serialized and run in the page.
 */
export function scrollWindowToScript(x: number, y: number | null): { x: number; y: number } {
	const previous = { x: window.scrollX || 0, y: window.scrollY || 0 };

	window.scrollTo({ left: x, top: y ?? previous.y, behavior: "instant" });

	return previous;
}

/**
 * Measure document overflow and collect offenders. Serialized and run in the page; must stay
 * self-contained.
 */
export function measureReflowScript(): ReflowMeasure {
	const roundingTolerance = 2;
	const viewportWidth = window.innerWidth;
	const scrollX = window.scrollX || 0;
	const scrollY = window.scrollY || 0;
	const html = document.documentElement;
	const body = document.body;
	const clipsX = (overflowX: string): boolean => overflowX === "hidden" || overflowX === "clip";
	const htmlOverflowX = getComputedStyle(html).overflowX || "visible";
	const bodyOverflowX = (body && getComputedStyle(body).overflowX) || "visible";
	const htmlDelta = Math.max(0, html.scrollWidth - html.clientWidth);
	const bodyDelta = body ? Math.max(0, body.scrollWidth - body.clientWidth) : 0;
	const viewportOverflowX = htmlOverflowX === "visible" ? bodyOverflowX : htmlOverflowX;
	// The viewport takes its scroll origin from body's direction: an RTL page overflows to the left.
	const rtl = getComputedStyle(body ?? html).direction === "rtl";
	let documentOverflowPx = 0;

	if (!clipsX(viewportOverflowX)) {
		documentOverflowPx = Math.max(documentOverflowPx, htmlDelta);
	}

	// Once the root element takes the viewport's overflow for itself, body's applies to body's own
	// box. Only a body that scrolls adds a sideways scroll; one left `visible` merely spills into a
	// root that clips it.
	if (htmlOverflowX !== "visible" && (bodyOverflowX === "auto" || bodyOverflowX === "scroll")) {
		documentOverflowPx = Math.max(documentOverflowPx, bodyDelta);
	}

	const documentScrolls = documentOverflowPx > roundingTolerance;

	const layoutTableRoles = new Set(["presentation", "none"]);
	const ariaTableRoles = new Set(["table", "grid", "treegrid"]);
	const exemptTags = new Set(["svg", "canvas", "embed", "object"]);
	const mediaTags = new Set(["img", "video", "iframe"]);
	const slideDescriptions = new Set(["slide", "slides", "presentation"]);
	const layoutTags = new Set([
		"div",
		"section",
		"main",
		"article",
		"header",
		"footer",
		"aside",
		"nav",
	]);

	const styles = new Map<Element, CSSStyleDeclaration>();

	const styleOf = (el: Element): CSSStyleDeclaration => {
		let cs = styles.get(el);

		if (!cs) {
			cs = getComputedStyle(el);
			styles.set(el, cs);
		}

		return cs;
	};

	// A table only needs two-dimensional layout when it holds data. One with no header cells,
	// caption or header associations of its own is positioning content, which has to reflow.
	const isDataTable = (table: Element): boolean => {
		for (const marker of Array.from(
			table.querySelectorAll("th, caption, thead, [scope], [headers]"),
		)) {
			if (marker.closest("table") === table) {
				return true;
			}
		}

		return false;
	};

	const isExempt = (el: Element): boolean => {
		const tag = el.tagName.toLowerCase();
		const role = (el.getAttribute("role") ?? "").toLowerCase();

		if (tag === "table") {
			if (layoutTableRoles.has(role)) {
				return false;
			}

			return ariaTableRoles.has(role) || isDataTable(el);
		}

		if (ariaTableRoles.has(role) || role === "toolbar") {
			return true;
		}

		if (exemptTags.has(tag)) {
			return true;
		}

		const description = (el.getAttribute("aria-roledescription") ?? "").toLowerCase();

		return slideDescriptions.has(description);
	};

	const parentElementCrossingShadow = (el: Element): Element | null => {
		if (el.parentElement) {
			return el.parentElement;
		}

		const root = el.getRootNode();

		if (root instanceof ShadowRoot) {
			return root.host;
		}

		return null;
	};

	/** Memoise a predicate that holds for an element when it holds for the element or an ancestor. */
	const inherited = (own: (el: Element) => boolean): ((el: Element) => boolean) => {
		const memo = new Map<Element, boolean>();

		const lookup = (el: Element): boolean => {
			const known = memo.get(el);

			if (known !== undefined) {
				return known;
			}

			const parent = parentElementCrossingShadow(el);
			const value = own(el) || (parent !== null && lookup(parent));
			memo.set(el, value);

			return value;
		};

		return lookup;
	};

	const isOrInsideExempt = inherited(isExempt);
	const isAriaHidden = inherited((el) => el.getAttribute("aria-hidden") === "true");

	const isVisible = (el: Element): boolean => {
		const visibilityCheck = el as Element & {
			checkVisibility?: (options?: {
				checkOpacity?: boolean;
				checkVisibilityCSS?: boolean;
			}) => boolean;
		};

		if (typeof visibilityCheck.checkVisibility === "function") {
			return visibilityCheck.checkVisibility({
				checkOpacity: true,
				checkVisibilityCSS: true,
			});
		}

		const cs = styleOf(el);

		return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
	};

	/**
	 * What stops content from adding to the page's horizontal scroll: a viewport-fitting ancestor
	 * that clips (`clip`) or scrolls (`scroll`) its overflow, or a `position: fixed` box (`fixed`).
	 */
	type Containment =
		| { kind: "none" }
		| { kind: "fixed" }
		| { kind: "clip" | "scroll"; by: Element };

	const NOT_CONTAINED: Containment = { kind: "none" };
	const FIXED: Containment = { kind: "fixed" };
	const containmentMemo = new Map<Element, Containment>();

	const isPositioned = (cs: CSSStyleDeclaration): boolean =>
		(cs.position !== "static" && cs.position !== "") ||
		(cs.transform !== "none" && cs.transform !== "" && cs.transform !== undefined);

	// Containment seen by an absolutely positioned box: ancestors between it and its containing
	// block do not clip it.
	const containmentOfAbsolute = (el: Element): Containment => {
		let node = parentElementCrossingShadow(el);

		while (node && node !== html && node !== body) {
			if (isPositioned(styleOf(node))) {
				return containmentInside(node);
			}

			node = parentElementCrossingShadow(node);
		}

		return NOT_CONTAINED;
	};

	// Containment seen by content laid out inside `node`.
	const containmentInside = (node: Element | null): Containment => {
		if (!node || node === html || node === body) {
			return NOT_CONTAINED;
		}

		const known = containmentMemo.get(node);

		if (known) {
			return known;
		}

		const cs = styleOf(node);
		const overflowX = cs.overflowX;
		let result: Containment;

		// A box that clips or scrolls its own overflow contains it whatever its position: a fixed tab
		// bar that scrolls sideways keeps its tabs within reach.
		if (
			(clipsX(overflowX) || overflowX === "auto" || overflowX === "scroll") &&
			node.getBoundingClientRect().width <= viewportWidth + roundingTolerance
		) {
			result = { kind: clipsX(overflowX) ? "clip" : "scroll", by: node };
		} else if (cs.position === "fixed") {
			result = FIXED;
		} else if (cs.position === "absolute") {
			result = containmentOfAbsolute(node);
		} else {
			result = containmentInside(parentElementCrossingShadow(node));
		}

		containmentMemo.set(node, result);

		return result;
	};

	const containmentOf = (el: Element): Containment => {
		const position = styleOf(el).position;

		if (position === "fixed") {
			return FIXED;
		}

		if (position === "absolute") {
			return containmentOfAbsolute(el);
		}

		return containmentInside(parentElementCrossingShadow(el));
	};

	const parsePx = (value: string): number | null => {
		if (!value.endsWith("px")) {
			return null;
		}

		const parsed = Number.parseFloat(value);

		return Number.isFinite(parsed) ? parsed : null;
	};

	const MAX_LENGTH = 128;

	const esc = (value: string): string =>
		typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value;

	const tagName = (node: Node): string =>
		node.nodeType === 1
			? node.nodeName.toLowerCase()
			: node.nodeName.toUpperCase().replace(/^#/, "");

	const rootOf = (element: Element): ParentNode | null => {
		const node = (element as Element & { getRootNode?: () => Node }).getRootNode?.();

		return node && typeof (node as ParentNode).querySelectorAll === "function"
			? (node as ParentNode)
			: null;
	};

	const matchCount = (queryRoot: ParentNode, selector: string): number => {
		try {
			return queryRoot.querySelectorAll(selector).length;
		} catch {
			return Number.POSITIVE_INFINITY;
		}
	};

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

	type Feature = {
		feature: string;
		sharedBy: (sibling: Element) => boolean;
	};

	const classFeature = (cls: string): Feature => ({
		feature: `.${esc(cls)}`,
		sharedBy: (sibling) => Array.from(sibling.classList ?? []).includes(cls),
	});

	const rarestFeature = (element: Element, queryRoot: ParentNode | null): Feature | null => {
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

		const href = typeof element.getAttribute === "function" ? element.getAttribute("href") : null;

		if (href && href.length <= 100 && !/["\\?]/.test(href)) {
			const feature = `[href="${href}"]`;

			if (safeMatches(element, feature) && matchCount(queryRoot, feature) < bestCount) {
				return {
					feature,
					sharedBy: (sibling) =>
						typeof sibling.getAttribute === "function" && sibling.getAttribute("href") === href,
				};
			}
		}

		return best;
	};

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
		if (element.id && idIsUnique(element, element.id)) {
			return { segment: `#${esc(element.id)}`, anchored: true };
		}

		const feature = rarestFeature(element, queryRoot);
		let segment = tagName(element) + (feature === null ? "" : feature.feature);
		const { nth, ambiguous } = positionAmongSiblings(
			element,
			feature === null ? () => true : feature.sharedBy,
		);

		if (ambiguous && nth > 0) {
			segment += `:nth-of-type(${nth})`;
		}

		return { segment, anchored: false };
	};

	const degradedSegmentFor = (element: Element): string => {
		let segment = tagName(element);
		const { nth, ambiguous } = positionAmongSiblings(element, () => true);

		if (ambiguous && nth > 0) {
			segment += `:nth-of-type(${nth})`;
		}

		return segment;
	};

	const getSelector = (root: Node | null): string => {
		const segments: string[] = [];
		let node: Node | null = root;
		const queryRoot = root && root.nodeType === 1 ? rootOf(root as Element) : null;

		try {
			while (node && node.nodeType === 1) {
				const element = node as Element;
				let { segment, anchored } = segmentFor(element, queryRoot);
				const joinedWith = (candidate: string): number =>
					segments.length ? candidate.length + 1 + segments.join(">").length : candidate.length;

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

				if (queryRoot && matchCount(queryRoot, segments.join(">")) === 1) {
					break;
				}

				node = element.parentNode;
			}
		} catch {
			// A malformed node tree must never crash the audit; return what we have.
		}

		return segments.join(">");
	};

	const collectElements = (root: Document | ShadowRoot, acc: Element[]): void => {
		for (const el of Array.from(root.querySelectorAll("*"))) {
			acc.push(el);

			if (el.shadowRoot) {
				collectElements(el.shadowRoot, acc);
			}
		}
	};

	const elements: Element[] = [];
	collectElements(document, elements);

	type Box = { left: number; top: number; right: number; bottom: number };

	const MAX_OVERFLOWING = 5;
	const offenders: ReflowMeasureOffender[] = [];
	const recorded = new Set<Element>();
	// Each horizontal scroller found to hold overflowing content, with the outermost of that content.
	const scrollers = new Map<Element, Array<{ el: Element; box: Box }>>();
	const scrollerContent = new Set<Element>();
	const textCandidates: Element[] = [];
	let scrollingOverflow = false;
	let maxExemptOverflowPx = 0;

	// Elements are visited ancestors-first, so whether an ancestor was recorded is already final.
	const underRecordedMemo = new Map<Element, boolean>();

	const isUnderRecorded = (el: Element): boolean => {
		const parent = parentElementCrossingShadow(el);

		if (!parent) {
			return false;
		}

		const known = underRecordedMemo.get(parent);

		if (known !== undefined) {
			return known;
		}

		const value = recorded.has(parent) || isUnderRecorded(parent);
		underRecordedMemo.set(parent, value);

		return value;
	};

	const hasRecordedAncestor = (el: Element): boolean => {
		for (
			let node = parentElementCrossingShadow(el);
			node;
			node = parentElementCrossingShadow(node)
		) {
			if (recorded.has(node)) {
				return true;
			}
		}

		return false;
	};

	const documentRect = (box: Box): Rect => ({
		x: box.left + scrollX,
		y: box.top + scrollY,
		width: box.right - box.left,
		height: box.bottom - box.top,
	});

	const record = (
		el: Element,
		reason: ReflowMeasureOffender["reason"],
		overflowPx: number,
		box: Box,
		overflowing?: ReflowOverflowingContent[],
	) => {
		const offender: ReflowMeasureOffender = {
			selector: getSelector(el),
			html: (el.cloneNode(false) as Element).outerHTML,
			overflowPx: Math.round(overflowPx),
			reason,
			rect: documentRect(box),
		};

		if (overflowing && overflowing.length > 0) {
			offender.overflowing = overflowing;
		}

		offenders.push(offender);
	};

	// Elements are visited ancestors-first, so only the outermost overflowing content is kept.
	const noteScrollerContent = (scroller: Element, el: Element, box: Box): void => {
		let content = scrollers.get(scroller);

		if (!content) {
			content = [];
			scrollers.set(scroller, content);
		}

		for (
			let node = parentElementCrossingShadow(el);
			node && node !== scroller;
			node = parentElementCrossingShadow(node)
		) {
			if (scrollerContent.has(node)) {
				return;
			}
		}

		scrollerContent.add(el);

		if (content.length < MAX_OVERFLOWING) {
			content.push({ el, box });
		}
	};

	/**
	 * Whether an inline wrapper (`<picture>`, a link around an image) reaches past the viewport only
	 * because of media inside it. Its box is just the box of what it wraps, so the media is the thing
	 * to report.
	 */
	const overflowsOnlyThroughMedia = (el: Element, box: Box): boolean => {
		if (mediaTags.has(el.tagName.toLowerCase()) || styleOf(el).display !== "inline") {
			return false;
		}

		const reach = (target: Box): number =>
			Math.max(overflowOf(target, false), overflowOf(target, true));
		let mediaReach = Number.NEGATIVE_INFINITY;

		for (const media of Array.from(el.querySelectorAll("img, video, iframe"))) {
			const mediaRect = media.getBoundingClientRect();

			if (mediaRect.width > 0 && mediaRect.height > 0) {
				mediaReach = Math.max(mediaReach, reach(mediaRect));
			}
		}

		if (mediaReach + roundingTolerance < reach(box)) {
			return false;
		}

		// Text of the wrapper's own that runs past the edge is the wrapper's to answer for.
		if (typeof document.createRange === "function") {
			for (const child of Array.from(el.childNodes)) {
				if (child.nodeType !== 3 || !(child.nodeValue ?? "").trim()) {
					continue;
				}

				const range = document.createRange();
				range.selectNodeContents(child);

				if (
					typeof range.getBoundingClientRect === "function" &&
					reach(range.getBoundingClientRect()) > roundingTolerance
				) {
					return false;
				}
			}
		}

		return true;
	};

	// How far `box` (viewport coordinates) reaches past the edge the page scrolls towards.
	const overflowOf = (box: Box, fixed: boolean): number => {
		const offset = fixed ? 0 : scrollX;

		return rtl ? -(box.left + offset) : box.right + offset - viewportWidth;
	};

	// Entirely beyond the viewport edge: off-canvas content rather than content that is cut off.
	const isOffCanvas = (box: Box, fixed: boolean): boolean => {
		const offset = fixed ? 0 : scrollX;

		return rtl ? box.right + offset <= 0 : box.left + offset >= viewportWidth;
	};

	/**
	 * Decide what an overflowing box means. `el` is the element the box belongs to and `violation`
	 * the reason to record when the overflow really does add horizontal scroll to the page.
	 */
	const classify = (
		el: Element,
		box: Box,
		containment: Containment,
		violation: "element-overflow" | "text-overflow",
	): void => {
		if (containment.kind === "clip") {
			return;
		}

		const exempt = isOrInsideExempt(el);
		const media = mediaTags.has(el.tagName.toLowerCase());

		if (containment.kind === "scroll") {
			if (!exempt && !media && !isOrInsideExempt(containment.by)) {
				noteScrollerContent(containment.by, el, box);
			}

			return;
		}

		const fixed = containment.kind === "fixed";
		const overflowPx = overflowOf(box, fixed);

		if (overflowPx <= roundingTolerance) {
			return;
		}

		if (exempt) {
			if (!fixed) {
				maxExemptOverflowPx = Math.max(maxExemptOverflowPx, overflowPx);
			}

			return;
		}

		// Nothing here scrolls into view: either the box is fixed or the page clips its overflow.
		if (fixed || !documentScrolls) {
			if (!isOffCanvas(box, fixed)) {
				recorded.add(el);
				record(el, "clipped-content", overflowPx, box);
			}

			return;
		}

		recorded.add(el);
		scrollingOverflow ||= !media;
		record(el, media ? "media-overflow" : violation, overflowPx, box);
	};

	for (const el of elements) {
		if (el === html || el === body) {
			continue;
		}

		const rect = el.getBoundingClientRect();

		if (rect.width <= 0 || rect.height <= 0 || rect.bottom + scrollY <= 0) {
			continue;
		}

		// Fixed boxes are measured against the viewport, everything else against the document, and
		// which applies is not known until the styles are read: let either through here.
		if (Math.max(overflowOf(rect, false), overflowOf(rect, true)) <= roundingTolerance) {
			const contentEdge = rtl ? rect.right - el.scrollWidth : rect.left + el.scrollWidth;

			if (
				el.clientWidth > 0 &&
				el.scrollWidth > el.clientWidth + roundingTolerance &&
				overflowOf({ left: contentEdge, top: 0, right: contentEdge, bottom: 0 }, false) >
					roundingTolerance
			) {
				textCandidates.push(el);
			}

			continue;
		}

		if (isUnderRecorded(el) || !isVisible(el) || isAriaHidden(el)) {
			continue;
		}

		// Left unrecorded, so the media inside is visited and reported in its own right.
		if (overflowsOnlyThroughMedia(el, rect)) {
			continue;
		}

		classify(el, rect, containmentOf(el), "element-overflow");
	}

	// Text that spills out of a box which itself fits: a nowrap heading, a long URL, a wide <pre>.
	for (const el of textCandidates) {
		if (typeof document.createRange !== "function" || recorded.has(el) || hasRecordedAncestor(el)) {
			continue;
		}

		const cs = styleOf(el);

		// A box that clips or scrolls its own overflow keeps its text to itself.
		if (cs.overflowX !== "visible" && cs.overflowX !== "") {
			continue;
		}

		let box: Box | null = null;

		for (const child of Array.from(el.childNodes)) {
			if (child.nodeType !== 3 || !(child.nodeValue ?? "").trim()) {
				continue;
			}

			const range = document.createRange();
			range.selectNodeContents(child);

			if (typeof range.getBoundingClientRect !== "function") {
				continue;
			}

			const textRect = range.getBoundingClientRect();

			if (textRect.width <= 0 || textRect.height <= 0) {
				continue;
			}

			box = box
				? {
						left: Math.min(box.left, textRect.left),
						top: Math.min(box.top, textRect.top),
						right: Math.max(box.right, textRect.right),
						bottom: Math.max(box.bottom, textRect.bottom),
					}
				: {
						left: textRect.left,
						top: textRect.top,
						right: textRect.right,
						bottom: textRect.bottom,
					};
		}

		if (!box || Math.max(overflowOf(box, false), overflowOf(box, true)) <= roundingTolerance) {
			continue;
		}

		if (!isVisible(el) || isAriaHidden(el)) {
			continue;
		}

		const containment = cs.position === "fixed" ? FIXED : containmentOf(el);

		classify(el, box, containment, "text-overflow");
	}

	// A horizontal scroller that holds most of the page puts the page itself behind a sideways
	// scroll; a carousel rail or a code sample does not.
	if (scrollers.size > 0) {
		// Rendered text only: textContent would also count scripts, styles and hidden content.
		const textLength = (el: HTMLElement): number => {
			// biome-ignore lint/performance/useDomNodeTextContent: see above
			const rendered = el.innerText;

			return (typeof rendered === "string" ? rendered : (el.textContent ?? "")).trim().length;
		};
		const pageTextLength = body ? textLength(body) : 0;

		for (const [scroller, content] of scrollers) {
			if (pageTextLength === 0 || textLength(scroller as HTMLElement) * 2 <= pageTextLength) {
				continue;
			}

			if (recorded.has(scroller) || hasRecordedAncestor(scroller)) {
				continue;
			}

			if (!isVisible(scroller) || isAriaHidden(scroller)) {
				continue;
			}

			const scrollerRect = scroller.getBoundingClientRect();

			recorded.add(scroller);
			record(
				scroller,
				"scrolling-container",
				scroller.scrollWidth - scroller.clientWidth,
				scrollerRect,
				content.map(({ el, box }) => ({
					selector: getSelector(el),
					html: (el.cloneNode(false) as Element).outerHTML,
					// The box moves with the scroller's own scroll position; the overflow does not.
					overflowPx: Math.round(
						rtl
							? scrollerRect.left - box.left - scroller.scrollLeft
							: box.right + scroller.scrollLeft - scrollerRect.right,
					),
					rect: documentRect(box),
				})),
			);
		}
	}

	if (documentScrolls) {
		for (const el of elements) {
			if (!layoutTags.has(el.tagName.toLowerCase()) || recorded.has(el)) {
				continue;
			}

			const cs = styleOf(el);
			const display = cs.display;

			if (display === "inline" || display === "none" || cs.position === "fixed") {
				continue;
			}

			const width = parsePx(cs.width);
			const minWidth = parsePx(cs.minWidth);
			const computed = Math.max(width ?? 0, minWidth ?? 0);

			if (computed <= viewportWidth + roundingTolerance) {
				continue;
			}

			if (isOrInsideExempt(el) || isAriaHidden(el) || !isVisible(el)) {
				continue;
			}

			// A wide box inside something that clips or scrolls it is not what widens the page.
			if (containmentOf(el).kind !== "none") {
				continue;
			}

			record(el, "fixed-width-container", computed - viewportWidth, el.getBoundingClientRect());
		}
	}

	return {
		documentOverflowPx,
		explainedByExempt:
			!scrollingOverflow &&
			documentScrolls &&
			maxExemptOverflowPx + roundingTolerance >= documentOverflowPx,
		offenders,
	};
}
