/**
 * IMPORTANT: Functions in this file that are serialized and injected into the
 * audited page must not reference any symbols outside their own scope. Shared
 * helpers used by unit tests are therefore duplicated inside each injected
 * function.
 */

import type { CandidateSnapshot, TextSpacingRect } from "./result";

export const FREEZE_STYLE_VALUE = "ts-freeze";
export const OVERRIDE_STYLE_VALUE = "ts-override";

export const FREEZE_CSS =
	"*, *::before, *::after { animation: none !important; transition: none !important; }";

export const OVERRIDE_CSS = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

export const DEFAULT_OVERLAP_AREA_PX2 = 4;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

export type OverlapInput = Pick<
	CandidateSnapshot,
	"index" | "selector" | "rect" | "fontSize" | "position" | "unstable"
>;

export type OverlapPair = { selector: string; overlapsWith: string };

export type BaselinePayload = { candidates: CandidateSnapshot[] };
export type RemeasurePayload = { candidates: CandidateSnapshot[] };
export type RestorePayload = { restored: boolean };

function clipsOverflow(value: string): boolean {
	return value === "hidden" || value === "clip";
}

function styleClips(cs: CSSStyleDeclaration): boolean {
	return [cs.overflowX, cs.overflowY, ...cs.overflow.split(/\s+/)].some(
		clipsOverflow,
	);
}

function parentCrossingShadow(el: Element): Element | null {
	if (el.parentElement) {
		return el.parentElement;
	}

	const root = el.getRootNode();

	if (root instanceof ShadowRoot) {
		return root.host;
	}

	return null;
}

function hasDirectTextNode(el: Element): boolean {
	for (const child of Array.from(el.childNodes)) {
		if (child.nodeType === 3 && (child.textContent ?? "").trim() !== "") {
			return true;
		}
	}

	return false;
}

export function isVisibleTextContainer(el: Element): boolean {
	if (SKIP_TAGS.has(el.tagName)) {
		return false;
	}

	if (!hasDirectTextNode(el)) {
		return false;
	}

	const cs = getComputedStyle(el);

	if (cs.display === "none" || cs.visibility === "hidden") {
		return false;
	}

	const box = el.getBoundingClientRect();

	return box.width > 0 && box.height > 0;
}

function walkCandidates(
	root: Document | ShadowRoot,
	acc: Element[],
	limit: number,
): void {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
	let node = walker.nextNode() as Element | null;

	while (node && acc.length < limit) {
		if (isVisibleTextContainer(node)) {
			acc.push(node);
		}

		if (node.shadowRoot) {
			walkCandidates(node.shadowRoot, acc, limit);
		}

		node = walker.nextNode() as Element | null;
	}
}

export function collectCandidateElements(limit: number): Element[] {
	const acc: Element[] = [];
	walkCandidates(document, acc, limit);

	return acc;
}

export function findNearestClippingAncestor(el: Element): Element | null {
	let node: Element | null = el;

	while (node) {
		const cs = getComputedStyle(node);

		if (styleClips(cs)) {
			return node;
		}

		node = parentCrossingShadow(node);
	}

	return null;
}

export function isTruncationActive(el: Element): boolean {
	const cs = getComputedStyle(el);
	const overflowX = Math.max(0, el.scrollWidth - el.clientWidth);
	const overflowY = Math.max(0, el.scrollHeight - el.clientHeight);
	const ellipsis = cs.textOverflow === "ellipsis";
	const lineClamp = cs.getPropertyValue("-webkit-line-clamp");
	const hasLineClamp = lineClamp !== "" && lineClamp !== "none";

	if (ellipsis && overflowX > 0) {
		return true;
	}

	return hasLineClamp && (overflowY > 0 || overflowX > 0);
}

function injectStyle(value: string, css: string): void {
	if (document.querySelector(`[data-a11y-pulse="${value}"]`)) {
		return;
	}

	const style = document.createElement("style");
	style.setAttribute("data-a11y-pulse", value);
	style.textContent = css;
	(document.head ?? document.documentElement).appendChild(style);
}

export function injectFreezeStyles(): void {
	injectStyle(FREEZE_STYLE_VALUE, FREEZE_CSS);
}

export function injectOverrideStyles(): void {
	injectStyle(OVERRIDE_STYLE_VALUE, OVERRIDE_CSS);
}

export function removeInjectedStyles(): void {
	for (const el of Array.from(
		document.querySelectorAll(
			'[data-a11y-pulse="ts-freeze"], [data-a11y-pulse="ts-override"]',
		),
	)) {
		el.remove();
	}
}

