import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import {
	type ContextChangeOnFocusOptions,
	createContextChangeOnFocusAudit,
} from "@a11y-pulse/context-change-on-focus-audit";
import {
	type DisclosureOperabilityOptions,
	runDisclosureOperabilityAudit,
} from "@a11y-pulse/disclosure-operability-audit";
import {
	type FilenameAltTextOptions,
	runFilenameAltTextAudit,
} from "@a11y-pulse/filename-alt-text-audit";
import {
	createFocusAppearanceAudit,
	type FocusAppearanceOptions,
} from "@a11y-pulse/focus-appearance-audit";
import {
	createFocusNotObscuredAudit,
	type FocusNotObscuredOptions,
} from "@a11y-pulse/focus-not-obscured-audit";
import { createFocusOrderAudit, type FocusOrderOptions } from "@a11y-pulse/focus-order-audit";
import { createKeyboardTrapAudit, type KeyboardTrapOptions } from "@a11y-pulse/keyboard-trap-audit";
import { type MovingContentOptions, runMovingContentAudit } from "@a11y-pulse/moving-content-audit";
import {
	type OrphanedTabRolesOptions,
	runOrphanedTabRolesAudit,
} from "@a11y-pulse/orphaned-tab-roles-audit";
import { type PasteBlockingOptions, runPasteBlockingAudit } from "@a11y-pulse/paste-blocking-audit";
import {
	type ReflowAuditAdaptor,
	type ReflowOptions,
	runReflowAudit,
} from "@a11y-pulse/reflow-audit";
import {
	type ResizeTextAuditAdaptor,
	type ResizeTextOptions,
	runResizeTextAudit,
} from "@a11y-pulse/resize-text-audit";
import { runSkipLinkAudit, type SkipLinkOptions } from "@a11y-pulse/skip-link-audit";
import {
	runSuspiciousNameAudit,
	type SuspiciousNameOptions,
} from "@a11y-pulse/suspicious-accessible-name-audit";
import {
	createTabOrchestrator,
	DEFAULT_ELEMENT_LIMIT,
	DEFAULT_SCREENSHOT_SETTLE_DELAY,
	type TabConsumer,
	type TabSessionOptions,
} from "@a11y-pulse/tab-orchestrator";
import {
	runTextSpacingAudit,
	type TextSpacingAuditAdaptor,
	type TextSpacingOptions,
} from "@a11y-pulse/text-spacing-audit";
import {
	createUnreachableControlsAudit,
	type UnreachableControlsAdaptor,
	type UnreachableControlsOptions,
} from "@a11y-pulse/unreachable-controls-audit";
import axe, { type AxeResults, type RunOptions as AxeRunOptions } from "axe-core";
import {
	AXE_CORE_AUDIT_ID,
	BrowserClosedError,
	errorMessage,
	failedAuditOutput,
	looksLikeClosedBrowser,
	StepTimeoutError,
} from "./audit-failure";
import { runAxeCore } from "./axe-core";
import { type AuditOutput, emptyOutput, mergeOutputs } from "./to-axe/audit-output";
import {
	CONTEXT_CHANGE_ON_FOCUS_AUDIT_ID,
	contextChangeOnFocusToAxe,
} from "./to-axe/context-change-on-focus";
import {
	DISCLOSURE_OPERABILITY_AUDIT_ID,
	disclosureOperabilityToAxe,
} from "./to-axe/disclosure-operability";
import { FILENAME_ALT_TEXT_AUDIT_ID, filenameAltTextToAxe } from "./to-axe/filename-alt-text";
import { FOCUS_APPEARANCE_AUDIT_ID, focusAppearanceToAxe } from "./to-axe/focus-appearance";
import { FOCUS_COLOR_ONLY_AUDIT_ID, focusColorOnlyToAxe } from "./to-axe/focus-color-only";
import {
	FOCUS_INDICATOR_CONTRAST_AUDIT_ID,
	focusIndicatorContrastToAxe,
} from "./to-axe/focus-indicator-contrast";
import { FOCUS_NOT_OBSCURED_AUDIT_ID, focusNotObscuredToAxe } from "./to-axe/focus-not-obscured";
import { FOCUS_ORDER_AUDIT_ID, focusOrderToAxe } from "./to-axe/focus-order";
import { KEYBOARD_TRAP_AUDIT_ID, keyboardTrapToAxe } from "./to-axe/keyboard-trap";
import { MOVING_CONTENT_AUDIT_ID, movingContentToAxe } from "./to-axe/moving-content";
import { ORPHANED_TAB_ROLES_AUDIT_ID, orphanedTabRolesToAxe } from "./to-axe/orphaned-tab-roles";
import { ACCESSIBLE_AUTHENTICATION_AUDIT_ID, pasteBlockingToAxe } from "./to-axe/paste-blocking";
import { REFLOW_AUDIT_ID, reflowToAxe } from "./to-axe/reflow";
import {
	RESIZE_TEXT_AUDIT_ID,
	resizeTextInapplicable,
	resizeTextToAxe,
} from "./to-axe/resize-text";
import { SKIP_LINK_AUDIT_ID, skipLinkToAxe } from "./to-axe/skip-link";
import {
	SUSPICIOUS_ACCESSIBLE_NAME_AUDIT_ID,
	suspiciousAccessibleNameToAxe,
} from "./to-axe/suspicious-accessible-name";
import { TEXT_SPACING_AUDIT_ID, textSpacingToAxe } from "./to-axe/text-spacing";
import {
	CONTROL_WITHOUT_ROLE_AUDIT_ID,
	KEYBOARD_REACHABILITY_AUDIT_ID,
	unreachableControlsToAxe,
} from "./to-axe/unreachable-controls";

