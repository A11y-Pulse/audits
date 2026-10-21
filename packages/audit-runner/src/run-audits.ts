import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import {
	type ContextChangeOnFocusOptions,
	createContextChangeOnFocusAudit,
} from "@a11y-pulse/context-change-on-focus-audit";
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
import {
	type OrphanedTabRolesOptions,
	runOrphanedTabRolesAudit,
} from "@a11y-pulse/orphaned-tab-roles-audit";
import {
	type ReflowAuditAdaptor,
	type ReflowOptions,
	runReflowAudit,
} from "@a11y-pulse/reflow-audit";
import { runSkipLinkAudit, type SkipLinkOptions } from "@a11y-pulse/skip-link-audit";
import {
	createTabOrchestrator,
	DEFAULT_ELEMENT_LIMIT,
	DEFAULT_SCREENSHOT_SETTLE_DELAY,
	type TabSessionOptions,
} from "@a11y-pulse/tab-orchestrator";
import {
	runTextSpacingAudit,
	type TextSpacingAuditAdaptor,
	type TextSpacingOptions,
} from "@a11y-pulse/text-spacing-audit";
import type { AxeResults, RunOptions as AxeRunOptions } from "axe-core";
import { runAxeCore } from "./axe-core";
import { type AuditOutput, mergeOutputs } from "./to-axe/audit-output";
import { contextChangeOnFocusToAxe } from "./to-axe/context-change-on-focus";
import { filenameAltTextToAxe } from "./to-axe/filename-alt-text";
import { focusAppearanceToAxe } from "./to-axe/focus-appearance";
import { focusColorOnlyToAxe } from "./to-axe/focus-color-only";
import { focusNotObscuredToAxe } from "./to-axe/focus-not-obscured";
import { focusOrderToAxe } from "./to-axe/focus-order";
import { keyboardTrapToAxe } from "./to-axe/keyboard-trap";
import { orphanedTabRolesToAxe } from "./to-axe/orphaned-tab-roles";
import { reflowToAxe } from "./to-axe/reflow";
import { skipLinkToAxe } from "./to-axe/skip-link";
import { textSpacingToAxe } from "./to-axe/text-spacing";

/**
 * The adaptors every audit is driven through. One page, one adaptor per audit interface, so the
 * runner never needs to know which automation library is underneath.
 */
export type AuditAdaptors = {
	browser: BrowserAdaptor;
	reflow: ReflowAuditAdaptor;
	textSpacing: TextSpacingAuditAdaptor;
};

/** Receives a short, human-readable description of each step as it starts. */
export type ProgressCallback = (step: string) => void;

export type AuditRunnerOptions = {
	axe?: AxeRunOptions;
	filenameAltText?: FilenameAltTextOptions;
	orphanedTabRoles?: OrphanedTabRolesOptions;
	focusAppearance?: FocusAppearanceOptions;
	focusNotObscured?: FocusNotObscuredOptions;
	contextChangeOnFocus?: ContextChangeOnFocusOptions;
	focusOrder?: FocusOrderOptions;
	keyboardTrap?: KeyboardTrapOptions;
	skipLink?: SkipLinkOptions;
	textSpacing?: TextSpacingOptions;
	reflow?: ReflowOptions;
	onProgress?: ProgressCallback;
};

/**
 * axe-core's own results, with every A11y Pulse audit merged into the same four buckets. The
 * environment fields (`url`, `timestamp`, `testEngine`, …) are axe-core's, describing the one run
 * that produced all of it.
 */
export type AuditRunnerResult = AxeResults;

function widestSessionOptions(options: AuditRunnerOptions): TabSessionOptions {
	const appearance = options.focusAppearance ?? {};
	const appearanceElementLimit = appearance.elementLimit ?? DEFAULT_ELEMENT_LIMIT;

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
	};
}

type TabAuditOutputs = {
	outputs: AuditOutput[];
	verifyKeyboardTrap: () => Promise<AuditOutput>;
};

