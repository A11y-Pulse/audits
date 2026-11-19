/**
 * The page scripts an unfocused pair is captured with.
 *
 * IMPORTANT: every function below is serialised and injected into the audited page, so it must not
 * reference any symbol outside its own scope. Composed bodies reach their parts only through `ctx`.
 */

import type { ElementRef, Rect } from "@a11y-pulse/browser-adaptor";
import {
	blurScript,
	elementStylesScript,
	focusScript,
	isCenterObscuredScript,
	needsCentringScript,
	type PairContextPayload,
	pageDimensionsScript,
	pairContextScript,
	scrollToCenterScript,
} from "./browser-scripts";
import { composeScript } from "./compose-script";
import type { PairClipTarget, StyleSnapshot } from "./types";

type PairWindow = Window & {
	__a11yPulsePair?: {
		target: Element;
		/** A second element the screenshots take in along with the target. */
		extra?: Element;
		caret?: { root: Document | ShadowRoot; sheet: CSSStyleSheet };
	};
};

export type PairTarget = {
	/** The focused element itself draws nothing: fully transparent, clipped to a pixel, or off the page. */
	unpainted: boolean;
	/** What the screenshots are taken of. */
	clipTarget: PairClipTarget;
	/** The element shows a text caret while focused. */
	caret: boolean;
};

/**
 * Decide what a pair's screenshots should show, and remember it for the rest of the capture. An
 * element that draws nothing itself (the real `<input>` of a custom checkbox or switch) shows its
 * focus on something else, so the screenshots cover its label, or failing that its nearest visible
 * ancestor.
 */