/**
 * The adaptors every audit is driven through. One page, one adaptor per audit interface, so the
 * runner never needs to know which automation library is underneath.
 */
export type AuditAdaptors = {
	browser: BrowserAdaptor;
	reflow: ReflowAuditAdaptor;
	textSpacing: TextSpacingAuditAdaptor;
	/** Drives the resize text audit. The reflow adaptor, which has everything it needs, when omitted. */
	resizeText?: ResizeTextAuditAdaptor;
	/**
	 * Drives the unreachable controls audit. `browser` when omitted, in which case the audit only
	 * sees listeners added with `addEventListener` if `browser` itself has `inspectElements`.
	 */
	unreachableControls?: UnreachableControlsAdaptor;
	/**
	 * Load `url` in the page and resolve once it has loaded. Used to put the page back when focusing
	 * an element navigated it away mid-run. Without it the runner navigates from inside the page.
	 */
	navigate?: (url: string) => Promise<void>;
	/**
	 * Whether the page or its browser has closed or lost its connection. When it has, the run is
	 * abandoned with a `BrowserClosedError`. Without it the runner goes by the wording of the errors
	 * the adaptors throw.
	 */
	isClosed?: () => boolean;
};

/** Receives a short, human-readable description of each step as it starts. */
export type ProgressCallback = (step: string) => void;

/** Receives a message about something that did not stop the run but does qualify its results. */
export type WarningCallback = (message: string) => void;

/** Milliseconds the shared tab pass may take before it ends with what it has seen. */
export const DEFAULT_TAB_PASS_MAX_DURATION = 180_000;

// How much of what is left of the run the tab pass leaves for the audits to read their results
// once it has ended: a quarter, within these bounds.
const TAB_PASS_RESERVE_FRACTION = 0.25;
const TAB_PASS_MIN_RESERVE_MS = 2_000;
const TAB_PASS_MAX_RESERVE_MS = 20_000;

// The least time left in the run for the optional check that follows the tab pass to be started.
const AFTER_PASS_CHECK_MIN_MS = 1_500;

// How long the page is given to describe itself for a report axe-core contributed nothing to.
const ENVIRONMENT_TIMEOUT_MS = 5_000;

export type AuditRunnerOptions = {
	axe?: AxeRunOptions;
	filenameAltText?: FilenameAltTextOptions;
	orphanedTabRoles?: OrphanedTabRolesOptions;
	suspiciousAccessibleName?: SuspiciousNameOptions;
	focusAppearance?: FocusAppearanceOptions;
	focusNotObscured?: FocusNotObscuredOptions;
	contextChangeOnFocus?: ContextChangeOnFocusOptions;
	focusOrder?: FocusOrderOptions;
	keyboardTrap?: KeyboardTrapOptions;
	skipLink?: SkipLinkOptions;
	textSpacing?: TextSpacingOptions;
	reflow?: ReflowOptions;
	unreachableControls?: UnreachableControlsOptions;
	accessibleAuthentication?: PasteBlockingOptions;
	movingContent?: MovingContentOptions;
	resizeText?: ResizeTextOptions;
	disclosureOperability?: DisclosureOperabilityOptions;
	/**
	 * Ids of audits to leave out, from `AUDIT_IDS`. A skipped audit is not run where it has a step
	 * of its own, and is never reported. An id that is not in `AUDIT_IDS` is rejected.
	 */
	skip?: readonly string[];
	/**
	 * Limits on the tab pass the keyboard-driven audits share. `maxDuration` defaults to
	 * `DEFAULT_TAB_PASS_MAX_DURATION`, and 0 removes the limit.
	 */
	tabSession?: Pick<TabSessionOptions, "maxTabPresses" | "maxDuration">;
	/**
	 * Milliseconds the whole run may take. The audit running when it expires and every audit after it
	 * are reported as `incomplete`; the ones that finished keep their results. 0, the default, is no
	 * limit.
	 */
	maxDuration?: number;
	/**
	 * The URL being audited, reported as the result's `url` when the page is too busy to say where
	 * it is. The page's own `location.href` is used whenever it can be read.
	 */
	url?: string;
	onProgress?: ProgressCallback;
	onWarning?: WarningCallback;
};

/**
 * axe-core's own results, with every A11y Pulse audit merged into the same four buckets. The
 * environment fields (`url`, `timestamp`, `testEngine`, …) are axe-core's, describing the one run
 * that produced all of it.
 */
