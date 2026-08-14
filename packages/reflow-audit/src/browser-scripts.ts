/**
 * IMPORTANT: Functions in this file that are serialized and injected into the
 * audited page must not reference any symbols outside their own scope. Shared
 * helpers used by unit tests are therefore duplicated inside each injected
 * function.
 */

export const REFLOW_WIDTH = 320;
export const MIN_REFLOW_HEIGHT = 1024;
export const ROUNDING_TOLERANCE = 2;
export const SCROLLBAR_TOLERANCE = 20;

export type LayoutFingerprint = {
	scrollWidth: number;
	clientWidth: number;
	childCount: number;
};

export type ReflowMeasureOffender = {
	selector: string;
	html: string;
	overflowPx: number;
	reason: "element-overflow" | "fixed-width-container";
};

export type ReflowMeasure = {
	documentOverflowPx: number;
	explainedByExempt: boolean;
	offenders: ReflowMeasureOffender[];
};

export function computeDocumentOverflowPx(
	documentElement: { scrollWidth: number; clientWidth: number },
	body: { scrollWidth: number; clientWidth: number },
): number {
	const htmlOverflow =
		documentElement.scrollWidth - documentElement.clientWidth;
	const bodyOverflow = body.scrollWidth - body.clientWidth;

	return Math.max(0, htmlOverflow, bodyOverflow);
}

function clipsX(overflowX: string): boolean {
	return overflowX === "hidden" || overflowX === "clip";
}

/**
 * Document overflow that the reader can actually scroll. `overflow-x: hidden`
 * on the viewport (including body overflow propagated onto html) clips rather
 * than scrolls, which v1 treats as no horizontal scroll.
 */
export function scrollableDocumentOverflowPx(
	documentElement: {
		scrollWidth: number;
		clientWidth: number;
		overflowX: string;
	},
	body: { scrollWidth: number; clientWidth: number; overflowX: string },
): number {
	const htmlDelta = Math.max(
		0,
		documentElement.scrollWidth - documentElement.clientWidth,
	);
	const bodyDelta = Math.max(0, body.scrollWidth - body.clientWidth);
	const viewportOverflowX =
		documentElement.overflowX === "visible"
			? body.overflowX
			: documentElement.overflowX;

	let overflow = 0;

	if (!clipsX(viewportOverflowX)) {
		overflow = Math.max(overflow, htmlDelta);
	}

	if (documentElement.overflowX !== "visible" && !clipsX(body.overflowX)) {
		overflow = Math.max(overflow, bodyDelta);
	}

	return overflow;
}

const LAYOUT_TABLE_ROLES = new Set(["presentation", "none"]);
const ARIA_TABLE_ROLES = new Set(["table", "grid", "treegrid"]);
const EXEMPT_TAGS = new Set([
	"svg",
	"canvas",
	"video",
	"img",
	"iframe",
	"embed",
	"object",
]);
const SLIDE_DESCRIPTIONS = new Set(["slide", "slides", "presentation"]);

export function isExemptElement(el: Element): boolean {
	const tag = el.tagName.toLowerCase();

	if (tag === "table") {
		const role = (el.getAttribute("role") ?? "").toLowerCase();

		return !LAYOUT_TABLE_ROLES.has(role);
	}

	const role = (el.getAttribute("role") ?? "").toLowerCase();

	if (ARIA_TABLE_ROLES.has(role) || role === "toolbar") {
		return true;
	}

	if (EXEMPT_TAGS.has(tag)) {
		return true;
	}

	const description = (
		el.getAttribute("aria-roledescription") ?? ""
	).toLowerCase();

	return SLIDE_DESCRIPTIONS.has(description);
}

/**
 * Read a layout fingerprint used by the settle loop. Serialized and run in the page.
 */
export function readLayoutFingerprintScript(): LayoutFingerprint {
	const root = document.documentElement;

	return {
		scrollWidth: root.scrollWidth,
		clientWidth: root.clientWidth,
		childCount: document.body ? document.body.childElementCount : 0,
	};
}

/**
 * Measure document overflow and collect offenders. Serialized and run in the page;
 * must stay self-contained.
 */
