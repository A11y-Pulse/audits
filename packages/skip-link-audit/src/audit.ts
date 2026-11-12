import { captureElementScreenshot } from "@a11y-pulse/browser-adaptor";
import { getSelector, truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import type { ElementRef, SkipLinkAuditAdaptor } from "./adaptor";
import {
	activeElementHandleScript,
	focusScript,
	inspectSkipLinkScript,
	readPageStateScript,
	resetFocusScript,
	restorePageStateScript,
	type SkipLinkFocusPosition,
	type SkipLinkPageState,
	takeUnreachableSkipLinkScript,
} from "./browser-scripts";
import type {
	SkipLinkElementResult,
	SkipLinkFailureReason,
	SkipLinkFocusLanding,
	SkipLinkResult,
	SkipLinkTarget,
	SkipLinkUnreachableResult,
} from "./result";

export const DEFAULT_CANDIDATE_LIMIT = 3;
export const DEFAULT_ACTIVATION_POLL_MS = 250;

/** How many unreachable skip links to report when none can be reached by tabbing. */
const UNREACHABLE_LIMIT = 3;

const SCREENSHOT_CLIP_BUFFER = 10;
const SCREENSHOT_SETTLE_MS = 33; // ~2 frames at 60fps

export type SkipLinkOptions = {
	/** Max tab stops to scan for skip-link candidates. Defaults to 3. */
	candidateLimit?: number;
};

export type ResolvedSkipLinkOptions = {
	candidateLimit: number;
	activationPollMs: number;
};

export type SkipLinkCandidate = {
	selector: string;
	html: string;
	fragment: string;
	linkText: string;
	/** The element the fragment resolves to, or null when nothing matches it. */
	target: SkipLinkTarget | null;
	handle: ElementRef;
};

export type TabStopProbe = {
	isBody: boolean;
	/** Unique identity of the focused element, used to detect a focus cycle. */
	identity: string;
	candidate: SkipLinkCandidate | null;
};

/** Where focus is relative to a skip link, read after a key press. */
export type FocusReading = {
	position: SkipLinkFocusPosition;
	/** Whether the document's URL fragment is the one the link points at. */
	navigated: boolean;
	/** Whether the link's target exists. */
	targetExists: boolean;
	/** Whether the link's target exists and is rendered. */
	targetRendered: boolean;
};

/** The browser-coupled seams the loop drives. Mocked in unit tests. */
export type SkipLinkProbe = {
	pressTab(): Promise<void>;
	pressEnter(): Promise<void>;
	probeTabStop(): Promise<TabStopProbe>;
	focusHandle(ref: ElementRef): Promise<void>;
	/** Where focus is now, relative to the skip link behind `ref` and its target. */
	readFocus(ref: ElementRef): Promise<FocusReading>;
	/** Selector and opening tag of the focused element, or null when nothing is focused. */
	describeFocused(): Promise<{ selector: string; html: string } | null>;
	/** Skip links in the document that can never receive keyboard focus. */
	findUnreachable(): Promise<SkipLinkUnreachableResult[]>;
	/** Record the URL, history length and scroll position so activating a link can be undone. */
	saveState(): Promise<SkipLinkPageState>;
	restoreState(state: SkipLinkPageState): Promise<void>;
	/**
	 * Drop focus and start the tab order from the top again, so the next Tab press does not carry on
	 * from a skip target or from the last stop the audit looked at.
	 */
	clearFocus(): Promise<void>;
	/** Focus the element and screenshot it, so a link that only appears on focus is visible. */
	screenshotFocused(ref: ElementRef): Promise<Uint8Array>;
	disposeRef(ref: ElementRef): Promise<void>;
};

function resolveOptions(options: SkipLinkOptions): ResolvedSkipLinkOptions {
	return {
		candidateLimit: options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
		activationPollMs: DEFAULT_ACTIVATION_POLL_MS,
	};
}

/**
 * Tab through the first few stops looking for skip links, then activate each one and check that
 * keyboard focus moves. Enables focus reporting up front, then drives the loop.
 */
export async function runSkipLinkAudit(
	adaptor: SkipLinkAuditAdaptor,
	options: SkipLinkOptions = {},
): Promise<SkipLinkResult> {
	await adaptor.ensureFocusReporting();

	return runSkipLinkLoop(createAdaptorProbe(adaptor), resolveOptions(options));
}

/** Enter alone moved focus to the target, or to later content when there is no target to reach. */
function movedByEnter(focus: FocusReading): boolean {
	if (focus.position === "inside-target" || focus.position === "after-target") {
		return true;
	}

	return !focus.targetExists && focus.position === "after-link";
}

async function landing(probe: SkipLinkProbe, focus: FocusReading): Promise<SkipLinkFocusLanding> {
	const focused = focus.position === "body" ? null : await probe.describeFocused();

	return {
		position: focus.position,
		selector: focused?.selector ?? null,
		html: focused?.html ?? null,
	};
}

/** The engine-neutral two-phase loop. Exported for unit testing with a fake probe. */
export async function runSkipLinkLoop(
	probe: SkipLinkProbe,
	options: ResolvedSkipLinkOptions,
): Promise<SkipLinkResult> {
	const collected: Array<SkipLinkCandidate & { tabIndex: number }> = [];
	const seen = new Set<string>();
	const skipLinks: SkipLinkElementResult[] = [];

	try {
		for (let i = 0; i < options.candidateLimit; i++) {
			await probe.pressTab();

			const tabStop = await probe.probeTabStop();

			if (tabStop.isBody || seen.has(tabStop.identity)) {
				break;
			}

			seen.add(tabStop.identity);

			if (tabStop.candidate) {
				collected.push({ ...tabStop.candidate, tabIndex: i + 1 });
			}
		}

		for (const found of collected) {
			try {
				const state = await probe.saveState();

				try {
					await probe.focusHandle(found.handle);
					await probe.pressEnter();

					// A link with no target is still activated: a script may move focus on its behalf.
					const afterEnter = await pollFocus(probe, found.handle, options.activationPollMs);
					const focusAfterEnter = await landing(probe, afterEnter);

					let passed = movedByEnter(afterEnter);
					let failureReason: SkipLinkFailureReason | null = null;
					let focusAfterTab: SkipLinkFocusLanding | null = null;

					if (!passed && !afterEnter.targetExists) {
						failureReason = "target-missing";
					} else if (!passed && !afterEnter.targetRendered) {
						failureReason = "target-hidden";
					} else if (!passed) {
						// Following a fragment moves the browser's focus starting point without focusing
						// anything, so the next Tab shows whether the link worked.
						await probe.pressTab();

						const afterTab = await probe.readFocus(found.handle);
						const activated = afterEnter.navigated || afterEnter.position !== "skip-link";

						focusAfterTab = await landing(probe, afterTab);
						// Tabbing out of the document after the fragment was followed means the target
						// was reached and nothing focusable comes after it.
						passed =
							afterTab.position === "inside-target" ||
							(activated && afterTab.position === "after-target") ||
							(afterEnter.navigated && afterTab.position === "body");
						failureReason = passed ? null : "activation-no-effect";
					}

					skipLinks.push({
						selector: found.selector,
						html: found.html,
						fragment: found.fragment,
						tabIndex: found.tabIndex,
						passed,
						failureReason,
						linkText: found.linkText,
						target: found.target,
						focusAfterEnter,
						focusAfterTab,
						screenshot: passed ? undefined : await probe.screenshotFocused(found.handle),
					});
				} finally {
					await probe.restoreState(state);
				}
			} finally {
				await probe.disposeRef(found.handle);
			}
		}
	} finally {
		// Looking for candidates moved focus even when none was found, and so did each activation,
		// including one that threw. Whatever runs next starts tabbing from the top of the page.
		await probe.clearFocus();
	}

	// A skip link nobody can tab to is only a problem when no other skip link works in its place.
	const unreachable = collected.length === 0 ? await probe.findUnreachable() : [];
	const passed = skipLinks.filter((link) => link.passed).length;

	return {
		skipLinks,
		unreachable,
		summary: {
			found: skipLinks.length,
			passed,
			failed: skipLinks.length - passed,
			unreachable: unreachable.length,
		},
	};
}

async function pollFocus(
	probe: SkipLinkProbe,
	ref: ElementRef,
	pollMs: number,
): Promise<FocusReading> {
	let focus = await probe.readFocus(ref);
	const deadline = Date.now() + pollMs;

	while (!movedByEnter(focus) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 16));

		focus = await probe.readFocus(ref);
	}

	return focus;
}