export type AuditRunnerResult = AxeResults;

type AuditLabel = { id: string; name: string };

const AXE_CORE: AuditLabel = { id: AXE_CORE_AUDIT_ID, name: "axe-core" };
const FILENAME_ALT_TEXT: AuditLabel = { id: FILENAME_ALT_TEXT_AUDIT_ID, name: "Image alt text" };
const ORPHANED_TAB_ROLES: AuditLabel = {
	id: ORPHANED_TAB_ROLES_AUDIT_ID,
	name: "Orphaned tab roles",
};
const SUSPICIOUS_NAME: AuditLabel = {
	id: SUSPICIOUS_ACCESSIBLE_NAME_AUDIT_ID,
	name: "Accessible names",
};
const FOCUS_APPEARANCE: AuditLabel = { id: FOCUS_APPEARANCE_AUDIT_ID, name: "Focus appearance" };
const FOCUS_COLOR_ONLY: AuditLabel = {
	id: FOCUS_COLOR_ONLY_AUDIT_ID,
	name: "Focus shown by colour alone",
};
const FOCUS_NOT_OBSCURED: AuditLabel = {
	id: FOCUS_NOT_OBSCURED_AUDIT_ID,
	name: "Focus not obscured",
};
const CONTEXT_CHANGE: AuditLabel = {
	id: CONTEXT_CHANGE_ON_FOCUS_AUDIT_ID,
	name: "Context change on focus",
};
const FOCUS_ORDER: AuditLabel = { id: FOCUS_ORDER_AUDIT_ID, name: "Focus order" };
const KEYBOARD_TRAP: AuditLabel = { id: KEYBOARD_TRAP_AUDIT_ID, name: "Keyboard trap" };
const SKIP_LINK: AuditLabel = { id: SKIP_LINK_AUDIT_ID, name: "Skip link activation" };
const TEXT_SPACING: AuditLabel = { id: TEXT_SPACING_AUDIT_ID, name: "Text spacing" };
const REFLOW: AuditLabel = { id: REFLOW_AUDIT_ID, name: "Reflow" };
const FOCUS_INDICATOR_CONTRAST: AuditLabel = {
	id: FOCUS_INDICATOR_CONTRAST_AUDIT_ID,
	name: "Focus indicator contrast",
};
const KEYBOARD_REACHABILITY: AuditLabel = {
	id: KEYBOARD_REACHABILITY_AUDIT_ID,
	name: "Keyboard reachability",
};
const CONTROL_WITHOUT_ROLE: AuditLabel = {
	id: CONTROL_WITHOUT_ROLE_AUDIT_ID,
	name: "Controls without a role",
};
const ACCESSIBLE_AUTHENTICATION: AuditLabel = {
	id: ACCESSIBLE_AUTHENTICATION_AUDIT_ID,
	name: "Accessible authentication",
};
const MOVING_CONTENT: AuditLabel = { id: MOVING_CONTENT_AUDIT_ID, name: "Moving content" };
const RESIZE_TEXT: AuditLabel = { id: RESIZE_TEXT_AUDIT_ID, name: "Resize text" };
const DISCLOSURE_OPERABILITY: AuditLabel = {
	id: DISCLOSURE_OPERABILITY_AUDIT_ID,
	name: "Disclosure operability",
};

/**
 * Every id the runner reports under, in the order the audits run. axe-core's own rules are
 * reported under their rule ids; `axe-core` stands for all of them.
 */
export const AUDIT_IDS: readonly string[] = [
	AXE_CORE,
	FILENAME_ALT_TEXT,
	ORPHANED_TAB_ROLES,
	SUSPICIOUS_NAME,
	MOVING_CONTENT,
	ACCESSIBLE_AUTHENTICATION,
	FOCUS_APPEARANCE,
	FOCUS_COLOR_ONLY,
	FOCUS_INDICATOR_CONTRAST,
	FOCUS_NOT_OBSCURED,
	CONTEXT_CHANGE,
	FOCUS_ORDER,
	KEYBOARD_REACHABILITY,
	CONTROL_WITHOUT_ROLE,
	KEYBOARD_TRAP,
	SKIP_LINK,
	TEXT_SPACING,
	RESIZE_TEXT,
	REFLOW,
	DISCLOSURE_OPERABILITY,
].map((label) => label.id);

/**
 * The narrowest viewport, in CSS px, the resize text audit is run from. It halves the viewport to
 * lay the page out as at 200% zoom, and half of anything narrower is under the 320px that WCAG
 * asks content to reflow to, which no zoom level on a phone-sized viewport produces.
 */
export const RESIZE_TEXT_MIN_VIEWPORT_WIDTH = 640;

function failed(label: AuditLabel, reason: string): AuditOutput {
	return failedAuditOutput(label.id, label.name, reason);
}

function tabPassReserve(remainingMs: number): number {
	const reserve = Math.min(
		TAB_PASS_MAX_RESERVE_MS,
		Math.max(TAB_PASS_MIN_RESERVE_MS, remainingMs * TAB_PASS_RESERVE_FRACTION),
	);

	return Math.min(reserve, remainingMs / 2);
}