export function intersectionArea(
	a: TextSpacingRect,
	b: TextSpacingRect,
): number {
	const x = Math.max(
		0,
		Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
	);
	const y = Math.max(
		0,
		Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
	);

	return x * y;
}

export function verticalGap(a: TextSpacingRect, b: TextSpacingRect): number {
	if (a.y + a.height < b.y) {
		return b.y - (a.y + a.height);
	}

	if (b.y + b.height < a.y) {
		return a.y - (b.y + b.height);
	}

	return 0;
}

function isStickyOrFixed(position: string): boolean {
	return position === "sticky" || position === "fixed";
}

export function findOverlapPairs(
	baseline: OverlapInput[],
	after: OverlapInput[],
	overlapAreaTolerancePx2 = DEFAULT_OVERLAP_AREA_PX2,
): OverlapPair[] {
	const afterByIndex = new Map(
		after.map((candidate) => [candidate.index, candidate]),
	);
	const pairs: OverlapPair[] = [];

	for (let i = 0; i < baseline.length; i++) {
		const left = baseline[i];

		if (!left || left.unstable || isStickyOrFixed(left.position)) {
			continue;
		}

		const leftAfter = afterByIndex.get(left.index);

		if (!leftAfter || leftAfter.unstable) {
			continue;
		}

		for (let j = i + 1; j < baseline.length; j++) {
			const right = baseline[j];

			if (!right || right.unstable || isStickyOrFixed(right.position)) {
				continue;
			}

			const rightAfter = afterByIndex.get(right.index);

			if (!rightAfter || rightAfter.unstable) {
				continue;
			}

			const lineBox = 2 * Math.max(left.fontSize, right.fontSize);

			if (verticalGap(left.rect, right.rect) >= lineBox) {
				continue;
			}

			const beforeArea = intersectionArea(left.rect, right.rect);
			const afterArea = intersectionArea(leftAfter.rect, rightAfter.rect);

			if (
				beforeArea <= overlapAreaTolerancePx2 &&
				afterArea > overlapAreaTolerancePx2
			) {
				pairs.push({
					selector: left.selector,
					overlapsWith: right.selector,
				});
			}
		}
	}

	return pairs;
}

type PageState = {
	elements: Element[];
	snapshots: CandidateSnapshot[];
};

/**
 * Wait on fonts, freeze motion, collect candidate text containers, and
 * double-sample rects so JS-driven movement can be marked unstable.
 * Serialized and run in the page; must stay self-contained.
 */