async function runTabAuditsInSharedSession(
	adaptors: AuditAdaptors,
	options: AuditRunnerOptions,
): Promise<TabAuditOutputs> {
	const focusAppearance = createFocusAppearanceAudit(options.focusAppearance);
	const focusNotObscured = createFocusNotObscuredAudit(options.focusNotObscured);
	const contextChangeOnFocus = createContextChangeOnFocusAudit(options.contextChangeOnFocus);
	const keyboardTrap = createKeyboardTrapAudit(options.keyboardTrap);
	const focusOrder = createFocusOrderAudit(options.focusOrder);

	const orchestrator = createTabOrchestrator(adaptors.browser, widestSessionOptions(options));
	orchestrator.attach(focusAppearance);
	orchestrator.attach(focusNotObscured);
	orchestrator.attach(contextChangeOnFocus);
	orchestrator.attach(keyboardTrap);
	orchestrator.attach(focusOrder);

	const startHref = await adaptors.browser.evaluate(() => location.href);
	await orchestrator.run();

	const focusOrderResult = await focusOrder.analyse(adaptors.browser, startHref);

	return {
		outputs: [
			focusAppearanceToAxe(focusAppearance.result),
			focusColorOnlyToAxe(focusAppearance.result),
			focusNotObscuredToAxe(focusNotObscured.result),
			contextChangeOnFocusToAxe(contextChangeOnFocus.result),
			focusOrderToAxe(focusOrderResult),
		],
		verifyKeyboardTrap: async () => keyboardTrapToAxe(await keyboardTrap.verify(adaptors.browser)),
	};
}

function blurAndScrollToTopScript(): void {
	(document.activeElement as HTMLElement | null)?.blur();
	window.scrollTo(0, 0);
}

/**
 * Run axe-core and every A11y Pulse audit against an already-loaded page, reporting all of them as
 * one axe-core result set.
 */
export async function runAllAudits(
	adaptors: AuditAdaptors,
	options: AuditRunnerOptions = {},
): Promise<AuditRunnerResult> {
	const { browser } = adaptors;
	const onProgress = options.onProgress ?? (() => {});

	onProgress("Running axe-core");
	const axeResults = await runAxeCore(browser, options.axe);

	onProgress("Checking image alt text");
	const filenameAltText = await runFilenameAltTextAudit(browser, options.filenameAltText);

	onProgress("Checking tabs and tab panels");
	const orphanedTabRoles = await runOrphanedTabRolesAudit(browser, options.orphanedTabRoles);

	onProgress("Tabbing through focusable elements");
	const { outputs: tabAudits, verifyKeyboardTrap } = await runTabAuditsInSharedSession(
		adaptors,
		options,
	);

	onProgress("Running skip link audit");
	await browser.evaluate(blurAndScrollToTopScript);
	const skipLink = await runSkipLinkAudit(browser, options.skipLink);

	onProgress("Running text spacing audit");
	await browser.evaluate(blurAndScrollToTopScript);
	const textSpacing = await runTextSpacingAudit(adaptors.textSpacing, options.textSpacing);

	onProgress("Running reflow audit");
	const reflow = await runReflowAudit(adaptors.reflow, options.reflow);

	// The escape attempts can dismiss an overlay or load another document, so every audit that
	// measures the page as loaded runs before them.
	onProgress("Trying keyboard exits from a focus cycle");
	const keyboardTrap = await verifyKeyboardTrap();

	const merged = mergeOutputs([
		axeResults,
		filenameAltTextToAxe(filenameAltText),
		orphanedTabRolesToAxe(orphanedTabRoles),
		...tabAudits,
		keyboardTrap,
		skipLinkToAxe(skipLink),
		textSpacingToAxe(textSpacing),
		reflowToAxe(reflow),
	]);

	return { ...axeResults, ...merged };
}
