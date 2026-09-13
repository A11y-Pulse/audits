import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import {
	type ContextChangeOnFocusOptions,
	createContextChangeOnFocusAudit,
} from "@a11y-pulse/context-change-on-focus-audit";
import {
	createFocusAppearanceAudit,
	type FocusAppearanceOptions,
} from "@a11y-pulse/focus-appearance-audit";
import {
	createFocusNotObscuredAudit,
	type FocusNotObscuredOptions,
} from "@a11y-pulse/focus-not-obscured-audit";
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
import { focusAppearanceToAxe } from "./to-axe/focus-appearance";
import { focusNotObscuredToAxe } from "./to-axe/focus-not-obscured";
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

export type AuditRunnerOptions = {
	axe?: AxeRunOptions;
	focusAppearance?: FocusAppearanceOptions;
	focusNotObscured?: FocusNotObscuredOptions;
	contextChangeOnFocus?: ContextChangeOnFocusOptions;
	skipLink?: SkipLinkOptions;
	textSpacing?: TextSpacingOptions;
	reflow?: ReflowOptions;
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
		),
		baselineElementLimit: appearance.baselineElementLimit ?? appearanceElementLimit * 2,
		screenshotSettleDelay: Math.max(
			appearance.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
			options.focusNotObscured?.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
			options.contextChangeOnFocus?.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		),
		screenshotClipBuffer: appearance.screenshotClipBuffer,
	};
}

async function runTabAuditsInSharedSession(
	adaptor: BrowserAdaptor,
	options: AuditRunnerOptions,
): Promise<AuditOutput[]> {
	const focusAppearance = createFocusAppearanceAudit(options.focusAppearance);
	const focusNotObscured = createFocusNotObscuredAudit(options.focusNotObscured);
	const contextChangeOnFocus = createContextChangeOnFocusAudit(options.contextChangeOnFocus);

	const orchestrator = createTabOrchestrator(adaptor, widestSessionOptions(options));
	orchestrator.attach(focusAppearance);
	orchestrator.attach(focusNotObscured);
	orchestrator.attach(contextChangeOnFocus);

	await orchestrator.run();

	return [
		focusAppearanceToAxe(focusAppearance.result),
		focusNotObscuredToAxe(focusNotObscured.result),
		contextChangeOnFocusToAxe(contextChangeOnFocus.result),
	];
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

	const axeResults = await runAxeCore(browser, options.axe);

	const tabAudits = await runTabAuditsInSharedSession(browser, options);

	await browser.evaluate(blurAndScrollToTopScript);
	const skipLink = await runSkipLinkAudit(browser, options.skipLink);

	await browser.evaluate(blurAndScrollToTopScript);
	const textSpacing = await runTextSpacingAudit(adaptors.textSpacing, options.textSpacing);

	const reflow = await runReflowAudit(adaptors.reflow, options.reflow);

	const merged = mergeOutputs([
		axeResults,
		...tabAudits,
		skipLinkToAxe(skipLink),
		textSpacingToAxe(textSpacing),
		reflowToAxe(reflow),
	]);

	return { ...axeResults, ...merged };
}