export async function collectBaselineScript(
	limit: number,
): Promise<BaselinePayload> {
	const cap = typeof limit === "number" && limit >= 0 ? limit : 500;
	const freezeCss =
		"*, *::before, *::after { animation: none !important; transition: none !important; }";
	const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

	const fonts = (
		document as Document & { fonts?: { ready?: Promise<unknown> } }
	).fonts;

	if (fonts?.ready) {
		await fonts.ready;
	}

	if (!document.querySelector('[data-a11y-pulse="ts-freeze"]')) {
		const style = document.createElement("style");
		style.setAttribute("data-a11y-pulse", "ts-freeze");
		style.textContent = freezeCss;
		(document.head ?? document.documentElement).appendChild(style);
	}

	const clips = (value: string): boolean =>
		value === "hidden" || value === "clip";
	const axisOverflow = (cs: CSSStyleDeclaration, axis: "x" | "y"): string => {
		const specific = axis === "x" ? cs.overflowX : cs.overflowY;

		if (specific) {
			return specific;
		}

		const parts = cs.overflow.split(/\s+/).filter(Boolean);

		if (axis === "x") {
			return parts[0] || "visible";
		}

		return parts[1] || parts[0] || "visible";
	};
	const styleClips = (cs: CSSStyleDeclaration): boolean =>
		clips(axisOverflow(cs, "x")) || clips(axisOverflow(cs, "y"));

	const parentOf = (el: Element): Element | null => {
		if (el.parentElement) {
			return el.parentElement;
		}

		const root = el.getRootNode();

		if (root instanceof ShadowRoot) {
			return root.host;
		}

		return null;
	};

	const hasDirectText = (el: Element): boolean => {
		for (const child of Array.from(el.childNodes)) {
			if (child.nodeType === 3 && (child.textContent ?? "").trim() !== "") {
				return true;
			}
		}

		return false;
	};

	const isCandidate = (el: Element): boolean => {
		if (skipTags.has(el.tagName) || !hasDirectText(el)) {
			return false;
		}

		const cs = getComputedStyle(el);

		if (cs.display === "none" || cs.visibility === "hidden") {
			return false;
		}

		const box = el.getBoundingClientRect();

		return box.width > 0 && box.height > 0;
	};

	const walk = (root: Document | ShadowRoot, acc: Element[]): void => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
		let node = walker.nextNode() as Element | null;

		while (node && acc.length < cap) {
			if (isCandidate(node)) {
				acc.push(node);
			}

			if (node.shadowRoot) {
				walk(node.shadowRoot, acc);
			}

			node = walker.nextNode() as Element | null;
		}
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

	const readRect = (el: Element): TextSpacingRect => {
		const box = el.getBoundingClientRect();

		return { x: box.x, y: box.y, width: box.width, height: box.height };
	};

	const rectsDiffer = (a: TextSpacingRect, b: TextSpacingRect): boolean =>
		Math.abs(a.x - b.x) > 1 ||
		Math.abs(a.y - b.y) > 1 ||
		Math.abs(a.width - b.width) > 1 ||
		Math.abs(a.height - b.height) > 1;

	const isTruncated = (el: Element): boolean => {
		const cs = getComputedStyle(el);
		const overflowX = Math.max(0, el.scrollWidth - el.clientWidth);
		const overflowY = Math.max(0, el.scrollHeight - el.clientHeight);
		const ellipsis = cs.textOverflow === "ellipsis";
		const lineClamp = cs.getPropertyValue("-webkit-line-clamp");
		const hasLineClamp = lineClamp !== "" && lineClamp !== "none";

		if (ellipsis && overflowX > 0) {
			return true;
		}

		return hasLineClamp && (overflowY > 0 || overflowX > 0);
	};

	const measure = (
		el: Element,
		index: number,
		rect: TextSpacingRect,
		unstable: boolean,
	): CandidateSnapshot => {
		const cs = getComputedStyle(el);
		let clipper: Element | null = el;
		let found = false;

		while (clipper) {
			const clipCs = getComputedStyle(clipper);

			if (styleClips(clipCs)) {
				found = true;
				break;
			}

			clipper = parentOf(clipper);
		}

		const clipEl = found && clipper ? clipper : el;
		const clipCs = getComputedStyle(clipEl);
		const fontSize = Number.parseFloat(cs.fontSize);

		return {
			index,
			selector: getSelector(el),
			html: (el.cloneNode(false) as Element).outerHTML,
			scrollWidth: el.scrollWidth,
			scrollHeight: el.scrollHeight,
			clientWidth: el.clientWidth,
			clientHeight: el.clientHeight,
			rect,
			overflowX: axisOverflow(cs, "x"),
			overflowY: axisOverflow(cs, "y"),
			clipScrollWidth: clipEl.scrollWidth,
			clipScrollHeight: clipEl.scrollHeight,
			clipClientWidth: clipEl.clientWidth,
			clipClientHeight: clipEl.clientHeight,
			clipOverflowX: axisOverflow(clipCs, "x"),
			clipOverflowY: axisOverflow(clipCs, "y"),
			truncated: isTruncated(el),
			unstable,
			fontSize: Number.isFinite(fontSize) ? fontSize : 16,
			position: cs.position,
		};
	};

	const elements: Element[] = [];
	walk(document, elements);

	const firstRects = elements.map(readRect);

	const raf = globalThis.requestAnimationFrame?.bind(globalThis);

	if (raf) {
		await new Promise<void>((resolve) => {
			raf(() => resolve());
		});
	}

	const snapshots = elements.map((el, index) => {
		const second = readRect(el);
		const first = firstRects[index] ?? second;

		return measure(el, index, second, rectsDiffer(first, second));
	});

	(
		window as Window & { __a11yPulseTextSpacing?: PageState }
	).__a11yPulseTextSpacing = { elements, snapshots };

	return { candidates: snapshots };
}

/**
 * Inject the WCAG 1.4.12 bookmarklet stylesheet. Serialized; self-contained.
 */
export function injectOverrideScript(): void {
	if (document.querySelector('[data-a11y-pulse="ts-override"]')) {
		return;
	}

	const style = document.createElement("style");
	style.setAttribute("data-a11y-pulse", "ts-override");
	style.textContent = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;
	(document.head ?? document.documentElement).appendChild(style);
}

/**
 * Two animation frames so injected styles can settle. Serialized; self-contained.
 */
export async function waitTwoFramesScript(): Promise<void> {
	const raf = globalThis.requestAnimationFrame?.bind(globalThis);

	if (!raf) {
		return;
	}

	await new Promise<void>((resolve) => {
		raf(() => {
			raf(() => resolve());
		});
	});
}

