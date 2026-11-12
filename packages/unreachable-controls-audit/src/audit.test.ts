import { getSelector } from "@a11y-pulse/browser-adaptor/dom";
import type {
	ActiveElementInfo,
	SessionEndReason,
	TabSessionHandle,
} from "@a11y-pulse/tab-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ElementInspection, UnreachableControlsAdaptor } from "./adaptor";
import { createUnreachableControlsAudit, type UnreachableControlsOptions } from "./audit";
import {
	type CollectedCandidates,
	collectCandidatesScript,
	type RawCandidate,
} from "./browser-scripts";

const PAGE_URL = "https://example.test/";

function session(): TabSessionHandle {
	return { disconnect: vi.fn(), ensureUnfocusedPair: vi.fn(), screenshotClip: vi.fn() };
}

function stop(index: number): ActiveElementInfo {
	return {
		index,
		isBody: false,
		isIframe: false,
		selector: `#s${index}`,
		html: `<a id="s${index}">`,
		styles: { element: {}, before: {}, after: {} },
		rect: { x: 0, y: index * 20, width: 100, height: 20 },
	};
}

function candidate(index: number, overrides: Partial<RawCandidate> = {}): RawCandidate {
	return {
		index,
		kind: "unreached",
		html: `<div id="c${index}" class="card"></div>`,
		tag: "div",
		role: null,
		widgetRole: false,
		handlers: [],
		cursorPointer: false,
		cursorSetHere: false,
		tabindex: null,
		roving: false,
		hiddenControlLabel: false,
		focusedAt: null,
		customElement: false,
		backdrop: false,
		containerLike: false,
		holdsTabbable: false,
		parent: null,
		text: `Candidate ${index}`,
		...overrides,
	};
}

type Fake = UnreachableControlsAdaptor & {
	collectArgs: unknown[][];
	released: number;
	inspectArgs: unknown[][];
};

/**
 * An adaptor whose page scan returns `candidates`. Selectors come back as `#c<index>` for whichever
 * stashed element was picked last.
 */
function fakeAdaptor(
	candidates: RawCandidate[] | Error,
	extra: {
		inspect?: (count: number) => Promise<ElementInspection[] | null>;
		href?: string;
		truncated?: boolean;
	} = {},
): Fake {
	let picked = -1;
	const fake: Fake = {
		collectArgs: [],
		released: 0,
		inspectArgs: [],
		evaluate: (async (fn: { name: string }, ...args: unknown[]) => {
			if (fn === collectCandidatesScript) {
				fake.collectArgs.push(args);

				if (candidates instanceof Error) {
					throw candidates;
				}

				const collected: CollectedCandidates = {
					candidates,
					truncated: extra.truncated ?? false,
					focusedResolved: 0,
					href: extra.href ?? PAGE_URL,
				};

				return collected;
			}

			if (fn === getSelector) {
				return `#c${picked}`;
			}

			if (fn.name === "pickStashedScript") {
				picked = args[1] as number;
			}

			if (fn.name === "releaseStashScript") {
				fake.released++;
			}

			return undefined;
		}) as UnreachableControlsAdaptor["evaluate"],
		evaluateHandle: async () => ({}),
		disposeRef: async () => {},
		pressTab: async () => {},
		pressEnter: async () => {},
		pressKey: async () => {},
		screenshotClip: async () => new Uint8Array(),
		ensureFocusReporting: async () => {},
	};

	if (extra.inspect) {
		const inspect = extra.inspect;

		fake.inspectElements = async (...args) => {
			fake.inspectArgs.push(args);

			return inspect(args[1]);
		};
	}

	return fake;
}

