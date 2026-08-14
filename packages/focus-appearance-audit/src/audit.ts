import { getSelector, truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import type { FocusAppearanceAuditAdaptor } from "./adaptor";
import {
	activeElementHandleScript,
	attributedHandleScript,
	baselineScript,
	blurScript,
	clearAttributedScript,
	clearContextFocusInsScript,
	clearMarkersScript,
	clearObscurerScript,
	drainContextObserverScript,
	elementRectScript,
	focusScript,
	installContextObserverScript,
	isCenterObscuredScript,
	locationHrefScript,
	measureObscuringScript,
	obscurerHandleScript,
	pageDimensionsScript,
	probeActiveElementScript,
	scrollToCenterScript,
} from "./browser-scripts";
import {
	type ContextChangeFinding,
	type ContextChangeSignals,
	classifyContextSignals,
} from "./context-change";
import {
	alignedRegionsDiffer,
	bufferedClip,
	type Rect,
	type StyleSnapshot,
	stylesIndicateFocus,
} from "./detection";
import { FOCUS_STYLE_PROPERTIES } from "./focus-style";
import { classifyObscuring, type ObscuredMeasurement } from "./obscuring";
import type {
	DetectionMethod,
	FocusAppearanceResult,
	FocusElementResult,
} from "./result";

export const DEFAULT_ELEMENT_LIMIT = 1024;
export const DEFAULT_SCREENSHOT_SETTLE_DELAY = 33; // ~2 frames at 60fps
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_SCREENSHOT_DIFF_THRESHOLD = 4;
export const DEFAULT_FAILED_ELEMENT_LIMIT = 0; // 0 = never finish early
export const DEFAULT_TIMEOUT = 0; // 0 = no timeout
export const DEFAULT_OBSCURING_RECHECK_DELAY = 250;

const MARKER_ATTR = "data-a11y-focus-idx";
const OBSCURER_ATTR = "data-a11y-obscurer";

export type FocusAppearanceOptions = {
	/** Max focusable elements to tab through */
	elementLimit?: number;

	/**
	 * The audit calculates the baseline styles for focusable elements up-front, before it begins
	 * tabbing through elements. `elementLimit` controls how many elements the audit will tab
	 * through, however not all focusable elements are tabbable, for example elements inside menus
	 * or hidden containers. The baseline element limit therefore ensures enough focusable elements
	 * have a baseline snapshot. The effective baseline budget is `max(elementLimit,
	 * baselineElementLimit)`, so it also acts as a floor. Defaults to `elementLimit * 2`.
	 */
	baselineElementLimit?: number;

	/** How long to wait (in ms) after each Tab for focus styles/transitions to settle */
	screenshotSettleDelay?: number;

	/** Padding around the element box for the pixel-diff screenshot */
	screenshotClipBuffer?: number;

	/** Number of pixels that must differ to consider an indicator present. Minimum 1; default 4. */
	screenshotDiffThreshold?: number;

	/**
	 * Whether to skip the style check and perform a pixel diff for every element. Warning: this
	 * will cause the audit to be much slower, but may reduce false positives in some rare cases
	 */
	skipStyleCheck?: boolean;

	/**
	 * Finish the audit early once this many elements have failed, leaving the remaining elements
	 * unchecked. Useful as a fail-fast signal when you only need to know that a page has focus
	 * problems, not their full extent. 0 (the default) means no early finish.
	 */
	failedElementLimit?: number;

	/**
	 * Limit how long (in ms) the audit runs before returning the results it has
	 * gathered so far.
	 */
	timeout?: number;

	/**
	 * Measure whether each focused element is entirely hidden by author-created
	 * content (WCAG 2.4.11). Defaults to true.
	 */
	measureObscuring?: boolean;

	/**
	 * Watch for unexpected context changes caused by focus alone (WCAG 3.2.1).
	 * Defaults to true.
	 */
	measureContextChange?: boolean;

	/**
	 * Delay (ms) before re-measuring a fully-obscured finding so transient
	 * overlays (toasts, entrance animations) are not reported. Defaults to 250.
	 */
	obscuringRecheckDelay?: number;
};

type ResolvedOptions = Required<FocusAppearanceOptions>;

export type ActiveElementInfo = {
	/** The element's marker index, or null if it was not in the baseline set. */
	index: number | null;
	isBody: boolean;
	/** The focused element is an <iframe>; see ActiveElementBase. */
	isIframe: boolean;
	selector: string;
	html: string;
	styles: StyleSnapshot;
	rect: Rect;
};

/** A focusable element's unfocused baseline: its styles and page-relative rect. */
export type BaselineEntry = {
	styles: StyleSnapshot;
	rect: Rect;
};

/** Drain result for one tab stop's context-change observer buffer. */
export type ContextChangeDrain = {
	signals: ContextChangeSignals;
	/**
	 * When focus was removed or redirected, the element that briefly received
	 * focus this stop (from the focusin observer), used for attribution.
	 */
	attributed?: { selector: string; html: string } | null;
};

/** The browser-coupled seams the loop drives. Mocked in unit tests. */
export type FocusProbe = {
	captureBaseline(): Promise<Map<number, BaselineEntry>>;
	hasFocus(): Promise<boolean>;
	pressTab(): Promise<void>;
	settle(): Promise<void>;
	probeActiveElement(): Promise<ActiveElementInfo | null>;
	/** Install page observers once before the tab loop (context-change). */
	installContextObserver(): Promise<void>;
	/**
	 * Drain observer signals for the just-focused stop. Evaluated from the
	 * post-Tab settle state only (never from pixel-diff blur/refocus).
	 */
	drainContextSignals(
		info: ActiveElementInfo | null,
	): Promise<ContextChangeDrain>;
	/** Discard observer noise from pixel-diff blur/refocus. */
	clearContextNoise(): Promise<void>;
	measureObscuring(
		info: ActiveElementInfo,
	): Promise<ObscuredMeasurement | null>;
	detectIndicator(
		info: ActiveElementInfo,
		baseline: Map<number, BaselineEntry>,
	): Promise<DetectionMethod | null>;
	clearMarkers(): Promise<void>;
};

function resolveOptions(options: FocusAppearanceOptions): ResolvedOptions {
	const elementLimit = options.elementLimit ?? DEFAULT_ELEMENT_LIMIT;

	return {
		elementLimit,
		baselineElementLimit: options.baselineElementLimit ?? elementLimit * 2,
		screenshotSettleDelay:
			options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		screenshotClipBuffer:
			options.screenshotClipBuffer ?? DEFAULT_SCREENSHOT_CLIP_BUFFER,
		// Floor at 1: regionsDiffer uses `diffPixels >= threshold`, so a threshold
		// of 0 would report every region (even identical ones) as differing.
		screenshotDiffThreshold: Math.max(
			1,
			options.screenshotDiffThreshold ?? DEFAULT_SCREENSHOT_DIFF_THRESHOLD,
		),
		skipStyleCheck: options.skipStyleCheck ?? false,
		failedElementLimit:
			options.failedElementLimit ?? DEFAULT_FAILED_ELEMENT_LIMIT,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
		measureObscuring: options.measureObscuring ?? true,
		measureContextChange: options.measureContextChange ?? true,
		obscuringRecheckDelay:
			options.obscuringRecheckDelay ?? DEFAULT_OBSCURING_RECHECK_DELAY,
	};
}

function emptyContextSignals(): ContextChangeSignals {
	return {
		openedWindow: false,
		submittedForm: false,
		focusRemoved: false,
		redirect: null,
		softUrlChange: false,
		navigation: false,
	};
}

/**
 * Tab through focusable elements and report whether each shows a visible focus
 * indicator. Enables focus reporting up front, then drives the loop.
 */
export async function runFocusAppearanceAudit(
	adaptor: FocusAppearanceAuditAdaptor,
	options: FocusAppearanceOptions = {},
): Promise<FocusAppearanceResult> {
	const resolved = resolveOptions(options);

	await adaptor.ensureFocusReporting();

	const probe = createAdaptorProbe(adaptor, resolved);

	return runFocusLoop(probe, resolved);
}

/** The engine-neutral tab loop. Exported for unit testing with a fake probe. */
export async function runFocusLoop(
	probe: FocusProbe,
	options: ResolvedOptions,
): Promise<FocusAppearanceResult> {
	const baseline = await probe.captureBaseline();
	const elements: FocusElementResult[] = [];
	const visited = new Set<number>();

	let i = 0;
	let failures = 0;
	let reachedLimit = false;
	let reachedFailedElementLimit = false;
	let timedOut = false;
	let aborted = false;
	let abortedForNavigation = false;
	/** Last attributed element from a successful drain; used if navigation destroys context mid-probe. */
	let lastContextAttributed: { selector: string; html: string } | null = null;

	// Captured at the instant the timeout fires so the returned results can't be
	// mutated by the loop still unwinding in the background.
	let timedOutElements: FocusElementResult[] | null = null;

	if (options.measureContextChange) {
		await probe.installContextObserver();
	}

	function pushContextOnlyRow(
		target: { selector: string; html: string },
		tabIndex: number,
		findings: ContextChangeFinding[],
	): void {
		elements.push({
			selector: target.selector,
			html: target.html,
			tabIndex,
			passed: false,
			detectionMethod: null,
			appearanceMeasured: false,
			contextChange: findings,
		});
	}

	async function tabThroughElements(): Promise<void> {
		try {
			for (; i < options.elementLimit; i++) {
				if (aborted || !(await probe.hasFocus())) {
					break;
				}

				await probe.pressTab();
				await probe.settle();

				let info: ActiveElementInfo | null;

				try {
					info = await probe.probeActiveElement();
				} catch (error) {
					if (!options.measureContextChange) {
						throw error;
					}

					const message =
						error instanceof Error ? error.message : String(error);
					const destroyed =
						/Execution context was destroyed|Target closed|frame was detached|navigat/i.test(
							message,
						);

					if (!destroyed) {
						throw error;
					}

					abortedForNavigation = true;
					aborted = true;
					// Prefer the last attributed focus target from a prior drain when
					// the probe never ran on this stop (selector may still be empty on
					// the first-tab navigation case).
					pushContextOnlyRow(
						lastContextAttributed ?? { selector: "", html: "" },
						i + 1,
						[{ kind: "navigation", bucket: "violation" }],
					);

					break;
				}

				let contextFindings: ContextChangeFinding[] = [];
				let attributed: { selector: string; html: string } | null | undefined;

				if (options.measureContextChange) {
					const drain = await probe.drainContextSignals(info);
					contextFindings = classifyContextSignals(drain.signals);
					attributed = drain.attributed;

					if (attributed) {
						lastContextAttributed = attributed;
					} else if (info && !info.isBody) {
						lastContextAttributed = {
							selector: info.selector,
							html: info.html,
						};
					}

					if (drain.signals.navigation) {
						abortedForNavigation = true;
						aborted = true;

						const target =
							attributed ??
							(info && !info.isBody
								? { selector: info.selector, html: info.html }
								: (lastContextAttributed ?? {
										selector: "",
										html: "",
									}));

						pushContextOnlyRow(target, i + 1, contextFindings);

						break;
					}
				}

				if (info === null || info.isBody) {
					// F55: element received focus then removed it. Attribute via the
					// focus observer, not via the pixel-diff blur path.
					if (
						options.measureContextChange &&
						contextFindings.some((f) => f.kind === "focus-removed") &&
						attributed
					) {
						pushContextOnlyRow(attributed, i + 1, contextFindings);
					}

					break;
				}

				if (info.isIframe) {
					// Tab moved focus into an embedded document. An <iframe> is a
					// container, not a control: WCAG attaches the focus-appearance
					// requirement to the focusable controls inside the frame (a
					// separate document, audited as its own page), not to the frame
					// itself. The parent's document.activeElement also reports the
					// same frame for every internal tab stop, so recording it would
					// both raise false positives and log one duplicate per inner
					// control. Keep tabbing so focus advances through and out of it.
					continue;
				}

				const redirectOutside = contextFindings.some(
					(f) => f.kind === "focus-redirected-outside",
				);

				// Focus theft: record against the source that redirected focus. Do
				// not measure the destination's indicator or obscuring as if it were
				// the intended tab stop.
				if (redirectOutside && attributed) {
					pushContextOnlyRow(attributed, i + 1, contextFindings);
					continue;
				}

				if (info.index !== null) {
					if (visited.has(info.index)) {
						break;
					}

					visited.add(info.index);
				}

				let obscured: ObscuredMeasurement | null = null;

				if (options.measureObscuring) {
					obscured = await probe.measureObscuring(info);
				}

				const method = await probe.detectIndicator(info, baseline);

				// Pixel-diff blurs and re-focuses; discard those focus events so
				// the next stop does not treat them as F55 / focus theft.
				if (options.measureContextChange) {
					await probe.clearContextNoise();
				}

				elements.push({
					selector: info.selector,
					html: info.html,
					tabIndex: i + 1,
					passed: method !== null,
					detectionMethod: method,
					appearanceMeasured: true,
					...(obscured !== null ? { obscured } : {}),
					...(contextFindings.length > 0
						? { contextChange: contextFindings }
						: {}),
				});

				if (method === null) {
					failures++;
				}

				if (
					options.failedElementLimit > 0 &&
					failures >= options.failedElementLimit
				) {
					reachedFailedElementLimit = true;

					break;
				}
			}

			reachedLimit = i === options.elementLimit;
		} finally {
			await probe.clearMarkers();
		}
	}

	if (options.timeout > 0) {
		const loop = tabThroughElements();
		let timer: ReturnType<typeof setTimeout> | undefined;

		try {
			await Promise.race([
				loop,
				new Promise<void>((resolve) => {
					timer = setTimeout(() => {
						aborted = true;
						timedOut = true;
						timedOutElements = [...elements];

						resolve();
					}, options.timeout);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}

		if (timedOut) {
			// The loop keeps unwinding in the background after we return (it breaks
			// at the next iteration); swallow any late failure so it can't surface
			// as an unhandled rejection.
			loop.catch(() => {});
		}
	} else {
		await tabThroughElements();
	}

	const finalElements = timedOutElements ?? elements;
	const appearanceElements = finalElements.filter((e) => e.appearanceMeasured);
	const passed = appearanceElements.filter((e) => e.passed).length;

	let obscuredChecked = 0;
	let obscuredViolations = 0;
	let obscuredIncomplete = 0;
	let contextChecked = 0;
	let contextViolations = 0;
	let contextIncomplete = 0;

	for (const el of finalElements) {
		if (el.obscured) {
			obscuredChecked++;
			const bucket = classifyObscuring(el.obscured);

			if (bucket === "violation") {
				obscuredViolations++;
			} else if (bucket === "incomplete") {
				obscuredIncomplete++;
			}
		}

		if (el.contextChange && el.contextChange.length > 0) {
			contextChecked++;

			for (const finding of el.contextChange) {
				if (finding.bucket === "violation") {
					contextViolations++;
				} else {
					contextIncomplete++;
				}
			}
		}
	}

	return {
		elements: finalElements,
		summary: {
			checked: appearanceElements.length,
			passed,
			failed: appearanceElements.length - passed,
			reachedLimit,
			reachedFailedElementLimit,
			timedOut,
			abortedForNavigation,
			obscured: {
				checked: obscuredChecked,
				violations: obscuredViolations,
				incomplete: obscuredIncomplete,
			},
			contextChange: {
				checked: contextChecked,
				violations: contextViolations,
				incomplete: contextIncomplete,
			},
		},
	};
}

function createAdaptorProbe(
	adaptor: FocusAppearanceAuditAdaptor,
	options: ResolvedOptions,
): FocusProbe {
	let baselineHref = "";

	return {
		async captureBaseline() {
			const payload = await adaptor.evaluate(
				baselineScript,
				FOCUS_STYLE_PROPERTIES as unknown as string[],
				MARKER_ATTR,
				Math.max(options.elementLimit, options.baselineElementLimit),
			);

			// Entries reference interned snapshots by index; the Map values share
			// the snapshot objects, which are only ever read.
			return new Map(
				payload.entries.map((e) => {
					const styles = payload.styles[e.styleIndex];

					if (!styles) {
						// A dangling index means the payload violated its own invariant;
						// degrading to the pixel diff here would silently hide the bug.
						throw new Error(
							`Baseline entry ${e.index} references missing style index ${e.styleIndex}`,
						);
					}

					return [e.index, { styles, rect: e.rect }] as const;
				}),
			);
		},

		hasFocus() {
			return adaptor.evaluate(() => document.hasFocus());
		},

		pressTab() {
			return adaptor.pressTab();
		},

		settle() {
			return new Promise((resolve) =>
				setTimeout(resolve, options.screenshotSettleDelay),
			);
		},

		async probeActiveElement() {
			const base = await adaptor.evaluate(
				probeActiveElementScript,
				FOCUS_STYLE_PROPERTIES as unknown as string[],
				MARKER_ATTR,
			);

			const html = truncateHtml(base.html);

			if (base.isBody) {
				return { ...base, html, selector: "" };
			}

			const handle = await adaptor.evaluateHandle(activeElementHandleScript);

			try {
				const selector = await adaptor.evaluate(getSelector, handle);

				return { ...base, html, selector };
			} finally {
				await adaptor.disposeRef(handle);
			}
		},

		async installContextObserver() {
			baselineHref = await adaptor.evaluate(locationHrefScript);
			await adaptor.evaluate(installContextObserverScript);
		},

		async drainContextSignals(info) {
			try {
				const href = await adaptor.evaluate(locationHrefScript);

				if (baselineHref && href !== baselineHref) {
					// Document navigated (or soft URL change). Prefer observer soft
					// flags when the context survived; otherwise treat as navigation.
					let soft = false;

					try {
						const raw = await adaptor.evaluate(
							drainContextObserverScript,
							MARKER_ATTR,
						);
						soft = raw.softUrlChange;
					} catch {
						soft = false;
					}

					if (!soft) {
						return {
							signals: {
								...emptyContextSignals(),
								navigation: true,
							},
							attributed:
								info && !info.isBody
									? { selector: info.selector, html: info.html }
									: null,
						};
					}

					return {
						signals: {
							...emptyContextSignals(),
							softUrlChange: true,
						},
						attributed: null,
					};
				}

				const raw = await adaptor.evaluate(
					drainContextObserverScript,
					MARKER_ATTR,
				);

				let attributed: { selector: string; html: string } | null = null;

				if (raw.hasAttributed) {
					const handle = await adaptor.evaluateHandle(attributedHandleScript);

					try {
						const selector = handle
							? await adaptor.evaluate(getSelector, handle)
							: "";

						attributed = {
							selector,
							html: truncateHtml(raw.attributedHtml ?? ""),
						};
					} finally {
						if (handle) {
							await adaptor.disposeRef(handle);
						}

						await adaptor.evaluate(clearAttributedScript);
					}
				}

				void info;

				return {
					signals: {
						openedWindow: raw.openedWindow,
						submittedForm: raw.submittedForm,
						focusRemoved: raw.focusRemoved,
						redirect: raw.redirect,
						softUrlChange: raw.softUrlChange,
						navigation: raw.navigation,
					},
					attributed,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const destroyed =
					/Execution context was destroyed|Target closed|frame was detached|navigat/i.test(
						message,
					);

				if (!destroyed) {
					throw error;
				}

				return {
					signals: {
						...emptyContextSignals(),
						navigation: true,
					},
					attributed:
						info && !info.isBody
							? { selector: info.selector, html: info.html }
							: null,
				};
			}
		},

		async clearContextNoise() {
			try {
				await adaptor.evaluate(clearContextFocusInsScript);
			} catch {
				// Page may have navigated; ignore.
			}
		},

		async measureObscuring(info) {
			void info;
			const handle = await adaptor.evaluateHandle(activeElementHandleScript);

			try {
				const measureOnce = async () => {
					const raw = await adaptor.evaluate(
						measureObscuringScript,
						handle,
						OBSCURER_ATTR,
					);

					let obscuredBy: ObscuredMeasurement["obscuredBy"] = null;

					if (raw.hasObscurer) {
						const coverHandle =
							await adaptor.evaluateHandle(obscurerHandleScript);

						try {
							const selector = coverHandle
								? await adaptor.evaluate(getSelector, coverHandle)
								: "";

							obscuredBy = {
								selector,
								html: truncateHtml(raw.obscuredByHtml ?? ""),
							};
						} finally {
							if (coverHandle) {
								await adaptor.disposeRef(coverHandle);
							}

							await adaptor.evaluate(clearObscurerScript, OBSCURER_ATTR);
						}
					}

					return {
						coveredFraction: raw.coveredFraction,
						fullyObscured: raw.fullyObscured,
						offscreen: raw.offscreen,
						opacity: raw.opacity,
						obscuredBy,
					} satisfies ObscuredMeasurement;
				};

				const first = await measureOnce();

				if (
					!(first.fullyObscured && first.opacity === "opaque") &&
					!(first.fullyObscured && first.opacity === "unknown")
				) {
					return first;
				}

				await new Promise((resolve) =>
					setTimeout(resolve, options.obscuringRecheckDelay),
				);

				return measureOnce();
			} finally {
				await adaptor.disposeRef(handle);
			}
		},

		async detectIndicator(info, baseline) {
			const baselineEntry =
				info.index !== null ? baseline.get(info.index) : undefined;

			if (!options.skipStyleCheck) {
				if (
					baselineEntry &&
					stylesIndicateFocus(baselineEntry.styles, info.styles)
				) {
					return "style";
				}
			}

			const differs = await fallbackPixelDiff(adaptor, options);

			return differs ? "pixel-diff" : null;
		},

		async clearMarkers() {
			await adaptor.evaluate(clearMarkersScript, MARKER_ATTR);
		},
	};
}

async function fallbackPixelDiff(
	adaptor: FocusAppearanceAuditAdaptor,
	options: ResolvedOptions,
): Promise<boolean> {
	// Hold a handle so we can blur and re-focus the SAME element
	// (document.activeElement becomes <body> after blur).
	const handle = await adaptor.evaluateHandle(activeElementHandleScript);

	try {
		// Tab scrolls an element just barely into view at the viewport edge, which
		// is exactly where fixed overlays (cookie banners, sticky footers) sit. If
		// something covers the element there, both screenshots would show the
		// overlay and no indicator could ever be detected — centre the element in
		// the viewport first, then give the scroll a moment to settle.
		if (await adaptor.evaluate(isCenterObscuredScript, handle)) {
			await adaptor.evaluate(scrollToCenterScript, handle);

			await new Promise((resolve) =>
				setTimeout(resolve, options.screenshotSettleDelay),
			);
		}

		const { width: pageWidth, height: pageHeight } =
			await adaptor.evaluate(pageDimensionsScript);

		const focusedRect = await adaptor.evaluate(elementRectScript, handle);
		const focusedClip = bufferedClip(
			focusedRect,
			pageWidth,
			pageHeight,
			options.screenshotClipBuffer,
		);

		// Capture the focused state first, while focus is genuine: re-focusing the
		// element afterwards cannot always restore it (the host of a closed shadow
		// root cannot push focus back inside), so the focused frame must be taken
		// before blurring.
		const focused = await adaptor.screenshotClip(focusedClip);

		await adaptor.evaluate(blurScript, handle);

		// Measure the unfocused rect after blurring rather than reusing a stale
		// baseline rect: a :focus rule may have moved the element, and a
		// fixed-position element's page-relative rect changes with every scroll.
		const unfocusedRect = await adaptor.evaluate(elementRectScript, handle);
		const unfocusedClip = bufferedClip(
			unfocusedRect,
			pageWidth,
			pageHeight,
			options.screenshotClipBuffer,
		);

		const unfocused = await adaptor.screenshotClip(unfocusedClip);

		// Restore focus so the next Tab advances from this element rather than
		// restarting traversal. (A closed-shadow host can't be re-focused into the
		// root; the loop still progresses because Tab re-enters from there.)
		await adaptor.evaluate(focusScript, handle);

		// Each screenshot is framed around its own state's rect, so compare them
		// aligned on where the element sits within each clip.
		return alignedRegionsDiffer(
			Buffer.from(focused),
			{ x: focusedRect.x - focusedClip.x, y: focusedRect.y - focusedClip.y },
			Buffer.from(unfocused),
			{
				x: unfocusedRect.x - unfocusedClip.x,
				y: unfocusedRect.y - unfocusedClip.y,
			},
			options.screenshotDiffThreshold,
		);
	} finally {
		await adaptor.disposeRef(handle);
	}
}