function widestSessionOptions(
	options: AuditRunnerOptions,
	remainingMs: number | undefined,
): TabSessionOptions {
	const appearance = options.focusAppearance ?? {};
	const appearanceElementLimit = appearance.elementLimit ?? DEFAULT_ELEMENT_LIMIT;
	const requested = options.tabSession?.maxDuration ?? DEFAULT_TAB_PASS_MAX_DURATION;
	// With less of the run left than the pass is allowed, the pass is told to end itself early
	// enough for the audits to read what they saw before the run's own limit cuts the step off:
	// racing the pass to that limit would report all of them as timed out. 0 would mean no limit.
	const available =
		remainingMs === undefined ? undefined : Math.max(1, remainingMs - tabPassReserve(remainingMs));
	const maxDuration =
		available === undefined || (requested !== 0 && requested <= available) ? requested : available;

	return {
		markerLimit: Math.max(
			appearanceElementLimit,
			options.focusNotObscured?.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
			options.contextChangeOnFocus?.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
			options.keyboardTrap?.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
			options.focusOrder?.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
		),
		baselineElementLimit: appearance.baselineElementLimit ?? appearanceElementLimit * 2,
		screenshotSettleDelay: Math.max(
			appearance.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
			options.focusNotObscured?.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
			options.contextChangeOnFocus?.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
			options.keyboardTrap?.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
			options.focusOrder?.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		),
		screenshotClipBuffer: appearance.screenshotClipBuffer,
		maxTabPresses: options.tabSession?.maxTabPresses,
		maxDuration,
	};
}

type TabAuditOutputs = {
	outputs: AuditOutput[];
	/**
	 * Absent when the keyboard trap audit was skipped, or failed in the pass and is already among
	 * `outputs`.
	 */
	verifyKeyboardTrap: (() => Promise<AuditOutput>) | undefined;
};

type Wanted = (label: AuditLabel) => boolean;

/** The labels the shared tab pass reports under, less the skipped ones. */
function tabPassLabels(wanted: Wanted): AuditLabel[] {
	return [
		FOCUS_APPEARANCE,
		FOCUS_COLOR_ONLY,
		FOCUS_INDICATOR_CONTRAST,
		FOCUS_NOT_OBSCURED,
		CONTEXT_CHANGE,
		FOCUS_ORDER,
		KEYBOARD_REACHABILITY,
		CONTROL_WITHOUT_ROLE,
		KEYBOARD_TRAP,
	].filter(wanted);
}

