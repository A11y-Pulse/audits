/**
 * IMPORTANT: Functions in this file that are serialized and injected into the audited page must not
 * reference any symbols outside their own scope. The measurement logic therefore lives in one
 * place, `collectBaselineScript`, which leaves its helpers on the page for the later scripts to
 * call. Anything those helpers need from this module (the stylesheets) is passed in as an argument.
 */

import type { CandidateSnapshot, TextSpacingRect } from "./result";

export const FREEZE_STYLE_VALUE = "ts-freeze";
export const OVERRIDE_STYLE_VALUE = "ts-override";

const FREEZE_RULES =
	"*, *::before, *::after { animation: none !important; transition: none !important; }";

const OVERRIDE_RULES = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

// A user stylesheet beats every author declaration, `!important` or not. An author-origin
// stylesheet can only match that from a cascade layer: an `!important` declaration in a layer beats
// every unlayered `!important`, and the first layer declared beats the rest. The unlayered copy
// covers engines without `@layer`.
export const FREEZE_CSS = `@layer a11y-pulse-ts-freeze { ${FREEZE_RULES} }
${FREEZE_RULES}`;

export const OVERRIDE_CSS = `@layer a11y-pulse-ts-override { ${OVERRIDE_RULES} }
${OVERRIDE_RULES}`;

export const DEFAULT_OVERLAP_AREA_PX2 = 4;
export const MIN_OVERLAP_DEPTH_PX = 1;
export const MAX_TEXT_RECTS = 40;

export type OverlapInput = Pick<
	CandidateSnapshot,
	"index" | "selector" | "rect" | "fontSize" | "position" | "unstable"
> & {
	textRects?: TextSpacingRect[];
	/** The lines of text as far as the element's clipping ancestors leave them showing. */
	visibleTextRects?: TextSpacingRect[];
};

export type OverlapPair = {
	selector: string;
	overlapsWith: string;
	index: number;
	otherIndex: number;
	beforeAreaPx2: number;
	afterAreaPx2: number;
	/** The largest region the two elements' text shares once spacing is applied. */
	rect: TextSpacingRect;
};

export type BaselineConfig = {
	limit: number;
	freezeCss: string;
	overrideCss: string;
	maxTextRects: number;
};

export type BaselinePayload = { candidates: CandidateSnapshot[]; limitReached: boolean };
export type RemeasurePayload = {
	candidates: CandidateSnapshot[];
	/** Set when candidates were collected again and the candidate limit cut the collection short. */
	limitReached?: boolean;
};
export type RestorePayload = { restored: boolean };

export type ElementDescription = {
	index: number;
	selector: string;
	html: string;
	/** Border box in document coordinates, as currently laid out. */
	rect: TextSpacingRect;
	/** Computed `overflow-x` and `overflow-y` as currently styled. */
	overflowX: string;
	overflowY: string;
	/** Whether the element is styled to truncate its text with an ellipsis or a line clamp. */
	truncates: boolean;
	/** False when the element is not rendered, or is hidden by `visibility` or `opacity`. */
	visible: boolean;
};

export type DescribeRequest = { elements: number[]; clippers: number[] };

export type DescribePayload = {
	page: { width: number; height: number };
	elements: ElementDescription[];
	clippers: ElementDescription[];
};

type PageState = {
	elements: Element[];
	clippers: Element[];
	measure: () => CandidateSnapshot[];
	recollect: () => boolean;
	applyOverride: () => void;
	settle: (extraMs: number) => Promise<void>;
	restore: () => Promise<boolean>;
	removeStyles: () => void;
};

type StateWindow = Window & { __a11yPulseTextSpacing?: PageState };

function intersection(a: TextSpacingRect, b: TextSpacingRect): TextSpacingRect | null {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const width = Math.min(a.x + a.width, b.x + b.width) - x;
	const height = Math.min(a.y + a.height, b.y + b.height) - y;

	if (width <= 0 || height <= 0) {
		return null;
	}

	return { x, y, width, height };
}