/**
 * Re-measure the page-side candidate list after the override. Serialized.
 */
export function remeasureScript(): RemeasurePayload {
	const state = (window as Window & { __a11yPulseTextSpacing?: PageState })
		.__a11yPulseTextSpacing;

	if (!state) {
		return { candidates: [] };
	}

	const clips = (value: string): boolean =>
		value === "hidden" || value === "clip";
	const axisOverflow = (cs: CSSStyleDeclaration, axis: "x" | "y"): string => {
		const specific = axis === "x" ? cs.overflowX : cs.overflowY;

		if (specific) {
			return specific;
		}

		const parts = cs.overflow.split(/\s+/).filter(Boolean);

		if (axis === "x") {
			return parts[0] || "visible";
		}

		return parts[1] || parts[0] || "visible";
	};
	const styleClips = (cs: CSSStyleDeclaration): boolean =>
		clips(axisOverflow(cs, "x")) || clips(axisOverflow(cs, "y"));

	const parentOf = (el: Element): Element | null => {
		if (el.parentElement) {
			return el.parentElement;
		}

		const root = el.getRootNode();

		if (root instanceof ShadowRoot) {
			return root.host;
		}

		return null;
	};

	const candidates = state.elements.map((el, index) => {
		const previous = state.snapshots[index];
		const cs = getComputedStyle(el);
		const box = el.getBoundingClientRect();
		let clipper: Element | null = el;
		let found = false;

		while (clipper) {
			const clipCs = getComputedStyle(clipper);

			if (styleClips(clipCs)) {
				found = true;
				break;
			}

			clipper = parentOf(clipper);
		}

		const clipEl = found && clipper ? clipper : el;
		const clipCs = getComputedStyle(clipEl);

		return {
			index,
			selector: previous?.selector ?? "",
			html: previous?.html ?? "",
			scrollWidth: el.scrollWidth,
			scrollHeight: el.scrollHeight,
			clientWidth: el.clientWidth,
			clientHeight: el.clientHeight,
			rect: { x: box.x, y: box.y, width: box.width, height: box.height },
			overflowX: axisOverflow(cs, "x"),
			overflowY: axisOverflow(cs, "y"),
			clipScrollWidth: clipEl.scrollWidth,
			clipScrollHeight: clipEl.scrollHeight,
			clipClientWidth: clipEl.clientWidth,
			clipClientHeight: clipEl.clientHeight,
			clipOverflowX: axisOverflow(clipCs, "x"),
			clipOverflowY: axisOverflow(clipCs, "y"),
			truncated: previous?.truncated ?? false,
			unstable: previous?.unstable ?? false,
			fontSize: previous?.fontSize ?? 16,
			position: cs.position,
		};
	});

	return { candidates };
}

/**
 * Remove injected styles and spot-check that a sample of rects match baseline.
 * Never throws. Serialized; self-contained.
 */
export function restoreAndVerifyScript(): RestorePayload {
	try {
		for (const el of Array.from(
			document.querySelectorAll(
				'[data-a11y-pulse="ts-freeze"], [data-a11y-pulse="ts-override"]',
			),
		)) {
			el.remove();
		}

		const state = (window as Window & { __a11yPulseTextSpacing?: PageState })
			.__a11yPulseTextSpacing;

		if (!state) {
			return { restored: true };
		}

		const sample = state.snapshots
			.map((snapshot, index) => ({ snapshot, el: state.elements[index] }))
			.filter(
				(entry): entry is { snapshot: CandidateSnapshot; el: Element } =>
					Boolean(entry.el) && !entry.snapshot.unstable,
			)
			.slice(0, 20);

		let restored = true;

		for (const { snapshot, el } of sample) {
			const box = el.getBoundingClientRect();

			if (
				Math.abs(box.x - snapshot.rect.x) > 2 ||
				Math.abs(box.y - snapshot.rect.y) > 2 ||
				Math.abs(box.width - snapshot.rect.width) > 2 ||
				Math.abs(box.height - snapshot.rect.height) > 2
			) {
				restored = false;
				break;
			}
		}

		delete (window as Window & { __a11yPulseTextSpacing?: PageState })
			.__a11yPulseTextSpacing;

		return { restored };
	} catch {
		try {
			for (const el of Array.from(
				document.querySelectorAll(
					'[data-a11y-pulse="ts-freeze"], [data-a11y-pulse="ts-override"]',
				),
			)) {
				el.remove();
			}
		} catch {
			// The runner contract is satisfied by best-effort removal.
		}

		return { restored: false };
	}
}