async function runTabAuditsInSharedSession(
	adaptors: AuditAdaptors,
	options: AuditRunnerOptions,
	startHref: string,
	remainingMs: () => number | undefined,
	wanted: Wanted,
	onWarning: WarningCallback,
): Promise<TabAuditOutputs> {
	// One consumer can report under several ids, and is only left out when all of them are skipped.
	const focusAppearance = [FOCUS_APPEARANCE, FOCUS_COLOR_ONLY, FOCUS_INDICATOR_CONTRAST].some(
		wanted,
	)
		? createFocusAppearanceAudit(options.focusAppearance)
		: undefined;
	const focusNotObscured = wanted(FOCUS_NOT_OBSCURED)
		? createFocusNotObscuredAudit(options.focusNotObscured)
		: undefined;
	const contextChangeOnFocus = wanted(CONTEXT_CHANGE)
		? createContextChangeOnFocusAudit(options.contextChangeOnFocus)
		: undefined;
	const keyboardTrap = wanted(KEYBOARD_TRAP)
		? createKeyboardTrapAudit(options.keyboardTrap)
		: undefined;
	const focusOrder = wanted(FOCUS_ORDER) ? createFocusOrderAudit(options.focusOrder) : undefined;
	const unreachableControls = [KEYBOARD_REACHABILITY, CONTROL_WITHOUT_ROLE].some(wanted)
		? createUnreachableControlsAudit(options.unreachableControls)
		: undefined;

	const orchestrator = createTabOrchestrator(
		adaptors.browser,
		widestSessionOptions(options, remainingMs()),
	);

	for (const consumer of [
		focusAppearance,
		focusNotObscured,
		contextChangeOnFocus,
		keyboardTrap,
		focusOrder,
		unreachableControls,
	]) {
		if (consumer) {
			orchestrator.attach(consumer);
		}
	}

	let sessionError: unknown;

	try {
		const stats = await orchestrator.run();

		if (stats.endReason === "limit") {
			onWarning(
				`The tab pass reached its limit after ${stats.tabStops} tab stops, so the keyboard-driven audits only cover the part of the page it reached.`,
			);
		}
	} catch (error) {
		sessionError = error ?? new Error("The tab pass failed");
	}

	// `run` rejects for a consumer that threw as well as for a session that failed. The first leaves
	// every other consumer's result intact, so only a rejection nobody is named for fails them all.
	const thrown = new Map<TabConsumer, unknown>(
		orchestrator.failures.map((failure) => [failure.consumer, failure.error]),
	);
	const sessionFailure =
		sessionError !== undefined && thrown.size === 0 ? errorMessage(sessionError) : undefined;

	const failureOf = (consumer: TabConsumer): string | undefined =>
		sessionFailure ?? (thrown.has(consumer) ? errorMessage(thrown.get(consumer)) : undefined);

	const convert = async (
		consumer: TabConsumer,
		labels: readonly AuditLabel[],
		toAxe: () => AuditOutput | Promise<AuditOutput>,
	): Promise<AuditOutput[]> => {
		const reported = labels.filter(wanted);

		if (reported.length === 0) {
			return [];
		}

		const failure = failureOf(consumer);

		if (failure !== undefined) {
			return reported.map((label) => failed(label, failure));
		}

		try {
			return [await toAxe()];
		} catch (error) {
			return reported.map((label) => failed(label, errorMessage(error)));
		}
	};

	// Read before anything else touches the page: the scan looks for controls the pass never
	// reached, in the page as the pass left it.
	const unreachableOutputs = unreachableControls
		? await convert(unreachableControls, [KEYBOARD_REACHABILITY, CONTROL_WITHOUT_ROLE], async () =>
				unreachableControlsToAxe(
					await unreachableControls.analyse(
						adaptors.unreachableControls ?? adaptors.browser,
						startHref,
					),
				),
			)
		: [];

	// Tabbing forwards never leaves an element under a sticky header, so the audit looks for that
	// separately. Losing this check must not lose what the tab pass found.
	const left = remainingMs();

	if (
		focusNotObscured &&
		failureOf(focusNotObscured) === undefined &&
		(left === undefined || left >= AFTER_PASS_CHECK_MIN_MS)
	) {
		try {
			await focusNotObscured.checkScrolledToTop(adaptors.browser);
		} catch {
			// The tab pass's verdicts stand.
		}
	}

	const outputs = [
		...(focusAppearance
			? [
					...(await convert(focusAppearance, [FOCUS_APPEARANCE], () =>
						focusAppearanceToAxe(focusAppearance.result),
					)),
					...(await convert(focusAppearance, [FOCUS_COLOR_ONLY], () =>
						focusColorOnlyToAxe(focusAppearance.result),
					)),
					// The same measurements read again: no further work in the page.
					...(await convert(focusAppearance, [FOCUS_INDICATOR_CONTRAST], () =>
						focusIndicatorContrastToAxe(focusAppearance.result),
					)),
				]
			: []),
		...(focusNotObscured
			? await convert(focusNotObscured, [FOCUS_NOT_OBSCURED], () =>
					focusNotObscuredToAxe(focusNotObscured.result),
				)
			: []),
		...(contextChangeOnFocus
			? await convert(contextChangeOnFocus, [CONTEXT_CHANGE], () =>
					contextChangeOnFocusToAxe(contextChangeOnFocus.result),
				)
			: []),
		...(focusOrder
			? await convert(focusOrder, [FOCUS_ORDER], async () =>
					focusOrderToAxe(await focusOrder.analyse(adaptors.browser, startHref)),
				)
			: []),
		...unreachableOutputs,
	];

	const keyboardTrapFailure = keyboardTrap ? failureOf(keyboardTrap) : undefined;

	if (keyboardTrapFailure !== undefined) {
		outputs.push(failed(KEYBOARD_TRAP, keyboardTrapFailure));
	}

	return {
		outputs,
		verifyKeyboardTrap:
			keyboardTrap && keyboardTrapFailure === undefined
				? async () => keyboardTrapToAxe(await keyboardTrap.verify(adaptors.browser))
				: undefined,
	};
}

function blurAndScrollToTopScript(): void {
	(document.activeElement as HTMLElement | null)?.blur();
	window.scrollTo(0, 0);
}

// Set on the document the run started on, to tell it from one loaded in its place.
const DOCUMENT_TOKEN = "__a11yPulseRunnerDocument";

const RESTORE_POLL_INTERVAL_MS = 100;
const RESTORE_TIMEOUT_MS = 15_000;

type PageState = { href: string; marked: boolean; loaded: boolean };

function markDocumentScript(key: string): void {
	(window as unknown as Record<string, boolean>)[key] = true;
}

function pageStateScript(key: string): PageState {
	return {
		href: location.href,
		marked: (window as unknown as Record<string, boolean>)[key] === true,
		loaded: document.readyState === "complete",
	};
}

function navigateScript(url: string): void {
	location.href = url;
}