export function intersectionArea(a: TextSpacingRect, b: TextSpacingRect): number {
	const shared = intersection(a, b);

	return shared ? shared.width * shared.height : 0;
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

/**
 * The largest region shared by any line of one element's text and any line of the other's. Lines
 * are compared one by one because the bounding box of wrapped inline text spans every line it
 * touches, including the parts of those lines that belong to its neighbours. A shared sliver
 * thinner than `MIN_OVERLAP_DEPTH_PX` is two lines touching, not overlapping.
 */
function largestSharedRegion(
	left: TextSpacingRect[],
	right: TextSpacingRect[],
): { area: number; rect: TextSpacingRect | null } {
	let area = 0;
	let rect: TextSpacingRect | null = null;

	for (const a of left) {
		for (const b of right) {
			const shared = intersection(a, b);

			if (
				!shared ||
				shared.width <= MIN_OVERLAP_DEPTH_PX ||
				shared.height <= MIN_OVERLAP_DEPTH_PX
			) {
				continue;
			}

			if (shared.width * shared.height > area) {
				area = shared.width * shared.height;
				rect = shared;
			}
		}
	}

	return { area, rect };
}

// Text that a clipping ancestor cuts off cannot be seen to overlap anything, so the lines are
// taken as far as they show. An element with no line boxes recorded is compared by its own box.
function linesOf(candidate: OverlapInput): TextSpacingRect[] {
	return candidate.visibleTextRects ?? candidate.textRects ?? [candidate.rect];
}

export function findOverlapPairs(
	baseline: OverlapInput[],
	after: OverlapInput[],
	overlapAreaTolerancePx2 = DEFAULT_OVERLAP_AREA_PX2,
): OverlapPair[] {
	const afterByIndex = new Map(after.map((candidate) => [candidate.index, candidate]));
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

			const before = largestSharedRegion(linesOf(left), linesOf(right));

			if (before.area > overlapAreaTolerancePx2) {
				continue;
			}

			const now = largestSharedRegion(linesOf(leftAfter), linesOf(rightAfter));

			if (now.area > overlapAreaTolerancePx2 && now.rect) {
				pairs.push({
					selector: left.selector,
					overlapsWith: right.selector,
					index: left.index,
					otherIndex: right.index,
					beforeAreaPx2: before.area,
					afterAreaPx2: now.area,
					rect: now.rect,
				});
			}
		}
	}

	return pairs;
}

/**
 * Wait on fonts, freeze motion, collect candidate text containers, and double-sample rects so
 * JS-driven movement can be marked unstable. Leaves the measuring, overriding and restoring helpers
 * on the page for the scripts that follow. Serialized and run in the page; must stay
 * self-contained.
 */
