/**
 * The page scripts a tab session runs together, composed so that each group costs one round trip
 * to the browser instead of one per script.
 *
 * IMPORTANT: every body below is serialised and injected into the audited page, so it must not
 * reference any symbol outside its own scope. It reaches its parts only through `ctx`.
 */

import type { ElementRef, Rect } from "@a11y-pulse/browser-adaptor";
import { getSelector } from "@a11y-pulse/browser-adaptor/dom";
import {
	type ActiveElementBase,
	activeElementHandleScript,
	attributedHandleScript,
	awaitAutofocusScript,
	awaitOwnedTimersScript,
	type BaselinePayload,
	type BlurredStop,
	baselineScript,
	blurActiveElementScript,
	blurredStopScript,
	clearMarkersScript,
	clearObscurerScript,
	type DrainContextObserverResult,
	documentReplacedScript,
	drainContextObserverScript,
	elementRectScript,
	type HeldFocus,
	hasFocusScript,
	heldFocusScript,
	installContextObserverScript,
	installTabObserverScript,
	leavingScript,
	locationHrefScript,
	type MeasureObscuringResult,
	markActiveElementScript,
	measureObscuringScript,
	needsCentringScript,
	obscurerHandleScript,
	pageDimensionsScript,
	probeActiveElementScript,
	removeTabObserverScript,
	resetFocusStartScript,
	scrollToCenterScript,
	settleScript,
	stayedScript,
	submittedFormHandleScript,
	uninstallContextObserverScript,
} from "./browser-scripts";
import { composeScript, type ScriptContext, type ScriptParts } from "./compose-script";
import { forgetStopElementScript, rememberStopElementScript } from "./stop-element";

/** What a composed script answers with, which nothing else evaluated in a page would. */
export const COMPOSED_SENTINEL = "a11y-pulse-composed";

export type SessionStartArgs = {
	sentinel: string;
	styleProps: string[];
	markerAttr: string;
	markerLimit: number;
	wantContext: boolean;
};

export type SessionStartResult = {
	sentinel: string;
	payload: BaselinePayload;
	/** `location.href` as the context observer was installed, or `null` without one. */
	href: string | null;
};

export const sessionStartScript = composeScript(
	{
		awaitAutofocus: awaitAutofocusScript,
		blurActiveElement: blurActiveElementScript,
		baseline: baselineScript,
		installTabObserver: installTabObserverScript,
		resetFocusStart: resetFocusStartScript,
		locationHref: locationHrefScript,
		installContextObserver: installContextObserverScript,
	},
	async (ctx, a: SessionStartArgs): Promise<SessionStartResult> => {
		// An autofocus the browser has yet to apply would otherwise land after the reset below.
		await ctx.call("awaitAutofocus");
		// So that an autofocused field is measured unfocused like the rest.
		await ctx.call("blurActiveElement");

		const payload = await ctx.call("baseline", a.styleProps, a.markerAttr, a.markerLimit);

		await ctx.call("installTabObserver");
		// After the baseline, which should not see the node this may leave in the page, and before
		// the context observer, which should not see that node take focus.
		await ctx.call("resetFocusStart");

		let href: string | null = null;

		if (a.wantContext) {
			href = await ctx.call("locationHref");
			await ctx.call("installContextObserver");
		}

		return { sentinel: a.sentinel, payload, href };
	},
);

export type SessionEndArgs = {
	markerAttr: string;
	wantContext: boolean;
};

export const sessionEndScript = composeScript(
	{
		uninstallContextObserver: uninstallContextObserverScript,
		clearMarkers: clearMarkersScript,
		removeTabObserver: removeTabObserverScript,
		resetFocusStart: resetFocusStartScript,
		forgetStopElement: forgetStopElementScript,
	},
	async (ctx, a: SessionEndArgs): Promise<void> => {
		// Only a composed stop script leaves an element behind for the host to ask for.
		if (ctx.host === null) {
			try {
				await ctx.call("forgetStopElement");
			} catch {}
		}

		// Each step is isolated so one throwing cannot skip the others.
		if (a.wantContext) {
			try {
				await ctx.call("uninstallContextObserver");
			} catch {}
		}

		try {
			await ctx.call("clearMarkers", a.markerAttr);
		} catch {}

		try {
			await ctx.call("removeTabObserver");
		} catch {}

		// Leave the next audit on this page a tab order that starts at the top again.
		try {
			await ctx.call("resetFocusStart");
		} catch {}
	},
);

