import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import {
	type ContextChangeOnFocusOptions,
	type ContextChangeOnFocusResult,
	createContextChangeOnFocusAudit,
} from "@a11y-pulse/context-change-on-focus-audit";
import {
	createFocusAppearanceAudit,
	type FocusAppearanceOptions,
	type FocusAppearanceResult,
} from "@a11y-pulse/focus-appearance-audit";
import {
	createFocusNotObscuredAudit,
	type FocusNotObscuredOptions,
	type FocusNotObscuredResult,
} from "@a11y-pulse/focus-not-obscured-audit";
import {
	type ReflowAuditAdaptor,
	type ReflowOptions,
	type ReflowResult,
	runReflowAudit,
} from "@a11y-pulse/reflow-audit";
import {
	runSkipLinkAudit,
	type SkipLinkOptions,
	type SkipLinkResult,
} from "@a11y-pulse/skip-link-audit";
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
	type TextSpacingResult,
} from "@a11y-pulse/text-spacing-audit";

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
	focusAppearance?: FocusAppearanceOptions;
	focusNotObscured?: FocusNotObscuredOptions;
	contextChangeOnFocus?: ContextChangeOnFocusOptions;
	skipLink?: SkipLinkOptions;
	textSpacing?: TextSpacingOptions;
	reflow?: ReflowOptions;
};

export type AuditResults = {
	focusAppearance: FocusAppearanceResult;
	focusNotObscured: FocusNotObscuredResult;
	contextChangeOnFocus: ContextChangeOnFocusResult;
	skipLink: SkipLinkResult;
	textSpacing: TextSpacingResult;
	reflow: ReflowResult;
};

export type AuditRunnerResult = {
	url: string;
	audits: AuditResults;
};

type SharedSessionResults = Pick<
	AuditResults,
	"focusAppearance" | "focusNotObscured" | "contextChangeOnFocus"
>;

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
): Promise<SharedSessionResults> {
	const focusAppearance = createFocusAppearanceAudit(options.focusAppearance);
	const focusNotObscured = createFocusNotObscuredAudit(options.focusNotObscured);
	const contextChangeOnFocus = createContextChangeOnFocusAudit(options.contextChangeOnFocus);

	const orchestrator = createTabOrchestrator(adaptor, widestSessionOptions(options));
	orchestrator.attach(focusAppearance);
	orchestrator.attach(focusNotObscured);
	orchestrator.attach(contextChangeOnFocus);

	await orchestrator.run();

	return {
		focusAppearance: focusAppearance.result,
		focusNotObscured: focusNotObscured.result,
		contextChangeOnFocus: contextChangeOnFocus.result,
	};
}

function blurAndScrollToTopScript(): void {
	(document.activeElement as HTMLElement | null)?.blur();
	window.scrollTo(0, 0);
}

function locationHrefScript(): string {
	return window.location.href;
}

/**
 * Run every A11y Pulse audit against an already-loaded page.
 */
export async function runAllAudits(
	adaptors: AuditAdaptors,
	options: AuditRunnerOptions = {},
): Promise<AuditRunnerResult> {
	const { browser } = adaptors;
	const url = await browser.evaluate(locationHrefScript);

	const sharedSession = await runTabAuditsInSharedSession(browser, options);

	await browser.evaluate(blurAndScrollToTopScript);
	const skipLink = await runSkipLinkAudit(browser, options.skipLink);

	await browser.evaluate(blurAndScrollToTopScript);
	const textSpacing = await runTextSpacingAudit(adaptors.textSpacing, options.textSpacing);

	const reflow = await runReflowAudit(adaptors.reflow, options.reflow);

	return {
		url,
		audits: { ...sharedSession, skipLink, textSpacing, reflow },
	};
}