function createAdaptorProbe(adaptor: SkipLinkAuditAdaptor): SkipLinkProbe {
	return {
		pressTab() {
			return adaptor.pressTab();
		},

		pressEnter() {
			return adaptor.pressEnter();
		},

		async probeTabStop() {
			const handle = await adaptor.evaluateHandle(activeElementHandleScript);
			const { link } = await adaptor.evaluate(inspectSkipLinkScript, handle, "classify");

			if (!link || link.isBody) {
				await adaptor.disposeRef(handle);

				return { isBody: true, identity: "body", candidate: null };
			}

			const selector = await adaptor.evaluate(getSelector, handle);

			if (link.fragment && link.skipLike) {
				return {
					isBody: false,
					identity: selector,
					candidate: {
						selector,
						html: truncateHtml(link.html),
						fragment: link.fragment,
						linkText: link.linkText,
						target: link.target && { ...link.target, html: truncateHtml(link.target.html) },
						handle,
					},
				};
			}

			await adaptor.disposeRef(handle);

			return { isBody: false, identity: selector, candidate: null };
		},

		focusHandle(ref) {
			return adaptor.evaluate(focusScript, ref);
		},

		async readFocus(ref) {
			const { link } = await adaptor.evaluate(inspectSkipLinkScript, ref, "focus");

			return {
				position: link?.focus.position ?? "body",
				navigated: link?.focus.navigated ?? false,
				targetExists: Boolean(link?.target),
				targetRendered: link?.target?.rendered ?? false,
			};
		},

		async describeFocused() {
			const handle = await adaptor.evaluateHandle(activeElementHandleScript);

			try {
				const { link } = await adaptor.evaluate(inspectSkipLinkScript, handle, "focus");

				if (!link || link.isBody) {
					return null;
				}

				return {
					selector: await adaptor.evaluate(getSelector, handle),
					html: truncateHtml(link.html),
				};
			} finally {
				await adaptor.disposeRef(handle);
			}
		},

		async findUnreachable() {
			const { unreachable } = await adaptor.evaluate(
				inspectSkipLinkScript,
				null,
				"unreachable",
				UNREACHABLE_LIMIT,
			);
			const results: SkipLinkUnreachableResult[] = [];

			for (const link of unreachable) {
				const handle = await adaptor.evaluateHandle(takeUnreachableSkipLinkScript);

				try {
					results.push({
						selector: await adaptor.evaluate(getSelector, handle),
						html: truncateHtml(link.html),
						fragment: link.fragment,
						linkText: link.linkText,
						reason: link.reason,
					});
				} finally {
					await adaptor.disposeRef(handle);
				}
			}

			return results;
		},

		saveState() {
			return adaptor.evaluate(readPageStateScript);
		},

		restoreState(state) {
			return adaptor.evaluate(restorePageStateScript, state);
		},

		clearFocus() {
			return adaptor.evaluate(resetFocusScript);
		},

		async screenshotFocused(ref) {
			await adaptor.evaluate(focusScript, ref);
			await new Promise((resolve) => setTimeout(resolve, SCREENSHOT_SETTLE_MS));

			return captureElementScreenshot(adaptor, ref, {
				clipBuffer: SCREENSHOT_CLIP_BUFFER,
				settleDelay: SCREENSHOT_SETTLE_MS,
			});
		},

		disposeRef(ref) {
			return adaptor.disposeRef(ref);
		},
	};
}