export async function collectBaselineScript(config: BaselineConfig): Promise<BaselinePayload> {
	const cap = typeof config.limit === "number" && config.limit >= 0 ? config.limit : 500;
	const maxTextRects = config.maxTextRects > 0 ? config.maxTextRects : 40;
	const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
	const win = window as StateWindow;

	type Mode = "hard" | "soft" | null;
	// One ancestor that limits what is visible of the text inside it. `hard` (hidden, clip) cuts the
	// text off; `soft` (auto, scroll) keeps it reachable by scrolling.
	type ChainNode = { index: number; x: Mode; y: Mode; next: ChainNode | null };
	type Box = { left: number; top: number; right: number; bottom: number };
	type Injected = { kind: string; root: Document | ShadowRoot; remove: () => void };

	try {
		win.__a11yPulseTextSpacing?.removeStyles();
	} catch {
		// A stale state from an interrupted run must not stop this one.
	}

	const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;

	if (fonts?.ready) {
		await fonts.ready;
	}

	const nextFrame = (): Promise<void> =>
		new Promise((resolve) => {
			const raf = globalThis.requestAnimationFrame?.bind(globalThis);
			// A page that is not being painted never runs its frame callbacks.
			const timer = setTimeout(resolve, 100);

			if (raf) {
				raf(() => {
					clearTimeout(timer);
					resolve();
				});
			}
		});

	const shadowRoots: ShadowRoot[] = [];

	const findShadowRoots = (root: Document | ShadowRoot): void => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
		let node = walker.nextNode() as Element | null;

		while (node) {
			if (node.shadowRoot) {
				shadowRoots.push(node.shadowRoot);
				findShadowRoots(node.shadowRoot);
			}

			node = walker.nextNode() as Element | null;
		}
	};

	findShadowRoots(document);

	let injected: Injected[] = [];

	const styleElement = (kind: string, css: string): HTMLStyleElement => {
		const style = document.createElement("style");
		style.setAttribute("data-a11y-pulse", kind);
		style.textContent = css;

		return style;
	};

	const injectInto = (root: Document | ShadowRoot, kind: string, css: string): void => {
		if (injected.some((entry) => entry.kind === kind && entry.root === root)) {
			return;
		}

		if (root === document) {
			if (document.querySelector(`style[data-a11y-pulse="${kind}"]`)) {
				return;
			}

			// First in the document, so that its cascade layer is the first one declared.
			const style = styleElement(kind, css);
			const parent = document.head ?? document.documentElement;
			parent.insertBefore(style, parent.firstChild);
			injected.push({ kind, root, remove: () => style.remove() });

			return;
		}

		const shadow = root as ShadowRoot;

		// A constructed stylesheet leaves the shadow tree's children alone, so `:first-child` and
		// friends keep matching what they matched before.
		try {
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(css);
			shadow.adoptedStyleSheets = [sheet, ...shadow.adoptedStyleSheets];
			injected.push({
				kind,
				root,
				remove: () => {
					shadow.adoptedStyleSheets = shadow.adoptedStyleSheets.filter((entry) => entry !== sheet);
				},
			});

			return;
		} catch {
			// No constructable stylesheets here: fall back to a style element.
		}

		const style = styleElement(kind, css);
		shadow.appendChild(style);
		injected.push({ kind, root, remove: () => style.remove() });
	};

	const inject = (kind: string, css: string): void => {
		injectInto(document, kind, css);

		for (const root of shadowRoots) {
			injectInto(root, kind, css);
		}
	};

	const removeKind = (kind: string): void => {
		for (const entry of injected) {
			if (entry.kind !== kind) {
				continue;
			}

			try {
				entry.remove();
			} catch {
				// Removal is best effort.
			}
		}

		injected = injected.filter((entry) => entry.kind !== kind);

		for (const el of Array.from(document.querySelectorAll(`style[data-a11y-pulse="${kind}"]`))) {
			el.remove();
		}
	};

	const removeStyles = (): void => {
		removeKind("ts-override");
		removeKind("ts-freeze");
	};

	const overflowOn = (cs: CSSStyleDeclaration, axis: "x" | "y"): string => {
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

	const modeOf = (overflow: string): Mode => {
		if (overflow === "hidden" || overflow === "clip") {
			return "hard";
		}

		if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") {
			return "soft";
		}

		return null;
	};

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

	const isSet = (value: string | undefined): boolean => Boolean(value) && value !== "none";

	// The ancestor whose box an out-of-flow element is laid out against. Overflow on anything
	// between the two does not clip it.
	const containingAncestor = (el: Element, position: string): Element | null => {
		let node = parentOf(el);

		while (node) {
			const cs = getComputedStyle(node);

			if (isSet(cs.transform) || isSet(cs.filter) || isSet(cs.perspective)) {
				return node;
			}

			if (position === "absolute" && cs.position !== "static" && cs.position !== "") {
				return node;
			}

			node = parentOf(node);
		}

		return null;
	};

	const clippers: Element[] = [];
	const clipperIndexes = new Map<Element, number>();

	const clipperIndex = (el: Element): number => {
		let index = clipperIndexes.get(el);

		if (index === undefined) {
			index = clippers.length;
			clippers.push(el);
			clipperIndexes.set(el, index);
		}

		return index;
	};

	const chains = new Map<Element, ChainNode | null>();

	/**
	 * Everything that limits the visibility of text directly inside `el`, innermost first, starting
	 * with `el` itself. Memoised per element, so a page's ancestors are each styled once however
	 * many candidates sit beneath them.
	 */
	const chainOf = (start: Element): ChainNode | null => {
		const pending: Array<{ el: Element; x: Mode; y: Mode }> = [];
		let node: Element | null = start;
		let tail: ChainNode | null = null;

		while (node) {
			if (chains.has(node)) {
				tail = chains.get(node) ?? null;
				break;
			}

			const cs = getComputedStyle(node);
			const boxless = cs.display === "inline" || cs.display === "contents";

			pending.push({
				el: node,
				x: boxless ? null : modeOf(overflowOn(cs, "x")),
				y: boxless ? null : modeOf(overflowOn(cs, "y")),
			});

			node =
				cs.position === "fixed" || cs.position === "absolute"
					? containingAncestor(node, cs.position)
					: parentOf(node);
		}

		for (let i = pending.length - 1; i >= 0; i--) {
			const entry = pending[i];

			if (!entry) {
				continue;
			}

			if (entry.x || entry.y) {
				tail = { index: clipperIndex(entry.el), x: entry.x, y: entry.y, next: tail };
			}

			chains.set(entry.el, tail);
		}

		return tail;
	};

	const truncating = new Map<Element, boolean>();

	const isTruncating = (el: Element): boolean => {
		const known = truncating.get(el);

		if (known !== undefined) {
			return known;
		}

		const cs = getComputedStyle(el);
		const overflowX = Math.max(0, el.scrollWidth - el.clientWidth);
		const overflowY = Math.max(0, el.scrollHeight - el.clientHeight);
		const clamp = cs.getPropertyValue("-webkit-line-clamp") || cs.getPropertyValue("line-clamp");
		const result =
			(cs.textOverflow === "ellipsis" && overflowX > 0) ||
			(clamp !== "" && clamp !== "none" && (overflowY > 0 || overflowX > 0));

		truncating.set(el, result);

		return result;
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

	const elements: Element[] = [];
	const collected = new Set<Element>();
	let limitReached = false;

	const walk = (root: Document | ShadowRoot): void => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
		let node = walker.nextNode() as Element | null;

		while (node && !limitReached) {
			if (!collected.has(node) && isCandidate(node)) {
				if (elements.length >= cap) {
					limitReached = true;
					break;
				}

				elements.push(node);
				collected.add(node);
			}

			if (node.shadowRoot) {
				walk(node.shadowRoot);
			}

			node = walker.nextNode() as Element | null;
		}
	};

	const readRect = (el: Element): TextSpacingRect => {
		const box = el.getBoundingClientRect();

		return {
			x: box.x + (window.scrollX || 0),
			y: box.y + (window.scrollY || 0),
			width: box.width,
			height: box.height,
		};
	};

	const rectsDiffer = (a: TextSpacingRect, b: TextSpacingRect): boolean =>
		Math.abs(a.x - b.x) > 1 ||
		Math.abs(a.y - b.y) > 1 ||
		Math.abs(a.width - b.width) > 1 ||
		Math.abs(a.height - b.height) > 1;

	// What does not change when spacing is applied, read once at baseline.
	type Fixed = {
		chain: ChainNode | null;
		nearestClipper: Element;
		truncator: Element | null;
		truncatorIndex: number | null;
		overflowX: string;
		overflowY: string;
		clipOverflowX: string;
		clipOverflowY: string;
		fontSize: number;
		position: string;
		unstable: boolean;
	};

	const fixed: Fixed[] = [];

	const describeFixed = (el: Element, unstable: boolean): Fixed => {
		const cs = getComputedStyle(el);
		const chain = chainOf(el);
		let nearestClipper: Element = el;
		let truncator: Element | null = null;
		let foundClipper = false;

		for (let node = chain; node; node = node.next) {
			if (node.x !== "hard" && node.y !== "hard") {
				continue;
			}

			const clipper = clippers[node.index];

			if (!clipper) {
				continue;
			}

			if (!foundClipper) {
				nearestClipper = clipper;
				foundClipper = true;
			}

			if (isTruncating(clipper)) {
				truncator = clipper;
				break;
			}
		}

		const clipCs = nearestClipper === el ? cs : getComputedStyle(nearestClipper);
		const fontSize = Number.parseFloat(cs.fontSize);

		return {
			chain,
			nearestClipper,
			truncator,
			truncatorIndex: truncator ? clipperIndex(truncator) : null,
			overflowX: overflowOn(cs, "x"),
			overflowY: overflowOn(cs, "y"),
			clipOverflowX: overflowOn(clipCs, "x"),
			clipOverflowY: overflowOn(clipCs, "y"),
			fontSize: Number.isFinite(fontSize) ? fontSize : 16,
			position: cs.position,
			unstable,
		};
	};

	const scrollOverflow = (el: Element): number =>
		Math.max(0, el.scrollWidth - el.clientWidth, el.scrollHeight - el.clientHeight);

	/**
	 * Measure every candidate as currently laid out. Reads only: all style lookups happened at
	 * baseline, so a pass costs one layout however many candidates there are.
	 */
	const measure = (): CandidateSnapshot[] => {
		const offsetX = window.scrollX || 0;
		const offsetY = window.scrollY || 0;
		const boxes: Array<Box | undefined> = [];
		const range = document.createRange();
		const canMeasureText = typeof range.getClientRects === "function";

		// The padding box, which is where overflow is cut off.
		const boxOf = (index: number): Box | null => {
			const known = boxes[index];

			if (known) {
				return known;
			}

			const el = clippers[index];

			if (!el) {
				return null;
			}

			// `clientWidth` and friends are layout sizes, while the rect is the box as drawn. Under a
			// scaling transform the two differ, and the padding box has to be scaled to match.
			const rect = el.getBoundingClientRect();
			const layout = el as Element & { offsetWidth?: number; offsetHeight?: number };
			const layoutWidth = layout.offsetWidth ?? 0;
			const layoutHeight = layout.offsetHeight ?? 0;
			const scaleX =
				layoutWidth > 0 && Math.abs(rect.width - layoutWidth) >= 1 ? rect.width / layoutWidth : 1;
			const scaleY =
				layoutHeight > 0 && Math.abs(rect.height - layoutHeight) >= 1
					? rect.height / layoutHeight
					: 1;
			const left = rect.left + el.clientLeft * scaleX + offsetX;
			const top = rect.top + el.clientTop * scaleY + offsetY;
			const box = {
				left,
				top,
				right: left + el.clientWidth * scaleX,
				bottom: top + el.clientHeight * scaleY,
			};
			boxes[index] = box;

			return box;
		};

		// How far text spanning `min`..`max` on one axis is cut off, and by which ancestor. A
		// scrolling ancestor cuts nothing off, but text scrolled out of it is not there for anything
		// further out to clip.
		const clippedOn = (
			chain: ChainNode | null,
			axis: "x" | "y",
			min: number,
			max: number,
		): { px: number; by: number | null } => {
			let softMin = Number.NEGATIVE_INFINITY;
			let softMax = Number.POSITIVE_INFINITY;
			let px = 0;
			let by: number | null = null;
			let nearest: number | null = null;

			for (let node = chain; node; node = node.next) {
				const mode = axis === "x" ? node.x : node.y;

				if (!mode) {
					continue;
				}

				const box = boxOf(node.index);

				if (!box) {
					continue;
				}

				const start = axis === "x" ? box.left : box.top;
				const end = axis === "x" ? box.right : box.bottom;

				if (mode === "soft") {
					softMin = Math.max(softMin, start);
					softMax = Math.min(softMax, end);
					continue;
				}

				nearest ??= node.index;

				const over = Math.max(Math.min(max, softMax) - end, start - Math.max(min, softMin));

				if (over > px) {
					px = over;
					by = node.index;
				}
			}

			return { px, by: by ?? nearest };
		};

		// The region every clipping and scrolling ancestor leaves showing.
		const showingThrough = (chain: ChainNode | null): Box => {
			const showing = {
				left: Number.NEGATIVE_INFINITY,
				top: Number.NEGATIVE_INFINITY,
				right: Number.POSITIVE_INFINITY,
				bottom: Number.POSITIVE_INFINITY,
			};

			for (let node = chain; node; node = node.next) {
				const box = boxOf(node.index);

				if (!box) {
					continue;
				}

				if (node.x) {
					showing.left = Math.max(showing.left, box.left);
					showing.right = Math.min(showing.right, box.right);
				}

				if (node.y) {
					showing.top = Math.max(showing.top, box.top);
					showing.bottom = Math.min(showing.bottom, box.bottom);
				}
			}

			return showing;
		};

		return elements.map((el, index) => {
			const info = fixed[index] as Fixed;
			const textRects: TextSpacingRect[] = [];
			const visibleTextRects: TextSpacingRect[] = [];
			const showing = showingThrough(info.chain);
			let minX = Number.POSITIVE_INFINITY;
			let minY = Number.POSITIVE_INFINITY;
			let maxX = Number.NEGATIVE_INFINITY;
			let maxY = Number.NEGATIVE_INFINITY;

			if (canMeasureText) {
				for (const child of Array.from(el.childNodes)) {
					if (child.nodeType !== 3 || (child.textContent ?? "").trim() === "") {
						continue;
					}

					range.selectNodeContents(child);

					for (const line of Array.from(range.getClientRects())) {
						if (line.width <= 0 || line.height <= 0) {
							continue;
						}

						const x = line.left + offsetX;
						const y = line.top + offsetY;
						minX = Math.min(minX, x);
						minY = Math.min(minY, y);
						maxX = Math.max(maxX, x + line.width);
						maxY = Math.max(maxY, y + line.height);

						if (textRects.length < maxTextRects) {
							textRects.push({ x, y, width: line.width, height: line.height });

							const left = Math.max(x, showing.left);
							const top = Math.max(y, showing.top);
							const width = Math.min(x + line.width, showing.right) - left;
							const height = Math.min(y + line.height, showing.bottom) - top;

							if (width > 0 && height > 0) {
								visibleTextRects.push({ x: left, y: top, width, height });
							}
						}
					}
				}
			}

			const hasText = maxX > minX && maxY > minY;
			const clippedX = hasText ? clippedOn(info.chain, "x", minX, maxX) : { px: 0, by: null };
			const clippedY = hasText ? clippedOn(info.chain, "y", minY, maxY) : { px: 0, by: null };
			const clipEl = info.nearestClipper;

			return {
				index,
				selector: "",
				html: "",
				scrollWidth: el.scrollWidth,
				scrollHeight: el.scrollHeight,
				clientWidth: el.clientWidth,
				clientHeight: el.clientHeight,
				rect: readRect(el),
				overflowX: info.overflowX,
				overflowY: info.overflowY,
				clipScrollWidth: clipEl.scrollWidth,
				clipScrollHeight: clipEl.scrollHeight,
				clipClientWidth: clipEl.clientWidth,
				clipClientHeight: clipEl.clientHeight,
				clipOverflowX: info.clipOverflowX,
				clipOverflowY: info.clipOverflowY,
				truncated: info.truncator !== null,
				unstable: info.unstable,
				fontSize: info.fontSize,
				position: info.position,
				textRects,
				visibleTextRects,
				clippedXPx: clippedX.px,
				clippedYPx: clippedY.px,
				clipperXIndex: clippedX.by,
				clipperYIndex: clippedY.by,
				truncatorIndex: info.truncatorIndex,
				truncationOverflowPx: info.truncator ? scrollOverflow(info.truncator) : 0,
			};
		});
	};

	const fingerprint = (): string => {
		const root = document.documentElement;
		const last = elements[elements.length - 1];
		const box = last ? last.getBoundingClientRect() : null;

		return `${root.scrollWidth}x${root.scrollHeight}:${box ? `${box.x},${box.y},${box.width},${box.height}` : ""}`;
	};

	// Motion is frozen and layout is synchronous, so a style change has landed by the next frame.
	// Scripts that react to the new layout (resize observers) get a few more frames to finish.
	const settle = async (extraMs: number): Promise<void> => {
		await nextFrame();
		await nextFrame();

		let previous = fingerprint();

		for (let i = 0; i < 6; i++) {
			await nextFrame();

			const next = fingerprint();

			if (next === previous) {
				break;
			}

			previous = next;
		}

		if (extraMs > 0) {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, extraMs);
			});
		}
	};

	let baseline: CandidateSnapshot[] = [];

	const restore = async (): Promise<boolean> => {
		// The override goes while motion is still frozen, and the layout it leaves behind is
		// computed before the freeze is lifted. Otherwise a page with `transition: all` would
		// animate its way back and still be moving when it is checked.
		removeKind("ts-override");
		void document.documentElement.offsetHeight;

		for (const el of elements.slice(0, 20)) {
			void getComputedStyle(el).lineHeight;
		}

		removeKind("ts-freeze");
		await nextFrame();
		await nextFrame();

		let restored = true;
		let checked = 0;

		for (let i = 0; i < elements.length && checked < 20; i++) {
			const el = elements[i];
			const snapshot = baseline[i];

			if (!el || !snapshot || snapshot.unstable) {
				continue;
			}

			checked++;

			const box = readRect(el);

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

		return restored;
	};

	/**
	 * Collect again under the current layout, for a caller that has changed which styles apply (a
	 * viewport resize crossing a media query). Elements keep their indexes, text that is rendered
	 * only now is added after them, and what clips or truncates each one is read afresh. Returns
	 * whether the candidate limit cut the collection short.
	 */
	const recollect = (): boolean => {
		chains.clear();
		truncating.clear();
		walk(document);

		elements.forEach((el, index) => {
			fixed[index] = describeFixed(el, fixed[index]?.unstable ?? false);
		});

		return limitReached;
	};

	// Published before anything is injected, so a failure part-way through can still be undone.
	win.__a11yPulseTextSpacing = {
		elements,
		clippers,
		measure,
		recollect,
		applyOverride: () => inject("ts-override", config.overrideCss),
		settle,
		restore,
		removeStyles,
	};

	inject("ts-freeze", config.freezeCss);
	walk(document);

	const firstRects = elements.map(readRect);

	await nextFrame();

	elements.forEach((el, index) => {
		const first = firstRects[index];

		fixed[index] = describeFixed(el, first ? rectsDiffer(first, readRect(el)) : false);
	});

	baseline = measure();

	return { candidates: baseline, limitReached };
}