/** An audit that has seen `stops` tab stops and a session ending with `reason`. */
function auditAfter(
	stops: number,
	reason: SessionEndReason = "completed",
	options: UnreachableControlsOptions = {},
) {
	const audit = createUnreachableControlsAudit(options);
	const handle = session();

	audit.onSessionStart?.(handle);

	for (let index = 1; index <= stops; index++) {
		audit.onTabStop({ tabIndex: index, activeElement: stop(index) }, handle);
	}

	audit.onSessionEnd?.(reason, { revisitedIndex: null });

	return { audit, handle };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("createUnreachableControlsAudit", () => {
	it("declares no capabilities, so it adds nothing to the shared pass", () => {
		expect(createUnreachableControlsAudit().capabilities.size).toBe(0);
	});

	it("hands the scan every stop's selector and reports what it finds", async () => {
		const { audit } = auditAfter(2);
		const adaptor = fakeAdaptor([
			candidate(0, { handlers: ["onclick"], cursorPointer: true }),
			candidate(1),
		]);
		const result = await audit.analyse(adaptor, PAGE_URL);

		expect(adaptor.collectArgs[0]?.[0]).toEqual(["#s1", "#s2"]);
		expect(result.outcome).toBe("findings");
		expect(result.unreachable).toEqual([
			{
				selector: "#c0",
				html: '<div id="c0" class="card">',
				text: "Candidate 0",
				verdict: "failed",
				reason: "click-handler",
				signals: { listeners: ["click"], role: null, cursorPointer: true, tabindex: null },
			},
		]);
		expect(result.missingRole).toEqual([]);
		expect(result.summary).toMatchObject({ checked: 2, failed: 1, sessionEnd: "completed" });
		expect(result.listenersInspected).toBe(false);
	});

	it("is clean when the scan finds nothing to report", async () => {
		const { audit } = auditAfter(3);
		const result = await audit.analyse(fakeAdaptor([candidate(0)]), PAGE_URL);

		expect(result.outcome).toBe("clean");
		expect(result.inconclusiveReason).toBeUndefined();
	});

	it("still scans a page where nothing took focus", async () => {
		const { audit } = auditAfter(0);
		const result = await audit.analyse(fakeAdaptor([candidate(0, { handlers: ["onclick"] })]));

		expect(result.unreachable.map((control) => control.selector)).toEqual(["#c0"]);
	});

	it.each(["limit", "stuck", "navigation", "lostFocus", "failed"] as const)(
		"is inconclusive, without scanning, when the session ended with %s",
		async (reason) => {
			const { audit } = auditAfter(2, reason);
			const adaptor = fakeAdaptor([candidate(0, { handlers: ["onclick"] })]);
			const result = await audit.analyse(adaptor, PAGE_URL);

			expect(result.outcome).toBe("inconclusive");
			expect(result.inconclusiveReason).toBe("session-ended-early");
			expect(result.unreachable).toEqual([]);
			expect(adaptor.collectArgs).toEqual([]);
		},
	);

	it("disconnects at its element limit and is then inconclusive", async () => {
		const { audit, handle } = auditAfter(2, "completed", { elementLimit: 2 });
		const result = await audit.analyse(fakeAdaptor([candidate(0, { handlers: ["onclick"] })]));

		expect(handle.disconnect).toHaveBeenCalledTimes(1);
		expect(result.summary.reachedLimit).toBe(true);
		expect(result.summary.sessionEnd).toBeNull();
		expect(result.inconclusiveReason).toBe("element-limit");
	});

	it("is inconclusive when its timeout cuts the pass short", async () => {
		vi.useFakeTimers();

		const audit = createUnreachableControlsAudit({ timeout: 50 });
		const handle = session();

		audit.onSessionStart?.(handle);
		audit.onTabStop({ tabIndex: 1, activeElement: stop(1) }, handle);
		vi.advanceTimersByTime(50);
		audit.onSessionEnd?.("completed", { revisitedIndex: null });

		const result = await audit.analyse(fakeAdaptor([]));

		expect(handle.disconnect).toHaveBeenCalledTimes(1);
		expect(result.summary.timedOut).toBe(true);
		expect(result.inconclusiveReason).toBe("timeout");
	});

	it("is inconclusive when the page is no longer the one that was tabbed through", async () => {
		const { audit } = auditAfter(2);
		const adaptor = fakeAdaptor([candidate(0, { handlers: ["onclick"] })], {
			href: "https://example.test/elsewhere",
		});
		const result = await audit.analyse(adaptor, PAGE_URL);

		expect(result.inconclusiveReason).toBe("navigated");
		expect(result.unreachable).toEqual([]);
		expect(adaptor.released).toBe(1);
	});

	it("is inconclusive when the scan throws", async () => {
		const { audit } = auditAfter(2);
		const result = await audit.analyse(fakeAdaptor(new Error("execution context destroyed")));

		expect(result.inconclusiveReason).toBe("scan-failed");
	});

	it("asks for unsignalled elements only when the adaptor can inspect them", async () => {
		const plain = fakeAdaptor([]);
		const inspecting = fakeAdaptor([], { inspect: async () => [] });

		await auditAfter(1).audit.analyse(plain);
		await auditAfter(1).audit.analyse(inspecting);

		expect(plain.collectArgs[0]?.[3]).toBe(false);
		expect(inspecting.collectArgs[0]?.[3]).toBe(true);
	});

	it("uses the browser's listeners and roles, asking for roles of focused candidates only", async () => {
		const { audit } = auditAfter(2);
		const adaptor = fakeAdaptor(
			[candidate(0), candidate(1, { kind: "focused", tabindex: 0, focusedAt: 1 })],
			{
				inspect: async () => [
					{ listeners: ["click"], role: null },
					{ listeners: ["click", "keydown"], role: "generic" },
				],
			},
		);
		const result = await audit.analyse(adaptor, PAGE_URL);

		expect(adaptor.inspectArgs[0]?.slice(1)).toEqual([2, [1]]);
		expect(result.listenersInspected).toBe(true);
		expect(result.unreachable.map((control) => control.reason)).toEqual(["click-handler"]);
		expect(result.missingRole).toEqual([
			{
				selector: "#c1",
				html: '<div id="c1" class="card">',
				text: "Candidate 1",
				verdict: "failed",
				reason: "handler-without-role",
				signals: { listeners: ["click", "keydown"], role: null, cursorPointer: false, tabindex: 0 },
				computedRole: "generic",
				tabIndex: 2,
			},
		]);
	});

	it.each([
		["returns null", async () => null],
		[
			"throws",
			async () => {
				throw new Error("session closed");
			},
		],
	])("falls back on what the page shows when inspection %s", async (_, inspect) => {
		const { audit } = auditAfter(1);
		const result = await audit.analyse(
			fakeAdaptor([candidate(0, { handlers: ["onclick"] }), candidate(1)], { inspect }),
		);

		expect(result.listenersInspected).toBe(false);
		expect(result.unreachable.map((control) => control.selector)).toEqual(["#c0"]);
	});

	it("keeps failures ahead of reviews at the finding limit, in document order", async () => {
		const { audit } = auditAfter(1, "completed", { findingLimit: 2 });
		const result = await audit.analyse(
			fakeAdaptor([
				candidate(0, { cursorPointer: true, cursorSetHere: true }),
				candidate(1, { handlers: ["onclick"] }),
				candidate(2, { handlers: ["onclick"] }),
			]),
		);

		expect(result.unreachable.map((control) => control.selector)).toEqual(["#c1", "#c2"]);
		expect(result.truncated).toBe(true);
		expect(result.summary.failed).toBe(2);
	});

	it("is truncated when the scan hit its candidate limit", async () => {
		const { audit } = auditAfter(1, "completed", { candidateLimit: 7 });
		const adaptor = fakeAdaptor([], { truncated: true });
		const result = await audit.analyse(adaptor);

		expect(adaptor.collectArgs[0]?.[2]).toBe(7);
		expect(result.truncated).toBe(true);
	});

	it("orders missing roles by tab stop", async () => {
		const { audit } = auditAfter(3);
		const result = await audit.analyse(
			fakeAdaptor([
				candidate(0, { kind: "focused", focusedAt: 2, handlers: ["onclick"] }),
				candidate(1, { kind: "focused", focusedAt: 0, handlers: ["onclick"] }),
			]),
		);

		expect(result.missingRole.map((control) => [control.selector, control.tabIndex])).toEqual([
			["#c1", 1],
			["#c0", 3],
		]);
	});

	it("removes its stash from the page afterwards", async () => {
		const { audit } = auditAfter(1);
		const adaptor = fakeAdaptor([candidate(0, { handlers: ["onclick"] })]);

		await audit.analyse(adaptor);

		expect(adaptor.released).toBe(1);
	});
});