export function pairTargetScript(el: Element | null): PairTarget {
	if (!el) {
		return { unpainted: false, clipTarget: "element", caret: false };
	}

	const parentOf = (node: Element): Element | null =>
		node.parentElement ?? ((node.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;

	const opacityOf = (node: Element): number => {
		let opacity = 1;

		for (let current: Element | null = node; current && opacity > 0; current = parentOf(current)) {
			const value = Number.parseFloat(getComputedStyle(current).opacity);

			if (!Number.isNaN(value)) {
				opacity *= value;
			}
		}

		return opacity;
	};

	const hasBox = (node: Element): boolean => {
		const rect = node.getBoundingClientRect();

		return (
			rect.width > 1 &&
			rect.height > 1 &&
			rect.right + window.scrollX > 0 &&
			rect.bottom + window.scrollY > 0
		);
	};

	const painted = (node: Element): boolean =>
		hasBox(node) && getComputedStyle(node).visibility !== "hidden" && opacityOf(node) > 0;

	const unpainted = !hasBox(el) || opacityOf(el) === 0;
	let target: Element = el;
	let extra: Element | undefined;
	let clipTarget: PairClipTarget = "element";

	if (unpainted) {
		const labels = Array.from((el as HTMLInputElement).labels ?? []) as Element[];
		const label = labels.find(painted);
		let visibleAncestor: Element | undefined;

		for (
			let ancestor = parentOf(el);
			ancestor && ancestor !== document.body && ancestor !== document.documentElement;
			ancestor = parentOf(ancestor)
		) {
			if (painted(ancestor)) {
				visibleAncestor = ancestor;
				break;
			}
		}

		if (label) {
			target = label;
			clipTarget = "label";

			// The indicator of a hidden input is as often drawn on a sibling of the input (the box of a
			// custom checkbox, the track of a switch) as on its label, which may sit somewhere else in
			// the row. Take in the input's surroundings as well, unless they are a whole page region.
			const MAX_EXTRA_AREA = 250_000;

			if (visibleAncestor && !label.contains(visibleAncestor)) {
				const box = visibleAncestor.getBoundingClientRect();

				if (box.width * box.height <= MAX_EXTRA_AREA) {
					extra = visibleAncestor;
				}
			}
		} else if (visibleAncestor) {
			target = visibleAncestor;
			clipTarget = "parent";
		}
	}

	let caret = false;

	if (!unpainted) {
		const tag = el.tagName;
		const type = (el.getAttribute("type") ?? "text").toLowerCase();
		const textTypes = ["text", "search", "url", "tel", "email", "password", "number"];
		const editable =
			(el as HTMLElement).isContentEditable ||
			((tag === "TEXTAREA" || (tag === "INPUT" && textTypes.includes(type))) &&
				!(el as HTMLInputElement).readOnly);

		if (editable) {
			const color = getComputedStyle(el).caretColor.replace(/\s+/g, "");

			caret = color !== "transparent" && !/^rgba\(.*,0\)$/.test(color) && !/\/0\)$/.test(color);
		}
	}

	(window as PairWindow).__a11yPulsePair = extra ? { target, extra } : { target };

	return { unpainted, clipTarget, caret };
}

/** The element `pairTargetScript` chose. */
export function pairTargetHandleScript(): Element | null {
	return (window as PairWindow).__a11yPulsePair?.target ?? null;
}

/**
 * The page-relative box the screenshots cover: the target `pairTargetScript` chose, widened to take
 * in the second element it noted, if any.
 */
export function pairRectScript(): Rect {
	const state = (window as PairWindow).__a11yPulsePair;

	if (!state) {
		return { x: 0, y: 0, width: 0, height: 0 };
	}

	const boxes = [state.target, state.extra]
		.filter((node): node is Element => node?.isConnected === true)
		.map((node) => node.getBoundingClientRect())
		.filter((box) => box.width > 0 && box.height > 0);

	if (boxes.length === 0) {
		const box = state.target.getBoundingClientRect();

		return {
			x: box.left + window.scrollX,
			y: box.top + window.scrollY,
			width: box.width,
			height: box.height,
		};
	}

	const left = Math.min(...boxes.map((box) => box.left));
	const top = Math.min(...boxes.map((box) => box.top));
	const right = Math.max(...boxes.map((box) => box.right));
	const bottom = Math.max(...boxes.map((box) => box.bottom));

	return {
		x: left + window.scrollX,
		y: top + window.scrollY,
		width: right - left,
		height: bottom - top,
	};
}

/**
 * Stop the text caret being drawn around `el`, so a blinking caret can neither pass for a focus
 * indicator nor differ between engines (some hide it in screenshots, some do not). Done with an
 * adopted stylesheet so the page's own DOM is left alone.
 */
export function hideCaretScript(el: Element | null): void {
	const state = (window as PairWindow).__a11yPulsePair;

	if (!el || !state || state.caret) {
		return;
	}

	try {
		const root = el.getRootNode() as Document | ShadowRoot;
		const sheet = new CSSStyleSheet();

		sheet.replaceSync("* { caret-color: transparent !important; }");
		root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
		state.caret = { root, sheet };
	} catch {
		// No constructable stylesheets here: the caret stays, as it always did.
	}
}

/** Undo `hideCaretScript` and forget the pair's target. */
export function endPairScript(): void {
	const win = window as PairWindow;
	const caret = win.__a11yPulsePair?.caret;

	if (caret) {
		try {
			caret.root.adoptedStyleSheets = caret.root.adoptedStyleSheets.filter(
				(sheet) => sheet !== caret.sheet,
			);
		} catch {}
	}

	delete win.__a11yPulsePair;
}

/**
 * Wait for CSS transitions on an element, its labels and its nearest ancestors to finish, for at
 * most `maxMs`. A focus style that fades in (or back out after blur) is only part-way there when
 * focus has just moved, and two screenshots taken part-way through can look alike.
 */
export function transitionsSettledScript(el: Element | null, maxMs: number): Promise<void> {
	if (!el || typeof el.getAnimations !== "function" || typeof CSSTransition !== "function") {
		return Promise.resolve();
	}

	const state = (window as PairWindow).__a11yPulsePair;
	const parent = el.parentElement;
	const around = [
		el,
		state?.target,
		state?.extra,
		...Array.from((el as HTMLInputElement).labels ?? []),
		parent,
		parent?.parentElement,
		parent?.parentElement?.parentElement,
	];
	const running: Animation[] = [];

	for (const node of around) {
		if (!node || node === document.body || node === document.documentElement) {
			continue;
		}

		for (const animation of node.getAnimations({ subtree: node === el })) {
			if (animation instanceof CSSTransition && animation.playState === "running") {
				running.push(animation);
			}
		}
	}

	if (running.length === 0) {
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		// The page's own setTimeout may be faked or wrapped; use the original when the session kept it.
		const timers = (window as Window & { __a11yPulseTimers?: { original: typeof setTimeout } })
			.__a11yPulseTimers;

		(timers?.original ?? window.setTimeout).call(window, () => resolve(), maxMs);

		// A cancelled transition rejects `finished`; either way it is no longer in the way.
		Promise.all(running.map((animation) => animation.finished.catch(() => undefined))).then(() =>
			resolve(),
		);
	});
}