/**
 * Apply the WCAG 1.4.12 spacing overrides, wait for the layout to stop changing, and re-measure the
 * candidates collected at baseline. Serialized; self-contained.
 */
export async function applyOverrideScript(settleMs: number): Promise<RemeasurePayload> {
	const state = (window as Window & { __a11yPulseTextSpacing?: PageState }).__a11yPulseTextSpacing;

	if (!state) {
		return { candidates: [] };
	}

	state.applyOverride();
	await state.settle(typeof settleMs === "number" ? settleMs : 0);

	return { candidates: state.measure() };
}

/**
 * Wait for the layout to stop changing and re-measure the candidates collected at baseline, without
 * applying the spacing overrides. For callers that change the page some other way (a viewport
 * resize) between the baseline and this.
 *
 * With `recollect`, the candidates are collected again first: text that is only rendered now is
 * measured too, with indexes after the baseline's, and every candidate's clipping and truncating
 * ancestors are read from the styles that apply now. Serialized; self-contained.
 */
export async function remeasureScript(
	settleMs: number,
	recollect = false,
): Promise<RemeasurePayload> {
	const state = (window as Window & { __a11yPulseTextSpacing?: PageState }).__a11yPulseTextSpacing;

	if (!state) {
		return { candidates: [] };
	}

	await state.settle(typeof settleMs === "number" ? settleMs : 0);

	if (recollect === true) {
		const limitReached = state.recollect();

		return { candidates: state.measure(), limitReached };
	}

	return { candidates: state.measure() };
}