export type FinalContextArgs = {
	markerAttr: string;
	/** Longest to wait for timers that belong to an element and have yet to come due. */
	maxWaitMs: number;
};

/**
 * The last reading of the context observer, taken as the session ends: once the short timers that
 * belong to the elements the session visited have run, everything it still holds.
 */
export const finalContextScript = composeScript(
	{
		awaitOwnedTimers: awaitOwnedTimersScript,
		drain: drainContextObserverScript,
	},
	async (ctx, a: FinalContextArgs): Promise<DrainContextObserverResult | null> => {
		await ctx.call("awaitOwnedTimers", a.maxWaitMs);

		return (await ctx.call("drain", a.markerAttr, true)) ?? null;
	},
);

export type TabStopArgs = {
	/** Longest the page is given to take in the Tab press. Only spent inside the page. */
	settleMs: number;
	/** A second run for the same press, after the host re-asserted focus reporting. */
	resumed: boolean;
	styleProps: string[];
	markerAttr: string;
	/** The marker an element without one is given. */
	nextMarker: number;
	previousIndex: number | null;
	wantContext: boolean;
	baselineHref: string | null;
	wantObscuring: boolean;
	obscurerAttr: string;
	obscuringRecheckDelayMs: number;
	tabbableSelector: string;
	/** How long a document that has started to leave is given to be replaced before it counts as staying. */
	leavingLimitMs: number;
	leavingIntervalMs: number;
};

export type TabStopObscuring = MeasureObscuringResult & { obscurerSelector: string | null };

export type TabStopResult =
	/** The page stopped reporting focus and only the host can re-assert it. Page side only. */
	| { kind: "needsFocus" }
	| { kind: "lostFocus" }
	| { kind: "navigation" }
	| {
			kind: "body";
			blurredStop: BlurredStop | null;
			raw: DrainContextObserverResult | null;
			/** Selector of the form `raw` says was submitted, when there is one. */
			formSelector: string | null;
			baselineHref: string | null;
	  }
	| { kind: "iframe"; html: string; baselineHref: string | null }
	| { kind: "held"; index: number; held: HeldFocus; baselineHref: string | null }
	/** The element was stopped on before. Host side only; in the page it comes back as a stop. */
	| { kind: "revisit"; index: number; baselineHref: string | null }
	| {
			kind: "stop";
			base: ActiveElementBase;
			index: number;
			selector: string;
			raw: DrainContextObserverResult | null;
			/** The page navigated away as the context observer was being read. */
			drainDestroyed: boolean;
			/** Selector of the element `raw` says took focus and gave it away, when there is one. */
			attributedSelector: string | null;
			/** Selector of the form `raw` says was submitted, when there is one. */
			formSelector: string | null;
			obscuring: TabStopObscuring | null;
			baselineHref: string | null;
			/** The focused element. Host side only: a page cannot hand an element back. */
			ref: ElementRef | null;
	  };

export type TabStopHost = {
	/** Re-assert focus reporting, which another target taking the foreground clears. */
	reassertFocus(): Promise<void>;
	visited(index: number): boolean;
};

/**
 * Everything read after one Tab press: whether the page still has focus, what is focused, whether
 * the document was replaced, and, for an element that counts as a new stop, its selector, the
 * context observer's signals and how much of it is covered.
 */