function withoutFragment(href: string): string {
	return href.replace(/#.*$/, "");
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readPageState(browser: BrowserAdaptor): Promise<PageState | undefined> {
	try {
		return await browser.evaluate(pageStateScript, DOCUMENT_TOKEN);
	} catch {
		// The execution context is gone while a navigation is under way.
		return undefined;
	}
}

/**
 * Put the page back on the document the run started on when something navigated it away, and
 * return why that was not possible, if it was not. Audits measure the page as loaded, so one that
 * runs on another document reports on the wrong page under the original URL.
 */
async function restoreOriginalPage(
	adaptors: AuditAdaptors,
	startHref: string,
	onWarning: WarningCallback,
): Promise<string | undefined> {
	const { browser } = adaptors;
	const wanted = withoutFragment(startHref);
	const state = await readPageState(browser);

	if (state?.marked && withoutFragment(state.href) === wanted) {
		return undefined;
	}

	const strayed = state === undefined ? "another document" : state.href;
	const deadline = performance.now() + RESTORE_TIMEOUT_MS;

	try {
		// The original URL loaded afresh needs no navigation, only time to finish loading.
		if (state === undefined || withoutFragment(state.href) !== wanted) {
			if (adaptors.navigate) {
				await adaptors.navigate(startHref);
			} else {
				await browser.evaluate(navigateScript, startHref).catch(() => {});
			}
		}

		for (;;) {
			const current = await readPageState(browser);

			if (current?.loaded && withoutFragment(current.href) === wanted) {
				break;
			}

			if (performance.now() >= deadline) {
				throw new Error("the original URL did not finish loading");
			}

			await delay(RESTORE_POLL_INTERVAL_MS);
		}

		await browser.evaluate(markDocumentScript, DOCUMENT_TOKEN);
	} catch (error) {
		return `the page navigated to ${strayed} during the run and could not be returned to ${startHref} (${errorMessage(error)})`;
	}

	onWarning(
		`The page navigated to ${strayed} during the run. Reloaded ${startHref} before continuing.`,
	);

	return undefined;
}

const NO_OUTPUT: AuditOutput[] = [];

type Environment = Omit<AxeResults, "passes" | "violations" | "incomplete" | "inapplicable">;

function environmentScript(): Environment["testEnvironment"] {
	return {
		userAgent: navigator.userAgent,
		windowWidth: window.innerWidth,
		windowHeight: window.innerHeight,
		orientationAngle: screen.orientation?.angle,
		orientationType: screen.orientation?.type,
	};
}

const UNKNOWN_ENVIRONMENT: Environment["testEnvironment"] = {
	userAgent: "",
	windowWidth: 0,
	windowHeight: 0,
};

/** The environment fields axe-core would have reported, for a run in which it could not. */
function fallbackEnvironment(
	url: string,
	testEnvironment: Environment["testEnvironment"],
): Environment {
	return {
		toolOptions: {},
		testEngine: { name: "axe-core", version: axe.version },
		testRunner: { name: "axe" },
		testEnvironment,
		url,
		timestamp: new Date().toISOString(),
	};
}

type StepRunner = {
	/**
	 * Run one step, converting a throw or a timeout into an `incomplete` entry for each audit it
	 * stands for. Once a step has timed out the page is still busy with it, so later steps are
	 * skipped and reported the same way.
	 */
	run(
		labels: readonly AuditLabel[],
		progress: string,
		step: () => Promise<AuditOutput | AuditOutput[]>,
	): Promise<AuditOutput[]>;
	/**
	 * Do something in the page that is not an audit, within what is left of the run and of `capMs`.
	 * Resolves to `fallback` without touching the page once a step has timed out, and when this
	 * runs out of time itself, in which case every later step is skipped. Other errors are thrown.
	 */
	guard<T>(work: () => Promise<T>, fallback: T, capMs?: number): Promise<T>;
	/** Report every later step as skipped for `reason`. */
	skipRest(reason: string): void;
	skipping(): boolean;
	remainingMs(): number | undefined;
};

function createStepRunner(
	maxDuration: number,
	onProgress: ProgressCallback,
	isClosed: (error?: unknown) => boolean,
): StepRunner {
	const startedAt = performance.now();
	const outOfTime = `skipped because the run reached its ${maxDuration}ms time limit`;
	let skipReason: string | undefined;

	const remainingMs = (): number | undefined =>
		maxDuration > 0 ? Math.max(0, maxDuration - (performance.now() - startedAt)) : undefined;

	const raceAgainst = async <T>(
		pending: Promise<T>,
		milliseconds: number | undefined,
	): Promise<T> => {
		if (milliseconds === undefined) {
			return pending;
		}

		let timer: NodeJS.Timeout | undefined;

		try {
			return await Promise.race([
				pending,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new StepTimeoutError(milliseconds)), milliseconds);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	};

	return {
		remainingMs,
		skipping: () => skipReason !== undefined,
		skipRest(reason) {
			skipReason ??= reason;
		},
		async guard(work, fallback, capMs) {
			if (skipReason !== undefined) {
				return fallback;
			}

			if (isClosed()) {
				throw new BrowserClosedError();
			}

			const remaining = remainingMs();

			if (remaining === 0) {
				skipReason = outOfTime;

				return fallback;
			}

			const capped = capMs !== undefined && (remaining === undefined || capMs < remaining);
			const limit = capped ? capMs : remaining;

			try {
				return await raceAgainst(work(), limit);
			} catch (error) {
				if (isClosed(error)) {
					throw new BrowserClosedError();
				}

				if (error instanceof StepTimeoutError) {
					// Whatever the page is busy with, it is still busy: nothing more can be asked of it.
					skipReason = capped
						? `skipped because the page stopped responding (no answer within ${limit}ms)`
						: outOfTime;

					return fallback;
				}

				throw error;
			}
		},
		async run(labels, progress, step) {
			if (skipReason === undefined && isClosed()) {
				throw new BrowserClosedError();
			}

			const remaining = remainingMs();

			if (skipReason === undefined && remaining === 0) {
				skipReason = outOfTime;
			}

			if (skipReason !== undefined) {
				const reason = skipReason;

				return labels.map((label) => failed(label, reason));
			}

			onProgress(progress);

			let outputs: AuditOutput[];

			try {
				outputs = [await raceAgainst(step(), remaining)].flat();
			} catch (error) {
				if (isClosed(error)) {
					throw new BrowserClosedError();
				}

				if (error instanceof StepTimeoutError) {
					skipReason = outOfTime;

					return labels.map((label) =>
						failed(label, `the run reached its ${maxDuration}ms time limit while it was running`),
					);
				}

				return labels.map((label) => failed(label, errorMessage(error)));
			}

			// A step that reports its own failures, as the tab pass does, would otherwise turn a dead
			// browser into a set of incomplete audits.
			if (isClosed()) {
				throw new BrowserClosedError();
			}

			return outputs;
		},
	};
}

/**
 * Run axe-core and every A11y Pulse audit against an already-loaded page, reporting all of them as
 * one axe-core result set. An audit that throws or runs out of time is reported as `incomplete`
 * under its own id, and the rest still run. Rejects with a `BrowserClosedError` when the page or the
 * browser goes away mid-run.
 */
export async function runAllAudits(
	adaptors: AuditAdaptors,
	options: AuditRunnerOptions = {},
): Promise<AuditRunnerResult> {
	const { browser } = adaptors;
	const onProgress = options.onProgress ?? (() => {});
	const onWarning = options.onWarning ?? (() => {});
	const skipped = new Set(options.skip ?? []);
	const unknown = [...skipped].filter((id) => !AUDIT_IDS.includes(id));

	if (unknown.length > 0) {
		throw new TypeError(
			`Cannot skip unknown audit${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}. Expected any of: ${AUDIT_IDS.join(", ")}.`,
		);
	}

	const wanted: Wanted = (label) => !skipped.has(label.id);
	// Asked of the adaptors when they can say, and otherwise read from the error an audit threw.
	const isClosed = (error?: unknown): boolean =>
		adaptors.isClosed ? adaptors.isClosed() : error !== undefined && looksLikeClosedBrowser(error);
	const steps = createStepRunner(options.maxDuration ?? 0, onProgress, isClosed);

	/** Run a step that reports under one id, unless that audit is skipped. */
	const runAudit = async (
		label: AuditLabel,
		progress: string,
		step: () => Promise<AuditOutput>,
	): Promise<AuditOutput[]> => (wanted(label) ? steps.run([label], progress, step) : NO_OUTPUT);

	// A page whose main thread is blocked answers nothing, so even these are held to the limit.
	const startHref = await steps.guard(async () => {
		const href = await browser.evaluate(() => location.href);
		await browser.evaluate(markDocumentScript, DOCUMENT_TOKEN);

		return href;
	}, options.url ?? "");

	// Asked before each audit that measures the page as loaded: is this still the page the run
	// started on? A step that timed out still holds the page, so nothing more is asked of it.
	const onOriginalPage = async (): Promise<void> => {
		if (steps.skipping()) {
			return;
		}

		const problem = await steps.guard(
			() => restoreOriginalPage(adaptors, startHref, onWarning),
			undefined,
		);

		if (isClosed()) {
			throw new BrowserClosedError();
		}

		if (problem !== undefined) {
			steps.skipRest(problem);
		}
	};

	let axeResults: AxeResults | undefined;
	const axeOutput = await runAudit(AXE_CORE, "Running axe-core", async () => {
		axeResults = await runAxeCore(browser, options.axe);

		return emptyOutput();
	});

	const filenameAltText = await runAudit(FILENAME_ALT_TEXT, "Checking image alt text", async () =>
		filenameAltTextToAxe(await runFilenameAltTextAudit(browser, options.filenameAltText)),
	);

	const orphanedTabRoles = await runAudit(
		ORPHANED_TAB_ROLES,
		"Checking tabs and tab panels",
		async () =>
			orphanedTabRolesToAxe(await runOrphanedTabRolesAudit(browser, options.orphanedTabRoles)),
	);

	const suspiciousAccessibleName = await runAudit(
		SUSPICIOUS_NAME,
		"Checking accessible names",
		async () =>
			suspiciousAccessibleNameToAxe(
				await runSuspiciousNameAudit(browser, options.suspiciousAccessibleName),
			),
	);

	// Watched before anything presses a key or moves focus: content that pauses on focus, or that
	// an audit has scrolled or resized, would no longer be moving the way a visitor finds it. The
	// scans above only read the page. Nothing else may drive the page while this watches it, so the
	// wait cannot be shared with another audit.
	const movingContent = await runAudit(
		MOVING_CONTENT,
		"Watching for content that keeps moving",
		async () => movingContentToAxe(await runMovingContentAudit(browser, options.movingContent)),
	);

	// Dispatches paste events at sign-in fields and puts their values back. Before the tab pass,
	// which starts from the top of the page whatever was focused last.
	const accessibleAuthentication = await runAudit(
		ACCESSIBLE_AUTHENTICATION,
		"Checking sign-in fields accept pasted text",
		async () =>
			pasteBlockingToAxe(await runPasteBlockingAudit(browser, options.accessibleAuthentication)),
	);

	let verifyKeyboardTrap: (() => Promise<AuditOutput>) | undefined;
	const tabLabels = tabPassLabels(wanted);
	const tabAudits =
		tabLabels.length === 0
			? NO_OUTPUT
			: await steps.run(tabLabels, "Tabbing through focusable elements", async () => {
					const session = await runTabAuditsInSharedSession(
						adaptors,
						options,
						startHref,
						steps.remainingMs,
						wanted,
						onWarning,
					);
					verifyKeyboardTrap = session.verifyKeyboardTrap;

					return session.outputs;
				});

	await onOriginalPage();
	const skipLink = await runAudit(SKIP_LINK, "Running skip link audit", async () => {
		await browser.evaluate(blurAndScrollToTopScript);

		return skipLinkToAxe(await runSkipLinkAudit(browser, options.skipLink));
	});

	await onOriginalPage();
	const textSpacing = await runAudit(TEXT_SPACING, "Running text spacing audit", async () => {
		await browser.evaluate(blurAndScrollToTopScript);

		return textSpacingToAxe(await runTextSpacingAudit(adaptors.textSpacing, options.textSpacing));
	});

	// Resize text and reflow each change the viewport and put it back before returning, so each
	// starts from the size the page was loaded at. Resize text goes first: it compares against a
	// baseline of the page as the text spacing audit left it, with the same measuring scripts.
	await onOriginalPage();
	const resizeText = await runAudit(RESIZE_TEXT, "Running resize text audit", async () => {
		const resizeAdaptor = adaptors.resizeText ?? adaptors.reflow;
		const viewport = await resizeAdaptor.getViewport();

		if (viewport.width < RESIZE_TEXT_MIN_VIEWPORT_WIDTH) {
			return resizeTextInapplicable();
		}

		await browser.evaluate(blurAndScrollToTopScript);

		return resizeTextToAxe(await runResizeTextAudit(resizeAdaptor, options.resizeText));
	});

	await onOriginalPage();
	const reflow = await runAudit(REFLOW, "Running reflow audit", async () =>
		reflowToAxe(await runReflowAudit(adaptors.reflow, options.reflow)),
	);

	// The escape attempts can dismiss an overlay or load another document, so every audit that
	// measures the page as loaded runs before them. With nothing to verify, the tab pass has already
	// reported the audit.
	await onOriginalPage();
	const verify = verifyKeyboardTrap;
	const keyboardTrap =
		verify === undefined
			? NO_OUTPUT
			: await steps.run([KEYBOARD_TRAP], "Trying keyboard exits from a focus cycle", verify);

	// Last, because it presses Enter and Space on the page's own controls: every other audit has
	// already seen the page before anything was opened.
	await onOriginalPage();
	const disclosureOperability = await runAudit(
		DISCLOSURE_OPERABILITY,
		"Operating disclosures from the keyboard",
		async () => {
			await browser.evaluate(blurAndScrollToTopScript);

			return disclosureOperabilityToAxe(
				await runDisclosureOperabilityAudit(browser, options.disclosureOperability),
			);
		},
	);

	// A trigger that navigated is reported by the audit. The caller still gets back the page it
	// handed over.
	await onOriginalPage();

	const merged = mergeOutputs([
		axeResults ?? emptyOutput(),
		...axeOutput,
		...filenameAltText,
		...orphanedTabRoles,
		...suspiciousAccessibleName,
		...movingContent,
		...accessibleAuthentication,
		...tabAudits,
		...keyboardTrap,
		...skipLink,
		...textSpacing,
		...resizeText,
		...reflow,
		...disclosureOperability,
	]);

	// One consumer's mapping can report under an id that was skipped beside one that was not.
	for (const bucket of [merged.violations, merged.incomplete, merged.passes, merged.inapplicable]) {
		for (let i = bucket.length - 1; i >= 0; i--) {
			if (skipped.has(bucket[i]!.id)) {
				bucket.splice(i, 1);
			}
		}
	}

	// axe-core describes the run when it ran. Otherwise the page is asked, unless a step that timed
	// out still has it busy.
	const environment =
		axeResults ??
		fallbackEnvironment(
			startHref,
			await steps
				.guard(
					() => browser.evaluate(environmentScript),
					UNKNOWN_ENVIRONMENT,
					ENVIRONMENT_TIMEOUT_MS,
				)
				.catch((error) => {
					if (error instanceof BrowserClosedError) {
						throw error;
					}

					return UNKNOWN_ENVIRONMENT;
				}),
		);

	return { ...environment, ...merged };
}