/**
 * Selector, markup and current box for the elements behind the findings, plus the page size.
 * Only findings need these, and a selector costs several document-wide queries, so they are looked
 * up here and not for every candidate. Serialized; self-contained.
 */
export function describeFindingsScript(request: DescribeRequest): DescribePayload {
	const state = (window as Window & { __a11yPulseTextSpacing?: PageState }).__a11yPulseTextSpacing;
	const page = {
		width: document.documentElement.scrollWidth,
		height: document.documentElement.scrollHeight,
	};

	if (!state) {
		return { page, elements: [], clippers: [] };
	}

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

	const overflowParts = (cs: CSSStyleDeclaration): string[] =>
		cs.overflow.split(/\s+/).filter(Boolean);

	const describe = (pool: Element[], indexes: number[]): ElementDescription[] => {
		const described: ElementDescription[] = [];

		for (const index of indexes) {
			const el = pool[index];

			if (!el) {
				continue;
			}

			const box = el.getBoundingClientRect();
			const cs = getComputedStyle(el);
			const clamp = cs.getPropertyValue("-webkit-line-clamp") || cs.getPropertyValue("line-clamp");
			const check = (
				el as Element & { checkVisibility?: (options?: Record<string, boolean>) => boolean }
			).checkVisibility;

			described.push({
				index,
				selector: getSelector(el),
				html: (el.cloneNode(false) as Element).outerHTML,
				rect: {
					x: box.x + (window.scrollX || 0),
					y: box.y + (window.scrollY || 0),
					width: box.width,
					height: box.height,
				},
				overflowX: cs.overflowX || overflowParts(cs)[0] || "visible",
				overflowY: cs.overflowY || overflowParts(cs)[1] || overflowParts(cs)[0] || "visible",
				truncates: cs.textOverflow === "ellipsis" || (clamp !== "" && clamp !== "none"),
				visible:
					typeof check === "function"
						? check.call(el, { checkOpacity: true, checkVisibilityCSS: true })
						: cs.display !== "none" && cs.visibility !== "hidden",
			});
		}

		return described;
	};

	return {
		page,
		elements: describe(state.elements, request.elements),
		clippers: describe(state.clippers, request.clippers),
	};
}

/**
 * Remove injected styles and spot-check that a sample of rects match baseline. Never throws.
 * Serialized; self-contained.
 */
export async function restoreAndVerifyScript(): Promise<RestorePayload> {
	const win = window as Window & { __a11yPulseTextSpacing?: PageState };
	const state = win.__a11yPulseTextSpacing;

	const removeLeftovers = (): void => {
		try {
			state?.removeStyles();
		} catch {
			// Removal is best effort: this function must not throw.
		}

		try {
			for (const el of Array.from(
				document.querySelectorAll('[data-a11y-pulse="ts-freeze"], [data-a11y-pulse="ts-override"]'),
			)) {
				el.remove();
			}
		} catch {
			// As above.
		}
	};

	try {
		const restored = state ? await state.restore() : true;
		removeLeftovers();
		delete win.__a11yPulseTextSpacing;

		return { restored };
	} catch {
		removeLeftovers();

		try {
			delete win.__a11yPulseTextSpacing;
		} catch {
			// As above.
		}

		return { restored: false };
	}
}
