import { PuppeteerAdaptor as SkipLinkAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
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
import { type ReflowOptions, type ReflowResult, runReflowAudit } from "@a11y-pulse/reflow-audit";
import { PuppeteerAdaptor as ReflowAdaptor } from "@a11y-pulse/reflow-audit/puppeteer";
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
import { PuppeteerAdaptor as TabAdaptor } from "@a11y-pulse/tab-orchestrator/puppeteer";
import {
	runTextSpacingAudit,
	type TextSpacingOptions,
	type TextSpacingResult,
} from "@a11y-pulse/text-spacing-audit";
import { PuppeteerAdaptor as TextSpacingAdaptor } from "@a11y-pulse/text-spacing-audit/puppeteer";
import type { Page } from "puppeteer";

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
	page: Page,
	options: AuditRunnerOptions,
): Promise<SharedSessionResults> {
	const focusAppearance = createFocusAppearanceAudit(options.focusAppearance);
	const focusNotObscured = createFocusNotObscuredAudit(options.focusNotObscured);
	const contextChangeOnFocus = createContextChangeOnFocusAudit(options.contextChangeOnFocus);

	const orchestrator = createTabOrchestrator(new TabAdaptor(page), widestSessionOptions(options));
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

/**
 * Run every A11y Pulse audit against an already-loaded page.
 */
export async function runAllAudits(
	page: Page,
	options: AuditRunnerOptions = {},
): Promise<AuditRunnerResult> {
	const url = page.url();

	const sharedSession = await runTabAuditsInSharedSession(page, options);

	await page.evaluate(blurAndScrollToTopScript);
	const skipLink = await runSkipLinkAudit(new SkipLinkAdaptor(page), options.skipLink);

	await page.evaluate(blurAndScrollToTopScript);
	const textSpacing = await runTextSpacingAudit(new TextSpacingAdaptor(page), options.textSpacing);

	const reflow = await runReflowAudit(new ReflowAdaptor(page), options.reflow);

	return {
		url,
		audits: { ...sharedSession, skipLink, textSpacing, reflow },
	};
}