export function measureReflowScript(): ReflowMeasure {
	const roundingTolerance = 2;
	const viewportWidth = window.innerWidth;
	const html = document.documentElement;
	const body = document.body;
	const clipsX = (overflowX: string): boolean =>
		overflowX === "hidden" || overflowX === "clip";
	const htmlOverflowX = getComputedStyle(html).overflowX;
	const bodyOverflowX = body ? getComputedStyle(body).overflowX : "visible";
	const htmlDelta = Math.max(0, html.scrollWidth - html.clientWidth);
	const bodyDelta = body ? Math.max(0, body.scrollWidth - body.clientWidth) : 0;
	const viewportOverflowX =
		htmlOverflowX === "visible" ? bodyOverflowX : htmlOverflowX;
	let documentOverflowPx = 0;

	if (!clipsX(viewportOverflowX)) {
		documentOverflowPx = Math.max(documentOverflowPx, htmlDelta);
	}

	if (htmlOverflowX !== "visible" && !clipsX(bodyOverflowX)) {
		documentOverflowPx = Math.max(documentOverflowPx, bodyDelta);
	}

	const layoutTableRoles = new Set(["presentation", "none"]);
	const ariaTableRoles = new Set(["table", "grid", "treegrid"]);
	const exemptTags = new Set([
		"svg",
		"canvas",
		"video",
		"img",
		"iframe",
		"embed",
		"object",
	]);
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

	const isExempt = (el: Element): boolean => {
		const tag = el.tagName.toLowerCase();

		if (tag === "table") {
			const role = (el.getAttribute("role") ?? "").toLowerCase();

			return !layoutTableRoles.has(role);
		}

		const role = (el.getAttribute("role") ?? "").toLowerCase();

		if (ariaTableRoles.has(role) || role === "toolbar") {
			return true;
		}

		if (exemptTags.has(tag)) {
			return true;
		}

		const description = (
			el.getAttribute("aria-roledescription") ?? ""
		).toLowerCase();

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

	const ancestors = (el: Element): Element[] => {
		const chain: Element[] = [];
		let node: Element | null = el;

		while (node) {
			chain.push(node);
			node = parentElementCrossingShadow(node);
		}

		return chain;
	};

	const isOrInsideExempt = (el: Element): boolean =>
		ancestors(el).some(isExempt);

	const isAriaHidden = (el: Element): boolean =>
		ancestors(el).some((node) => node.getAttribute("aria-hidden") === "true");

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

		const cs = getComputedStyle(el);

		return (
			cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0"
		);
	};

	const fitsViewportScroller = (el: Element): boolean => {
		for (const node of ancestors(el).slice(1)) {
			if (node === html || node === body) {
				continue;
			}

			const cs = getComputedStyle(node);
			const overflowX = cs.overflowX;

			if (overflowX !== "auto" && overflowX !== "scroll") {
				continue;
			}

			const rect = node.getBoundingClientRect();

			if (rect.width <= viewportWidth + roundingTolerance) {
				return true;
			}
		}

		return false;
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
		typeof CSS !== "undefined" && typeof CSS.escape === "function"
			? CSS.escape(value)
			: value;

	const tagName = (node: Node): string =>
		node.nodeType === 1
			? node.nodeName.toLowerCase()
			: node.nodeName.toUpperCase().replace(/^#/, "");

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
		const queryRoot =
			root && root.nodeType === 1 ? rootOf(root as Element) : null;

		try {
			while (node && node.nodeType === 1) {
				const element = node as Element;
				let { segment, anchored } = segmentFor(element, queryRoot);
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

	const collectElements = (
		root: Document | ShadowRoot,
		acc: Element[],
	): void => {
		for (const el of Array.from(root.querySelectorAll("*"))) {
			acc.push(el);

			if (el.shadowRoot) {
				collectElements(el.shadowRoot, acc);
			}
		}
	};

	const elements: Element[] = [];
	collectElements(document, elements);

	const overflowOffenders: ReflowMeasureOffender[] = [];
	const recorded = new Set<Element>();
	let explainedByExempt = false;

	for (const el of elements) {
		if (el === html || el === body) {
			continue;
		}

		const rect = el.getBoundingClientRect();
		const overflowPx = rect.right - viewportWidth;

		if (overflowPx <= roundingTolerance) {
			continue;
		}

		if (rect.width <= 0 || rect.height <= 0) {
			continue;
		}

		if (rect.right <= 0 || rect.bottom <= 0) {
			continue;
		}

		if (!isVisible(el) || isAriaHidden(el)) {
			continue;
		}

		const cs = getComputedStyle(el);

		if (cs.position === "fixed") {
			continue;
		}

		if (fitsViewportScroller(el)) {
			continue;
		}

		if (isOrInsideExempt(el)) {
			explainedByExempt = true;
			continue;
		}

		if (
			ancestors(el)
				.slice(1)
				.some((node) => recorded.has(node))
		) {
			continue;
		}

		recorded.add(el);
		overflowOffenders.push({
			selector: getSelector(el),
			html: (el.cloneNode(false) as Element).outerHTML,
			overflowPx: Math.round(overflowPx),
			reason: "element-overflow",
		});
	}

	const offenders = [...overflowOffenders];

	if (documentOverflowPx > roundingTolerance) {
		for (const el of elements) {
			if (el === html || el === body || recorded.has(el)) {
				continue;
			}

			if (isOrInsideExempt(el) || isAriaHidden(el) || !isVisible(el)) {
				continue;
			}

			const cs = getComputedStyle(el);
			const width = parsePx(cs.width);
			const minWidth = parsePx(cs.minWidth);
			const computed = Math.max(width ?? 0, minWidth ?? 0);

			if (computed <= viewportWidth + roundingTolerance) {
				continue;
			}

			const tag = el.tagName.toLowerCase();
			const display = cs.display;

			if (
				!layoutTags.has(tag) ||
				display === "inline" ||
				display === "none" ||
				cs.position === "fixed"
			) {
				continue;
			}

			offenders.push({
				selector: getSelector(el),
				html: (el.cloneNode(false) as Element).outerHTML,
				overflowPx: Math.round(computed - viewportWidth),
				reason: "fixed-width-container",
			});
		}
	}

	return {
		documentOverflowPx,
		explainedByExempt: explainedByExempt && overflowOffenders.length === 0,
		offenders,
	};
}
