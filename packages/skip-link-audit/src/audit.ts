import { getSelector, truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import type { ElementRef, SkipLinkAuditAdaptor } from "./adaptor";
import {
	activeElementHandleScript,
	focusScript,
	isFocusInsideTargetScript,
	probeActiveElementScript,
} from "./browser-scripts";
import type { SkipLinkElementResult, SkipLinkResult } from "./result";

export const DEFAULT_CANDIDATE_LIMIT = 3;
export const DEFAULT_ACTIVATION_POLL_MS = 250;

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
	targetResolves: boolean;
	handle: ElementRef;
};

export type TabStopProbe = {
	isBody: boolean;
	/** Unique identity of the focused element, used to detect a focus cycle. */
	identity: string;
	candidate: SkipLinkCandidate | null;
};

/** The browser-coupled seams the loop drives. Mocked in unit tests. */
export type SkipLinkProbe = {
	pressTab(): Promise<void>;
	pressEnter(): Promise<void>;
	probeTabStop(): Promise<TabStopProbe>;
	focusHandle(ref: ElementRef): Promise<void>;
	isFocusInsideTarget(fragment: string): Promise<boolean>;
	disposeRef(ref: ElementRef): Promise<void>;
};

function resolveOptions(options: SkipLinkOptions): ResolvedSkipLinkOptions {
	return {
		candidateLimit: options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
		activationPollMs: DEFAULT_ACTIVATION_POLL_MS,
	};
}

/**
 * Tab through the first few stops looking for skip-link-like fragment anchors,
 * then activate each candidate and check that keyboard focus moves. Enables
 * focus reporting up front, then drives the loop.
 */
export async function runSkipLinkAudit(
	adaptor: SkipLinkAuditAdaptor,
	options: SkipLinkOptions = {},
): Promise<SkipLinkResult> {
	await adaptor.ensureFocusReporting();

	return runSkipLinkLoop(createAdaptorProbe(adaptor), resolveOptions(options));
}

/** The engine-neutral two-phase loop. Exported for unit testing with a fake probe. */
export async function runSkipLinkLoop(
	probe: SkipLinkProbe,
	options: ResolvedSkipLinkOptions,
): Promise<SkipLinkResult> {
	const collected: Array<SkipLinkCandidate & { tabIndex: number }> = [];
	const seen = new Set<string>();

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

	const skipLinks: SkipLinkElementResult[] = [];

	for (const found of collected) {
		try {
			if (!found.targetResolves) {
				skipLinks.push({
					selector: found.selector,
					html: found.html,
					fragment: found.fragment,
					tabIndex: found.tabIndex,
					passed: false,
					failureReason: "target-missing",
				});
				continue;
			}

			await probe.focusHandle(found.handle);
			await probe.pressEnter();

			let passed = await pollFocusInsideTarget(
				probe,
				found.fragment,
				options.activationPollMs,
			);

			if (!passed) {
				await probe.pressTab();
				passed = await probe.isFocusInsideTarget(found.fragment);
			}

			skipLinks.push({
				selector: found.selector,
				html: found.html,
				fragment: found.fragment,
				tabIndex: found.tabIndex,
				passed,
				failureReason: passed ? null : "activation-no-effect",
			});
		} finally {
			await probe.disposeRef(found.handle);
		}
	}

	const passed = skipLinks.filter((link) => link.passed).length;

	return {
		skipLinks,
		summary: {
			found: skipLinks.length,
			passed,
			failed: skipLinks.length - passed,
		},
	};
}

async function pollFocusInsideTarget(
	probe: SkipLinkProbe,
	fragment: string,
	pollMs: number,
): Promise<boolean> {
	if (await probe.isFocusInsideTarget(fragment)) {
		return true;
	}

	if (pollMs <= 0) {
		return false;
	}

	const deadline = Date.now() + pollMs;

	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 16));

		if (await probe.isFocusInsideTarget(fragment)) {
			return true;
		}
	}

	return false;
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
			const base = await adaptor.evaluate(probeActiveElementScript);

			if (base.isBody) {
				return { isBody: true, identity: "body", candidate: null };
			}

			const handle = await adaptor.evaluateHandle(activeElementHandleScript);
			const selector = await adaptor.evaluate(getSelector, handle);
			const html = truncateHtml(base.html);

			if (base.fragment) {
				return {
					isBody: false,
					identity: selector,
					candidate: {
						selector,
						html,
						fragment: base.fragment,
						targetResolves: base.targetResolves,
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

		isFocusInsideTarget(fragment) {
			return adaptor.evaluate(isFocusInsideTargetScript, fragment);
		},

		disposeRef(ref) {
			return adaptor.disposeRef(ref);
		},
	};
}