/** How long a transition is given to finish before the screenshots are taken regardless. */
export const PAIR_TRANSITION_WAIT_MS = 500;

export type PairFocusedArgs = {
	buffer: number;
	/** How long a centring scroll is given to settle. */
	settleMs: number;
	/** How long running transitions are given to finish. */
	transitionMs: number;
	styleProps: string[];
	ancestorLimit: number;
};

export type PairFocused = PairTarget & {
	page: { width: number; height: number };
	rect: Rect;
	/** Something unrelated still covers the clip target after it was centred. */
	obstructed: boolean;
	context: PairContextPayload;
};

/** Everything a pair needs from the page while the element still has focus. */
export const pairFocusedScript = composeScript(
	{
		pairTarget: pairTargetScript,
		pairTargetHandle: pairTargetHandleScript,
		needsCentring: needsCentringScript,
		scrollToCenter: scrollToCenterScript,
		isCenterObscured: isCenterObscuredScript,
		pageDimensions: pageDimensionsScript,
		transitionsSettled: transitionsSettledScript,
		pairRect: pairRectScript,
		pairContext: pairContextScript,
		hideCaret: hideCaretScript,
	},
	async (ctx, a: PairFocusedArgs, el: ElementRef): Promise<PairFocused> => {
		const chosen = await ctx.call("pairTarget", el);
		const target = await ctx.handle("pairTargetHandle");

		try {
			// Tab scrolls an element just barely into view at the viewport edge, which is exactly where
			// fixed overlays (cookie banners, sticky footers) sit. If something covers the element there,
			// both screenshots would show the overlay and no indicator could ever be detected. The clip's
			// padding also hangs past the edge there, and a screenshot only captures what is inside the
			// viewport, so an indicator drawn in that padding would be lost. Centre the target in the
			// viewport first in either case, then give the scroll a moment to settle.
			if (await ctx.call("needsCentring", target, a.buffer)) {
				await ctx.call("scrollToCenter", target, a.buffer);
				await ctx.sleep(a.settleMs);
			}

			await ctx.call("transitionsSettled", el, a.transitionMs);

			const obstructed = await ctx.call("isCenterObscured", target);
			const page = await ctx.call("pageDimensions");
			const rect = await ctx.call("pairRect");
			const context = await ctx.call("pairContext", el, a.styleProps, a.ancestorLimit);

			if (chosen.caret) {
				await ctx.call("hideCaret", el);
			}

			return { ...chosen, page, rect, obstructed, context };
		} finally {
			await ctx.release(target);
		}
	},
);

export type PairBlurred = {
	rect: Rect;
	context: PairContextPayload;
};

/** Blur an element, then say where its clip target is and what surrounds it now. */
export const pairBlurredScript = composeScript(
	{
		blur: blurScript,
		transitionsSettled: transitionsSettledScript,
		pairRect: pairRectScript,
		pairContext: pairContextScript,
	},
	async (
		ctx,
		a: { styleProps: string[]; ancestorLimit: number; transitionMs: number },
		el: ElementRef,
	): Promise<PairBlurred> => {
		await ctx.call("blur", el);
		await ctx.call("transitionsSettled", el, a.transitionMs);

		const rect = await ctx.call("pairRect");
		const context = await ctx.call("pairContext", el, a.styleProps, a.ancestorLimit);

		return { rect, context };
	},
);

/** Read an unfocused element's styles, put the page back as it was, then give it focus back. */
export const pairRestoreScript = composeScript(
	{
		elementStyles: elementStylesScript,
		endPair: endPairScript,
		focus: focusScript,
	},
	async (ctx, a: { styleProps: string[] }, el: ElementRef): Promise<StyleSnapshot> => {
		const styles = await ctx.call("elementStyles", el, a.styleProps);

		await ctx.call("endPair");
		await ctx.call("focus", el);

		return styles;
	},
);