export const tabStopScript = composeScript(
	{
		settle: settleScript,
		hasFocus: hasFocusScript,
		probe: probeActiveElementScript,
		locationHref: locationHrefScript,
		drain: drainContextObserverScript,
		documentReplaced: documentReplacedScript,
		leaving: leavingScript,
		stayed: stayedScript,
		blurredStop: blurredStopScript,
		mark: markActiveElementScript,
		heldFocus: heldFocusScript,
		activeHandle: activeElementHandleScript,
		getSelector,
		attributedHandle: attributedHandleScript,
		submittedFormHandle: submittedFormHandleScript,
		measureObscuring: measureObscuringScript,
		obscurerHandle: obscurerHandleScript,
		clearObscurer: clearObscurerScript,
		rememberStopElement: rememberStopElementScript,
	},
	async (ctx: ScriptContext<ScriptParts, TabStopHost>, a: TabStopArgs): Promise<TabStopResult> => {
		// Selector of an element the context observer is holding on to, or null if that fails.
		const heldSelector = async (
			part: "attributedHandle" | "submittedFormHandle",
		): Promise<string | null> => {
			try {
				const held = await ctx.handle(part);

				try {
					return (await ctx.call("getSelector", held)) ?? null;
				} finally {
					await ctx.release(held);
				}
			} catch (error) {
				if (ctx.isDestroyed(error)) {
					throw error;
				}

				return null;
			}
		};

		// On the host the wait has already happened, between the press and this call.
		if (ctx.host === null && !a.resumed && a.settleMs > 0) {
			await ctx.call("settle", a.settleMs);
		}

		// Chromium only matches :focus while the document reports focus, so an element measured after
		// a loss reads as having no indicator however correct its CSS is.
		let focused: boolean = await ctx.call("hasFocus");

		if (!focused && !a.resumed) {
			if (ctx.host === null) {
				return { kind: "needsFocus" };
			}

			await ctx.host.reassertFocus();
			focused = await ctx.call("hasFocus");
		}

		let base: ActiveElementBase | null;

		try {
			base = await ctx.call("probe", a.styleProps, a.markerAttr);
		} catch (error) {
			if (ctx.isDestroyed(error)) {
				return { kind: "navigation" };
			}

			throw error;
		}

		const nothingFocused = base === null || base === undefined || base.isBody;

		// The press that leaves the last element takes focus out of the document with it, so an
		// unfocused page probing as <body> is the tab order running out, not a stolen focus. Only a
		// real element measured without focus is a genuine loss.
		if (!focused && !nothingFocused) {
			return { kind: "lostFocus" };
		}

		// Navigation is checked before anything acts on a <body> probe: a freshly loaded document
		// has nothing focused either, and would otherwise read as the tab order having run out.
		let raw: DrainContextObserverResult | null = null;
		let baselineHref = a.baselineHref;

		if (a.wantContext) {
			let href: string;

			try {
				href = await ctx.call("locationHref");
			} catch (error) {
				if (ctx.isDestroyed(error)) {
					return { kind: "navigation" };
				}

				throw error;
			}

			if (baselineHref !== null && href !== baselineHref) {
				// The URL changed. The observer's own record says whether that was the History API;
				// anything else, or no observer left to ask, is a full navigation.
				try {
					raw = (await ctx.call("drain", a.markerAttr)) ?? null;
				} catch {
					raw = null;
				}

				if (raw === null || !raw.softUrlChange) {
					return { kind: "navigation" };
				}

				baselineHref = href;
			}
		} else {
			// Without the context observer there is no soft-navigation record to consult, but the tab
			// observer going missing still gives a replaced document away.
			let replaced: boolean;

			try {
				// A document can start to leave and then stay, when a "leave this page?" prompt is
				// dismissed or the navigation is handed to another application (`mailto:`). One still
				// here at the limit has stayed.
				for (
					let waited = 0;
					waited < a.leavingLimitMs && (await ctx.call("leaving"));
					waited += a.leavingIntervalMs
				) {
					await ctx.sleep(a.leavingIntervalMs);
				}

				await ctx.call("stayed");
				replaced = (await ctx.call("documentReplaced")) === true;
			} catch (error) {
				if (!ctx.isDestroyed(error)) {
					throw error;
				}

				replaced = true;
			}

			if (replaced) {
				return { kind: "navigation" };
			}
		}

		if (base === null || base === undefined || base.isBody) {
			// Nothing is focused. Either the tab order ran out, or the element this press reached gave
			// focus up again, in which case the order carries on past it.
			const blurredStop: BlurredStop | null =
				(await ctx.call("blurredStop", a.markerAttr, a.nextMarker)) || null;

			// The observer's focus history still names an element that took focus and dropped it, so
			// it is read here too.
			if (a.wantContext && raw === null) {
				try {
					raw = (await ctx.call("drain", a.markerAttr)) ?? null;
				} catch (error) {
					if (!ctx.isDestroyed(error)) {
						throw error;
					}

					return { kind: "navigation" };
				}
			}

			let formSelector: string | null = null;

			if (raw?.hasSubmittedForm) {
				try {
					formSelector = await heldSelector("submittedFormHandle");
				} catch {
					return { kind: "navigation" };
				}
			}

			return { kind: "body", blurredStop, raw, formSelector, baselineHref };
		}

		if (base.isIframe) {
			return { kind: "iframe", html: base.html, baselineHref };
		}

		let index = base.index;

		if (index === null) {
			index = (await ctx.call("mark", a.markerAttr, a.nextMarker)) as number;
		}

		if (index === a.previousIndex) {
			const held: HeldFocus = await ctx.call("heldFocus", a.tabbableSelector);

			return { kind: "held", index, held, baselineHref };
		}

		if (ctx.host?.visited(index)) {
			return { kind: "revisit", index, baselineHref };
		}

		const el = await ctx.handle("activeHandle");

		try {
			// The host gets the element itself. A page cannot hand one back, so there it is kept for
			// the host to ask for by name: by the time a capture wants it, focus may have moved on.
			if (ctx.host === null) {
				await ctx.call("rememberStopElement", el);
			}

			const selector: string = await ctx.call("getSelector", el);
			let drainDestroyed = false;

			if (a.wantContext && raw === null) {
				try {
					raw = (await ctx.call("drain", a.markerAttr)) ?? null;
				} catch (error) {
					if (!ctx.isDestroyed(error)) {
						throw error;
					}

					drainDestroyed = true;
				}
			}

			let attributedSelector: string | null = null;
			let formSelector: string | null = null;

			if (raw !== null && !drainDestroyed) {
				try {
					if (raw.hasAttributed) {
						attributedSelector = await heldSelector("attributedHandle");
					}

					if (raw.hasSubmittedForm) {
						formSelector = await heldSelector("submittedFormHandle");
					}
				} catch {
					drainDestroyed = true;
				}
			}

			let obscuring: TabStopObscuring | null = null;

			if (a.wantObscuring) {
				let measured: MeasureObscuringResult = await ctx.call(
					"measureObscuring",
					el,
					a.obscurerAttr,
				);

				// A cover that is still arriving or leaving gets a second look, and so does an element
				// that is outside the viewport, which a smooth scroll may still be bringing in. One that
				// is see-through passes whatever the second look says, so it is not waited for.
				const unsettled = (m: MeasureObscuringResult): boolean =>
					m.offscreen || (m.fullyObscured && m.opacity !== "semi-transparent");

				if (unsettled(measured)) {
					const POLL_MS = 50;
					const LONGEST_MS = 1500;
					let delay = measured.offscreen ? POLL_MS : a.obscuringRecheckDelayMs;
					let waited = 0;

					// Looked at again for as long as the element is still moving, so that the verdict is
					// about where the scroll leaves it rather than somewhere along the way.
					while (true) {
						await ctx.sleep(delay);
						waited += delay;

						const next: MeasureObscuringResult = await ctx.call(
							"measureObscuring",
							el,
							a.obscurerAttr,
						);
						const before = measured.rect;
						const after = next.rect;
						const moved =
							!!before &&
							!!after &&
							(Math.abs(before.x - after.x) > 0.5 ||
								Math.abs(before.y - after.y) > 0.5 ||
								Math.abs(before.width - after.width) > 0.5 ||
								Math.abs(before.height - after.height) > 0.5);

						measured = next;

						if (!moved || !unsettled(next) || waited >= LONGEST_MS) {
							break;
						}

						delay = POLL_MS;
					}
				}

				let obscurerSelector: string | null = null;

				if (measured.hasObscurer) {
					const cover = await ctx.handle("obscurerHandle");

					try {
						obscurerSelector = await ctx.call("getSelector", cover);
					} finally {
						await ctx.release(cover);
					}

					await ctx.call("clearObscurer", a.obscurerAttr);
				}

				obscuring = { ...measured, obscurerSelector };
			}

			return {
				kind: "stop",
				base,
				index,
				selector,
				raw,
				drainDestroyed,
				attributedSelector,
				formSelector,
				obscuring,
				baselineHref,
				ref: ctx.host === null ? null : el,
			};
		} catch (error) {
			await ctx.release(el);

			throw error;
		}
	},
);

export type ClipTargetArgs = {
	buffer: number;
	/** Scroll the element to the centre of the viewport first if its clip would not fit. */
	centre: boolean;
	/** How long a centring scroll is given to settle. */
	settleMs: number;
};

export type ClipTarget = {
	page: { width: number; height: number };
	rect: Rect;
};

/** Where an element is, and how big the page is, optionally after centring the element. */
export const clipTargetScript = composeScript(
	{
		needsCentring: needsCentringScript,
		scrollToCenter: scrollToCenterScript,
		pageDimensions: pageDimensionsScript,
		elementRect: elementRectScript,
	},
	async (ctx, a: ClipTargetArgs, el: ElementRef): Promise<ClipTarget> => {
		if (a.centre && (await ctx.call("needsCentring", el, a.buffer))) {
			await ctx.call("scrollToCenter", el, a.buffer);
			await ctx.sleep(a.settleMs);
		}

		const page = await ctx.call("pageDimensions");
		const rect = await ctx.call("elementRect", el);

		return { page, rect };
	},
);
