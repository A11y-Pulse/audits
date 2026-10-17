import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { getSelector } from "@a11y-pulse/browser-adaptor/dom";
import {
	type ActiveElementInfo,
	type TabSessionHandle,
	tabPreventedScript,
} from "@a11y-pulse/tab-orchestrator";
import { describe, expect, it, vi } from "vitest";
import { createKeyboardTrapAudit, type EscapeKey, type KeyboardTrapOptions } from "./audit";
import {
	clearContainerScript,
	containerHtmlScript,
	type FocusProbe,
	focusSelectorScript,
	inspectRingScript,
	probeFocusScript,
	type RingInspection,
} from "./browser-scripts";

const EMPTY_STYLES = { element: {}, before: {}, after: {} };

function active(index: number | null): ActiveElementInfo {
	return {
		index,
		isBody: false,
		isIframe: false,
		selector: `#e${index}`,
		html: `<button id="e${index}">`,
		styles: EMPTY_STYLES,
		rect: { x: 0, y: 0, width: 10, height: 10 },
	};
}

const session: TabSessionHandle = {
	disconnect: vi.fn(),
	ensureUnfocusedPair: vi.fn(),
	screenshotClip: vi.fn(),
};

const PAGE_URL = "https://example.test/";

const TRAPPED: FocusProbe = { member: 0, containerVisible: true, href: PAGE_URL };

const FREED: FocusProbe = { member: -1, containerVisible: true, href: PAGE_URL };

function inspection(
	overrides: Partial<Extract<RingInspection, { resolved: true }>> = {},
): RingInspection {
	return {
		resolved: true,
		excludedCount: 3,
		shutOutCount: 0,
		containerIsRoot: false,
		tags: [],
		arrowSafe: [false],
		escapeIndex: 0,
		atStart: false,
		atEnd: false,
		...overrides,
	};
}

type FakePage = {
	inspection?: RingInspection;
	/** The probe after each key press. Stays trapped unless this returns a different state. */
	afterKey?: (key: EscapeKey, keys: EscapeKey[]) => FocusProbe | undefined;
	/** The probe straight after the audit focuses a ring member by script. */
	afterFocus?: () => FocusProbe;
	/** The page cancels every Tab and Shift+Tab. */
	tabPrevented?: boolean;
};

function fakeAdaptor(page: FakePage = {}): BrowserAdaptor & {
	keys: EscapeKey[];
	cleared: boolean;
} {
	let state = TRAPPED;
	const adaptor = {
		keys: [] as EscapeKey[],
		cleared: false,
		evaluate: (async (fn: unknown) => {
			if (fn === inspectRingScript) {
				return page.inspection ?? inspection();
			}

			if (fn === getSelector) {
				return "#widget";
			}

			if (fn === containerHtmlScript) {
				return '<div id="widget">';
			}

			if (fn === focusSelectorScript) {
				state = page.afterFocus?.() ?? TRAPPED;

				return true;
			}

			if (fn === probeFocusScript) {
				return state;
			}

			if (fn === tabPreventedScript) {
				return page.tabPrevented ?? false;
			}

			if (fn === clearContainerScript) {
				adaptor.cleared = true;
			}

			return undefined;
		}) as BrowserAdaptor["evaluate"],
		evaluateHandle: async () => ({}),
		disposeRef: async () => {},
		pressTab: async () => {},
		pressEnter: async () => {},
		screenshotClip: async () => new Uint8Array(),
		ensureFocusReporting: async () => {},
		async pressKey(key: EscapeKey) {
			adaptor.keys.push(key);
			state = page.afterKey?.(key, adaptor.keys) ?? state;
		},
	};

	return adaptor;
}

function runSession(
	indexes: Array<number | null>,
	end: { reason?: "completed" | "lostFocus"; revisitedIndex?: number | null } = {},
	options: KeyboardTrapOptions = {},
) {
	const audit = createKeyboardTrapAudit({ screenshotSettleDelay: 0, ...options });
	audit.onSessionStart?.(session);

	indexes.forEach((index, i) => {
		audit.onTabStop({ tabIndex: i + 1, activeElement: active(index) }, session);
	});

	audit.onSessionEnd?.(end.reason ?? "completed", { revisitedIndex: end.revisitedIndex ?? null });

	return audit;
}

/** Runs the escape protocol's settle and poll waits on fake timers, so no test sleeps. */
async function verify(audit: ReturnType<typeof createKeyboardTrapAudit>, adaptor: BrowserAdaptor) {
	vi.useFakeTimers();

	try {
		const result = audit.verify(adaptor);
		await vi.runAllTimersAsync();

		return await result;
	} finally {
		vi.useRealTimers();
	}
}

describe("createKeyboardTrapAudit", () => {
	it("reports a page with nothing focusable", async () => {
		const result = await verify(runSession([]), fakeAdaptor());

		expect(result.outcome).toBe("no-focusable");
	});

	it("passes a traversal that tabs off the end of the page without touching it", async () => {
		const adaptor = fakeAdaptor();
		const result = await verify(runSession([0, 1, 2]), adaptor);

		expect(result.outcome).toBe("no-cycle");
		expect(result.summary).toMatchObject({ checked: 3, passed: 1, failed: 0 });
		expect(adaptor.keys).toEqual([]);
	});

	it("treats a session that lost focus as inconclusive", async () => {
		const result = await verify(runSession([0, 1], { reason: "lostFocus" }), fakeAdaptor());

		expect(result.outcome).toBe("inconclusive");
		expect(result.summary.sessionEnd).toBe("lostFocus");
	});

	it("treats a session it cut short at the element limit as inconclusive", async () => {
		const audit = runSession([0, 1, 2], {}, { elementLimit: 2 });
		const result = await verify(audit, fakeAdaptor());

		expect(result.outcome).toBe("inconclusive");
		expect(result.summary.reachedLimit).toBe(true);
		expect(session.disconnect).toHaveBeenCalled();
	});

	it("passes a cycle through every tabbable element as a small tab ring", async () => {
		const adaptor = fakeAdaptor({ inspection: inspection({ excludedCount: 0 }) });
		const result = await verify(runSession([0, 1, 2], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("small-ring");
		expect(adaptor.keys).toEqual([]);
	});

	it("treats a cycle scattered across the whole document as inconclusive", async () => {
		const adaptor = fakeAdaptor({ inspection: inspection({ containerIsRoot: true }) });
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
		expect(adaptor.keys).toEqual([]);
	});

	it("treats a cycle whose members can no longer be found as inconclusive", async () => {
		const adaptor = fakeAdaptor({ inspection: { resolved: false } });
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
	});

	it("treats selectors that now name different elements as inconclusive", async () => {
		const adaptor = fakeAdaptor({ inspection: inspection({ tags: ["div", "div"] }) });
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
		expect(adaptor.keys).toEqual([]);
	});

	it("treats a selector that now names a shorter tag with the same prefix as inconclusive", async () => {
		const adaptor = fakeAdaptor({ inspection: inspection({ tags: ["b", "b"] }) });
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
		expect(adaptor.keys).toEqual([]);
	});

	it("tries the exits from a modal that shuts out the rest of the page", async () => {
		const adaptor = fakeAdaptor({
			inspection: inspection({ excludedCount: 0, shutOutCount: 2 }),
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("trapped");
		expect(result.excludedCount).toBe(2);
		expect(adaptor.keys).toContain("Escape");
	});

	it("passes a whole-page cycle around content shut out by inert as a small tab ring", async () => {
		const adaptor = fakeAdaptor({
			inspection: inspection({ excludedCount: 0, shutOutCount: 2, containerIsRoot: true }),
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("small-ring");
		expect(adaptor.keys).toEqual([]);
	});

	it("passes a trapping dialog that Escape dismisses", async () => {
		const adaptor = fakeAdaptor({
			afterKey: (key) => (key === "Escape" ? { ...TRAPPED, containerVisible: false } : undefined),
		});
		const result = await verify(runSession([0, 1, 2, 3], { revisitedIndex: 2 }), adaptor);

		expect(result.outcome).toBe("escaped");
		expect(result.escapedVia).toBe("escape-key");
		expect(result.roundsAttempted).toBe(1);
		expect(result.ring.map((element) => element.selector)).toEqual(["#e2", "#e3"]);
		expect(result.container).toEqual({ selector: "#widget", html: '<div id="widget">' });
	});

	it("skips Escape when every member is a field Escape would clear", async () => {
		const adaptor = fakeAdaptor({ inspection: inspection({ escapeIndex: -1 }) });
		await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(adaptor.keys).not.toContain("Escape");
	});

	it("passes a forward-only cycle that Shift+Tab leaves", async () => {
		const adaptor = fakeAdaptor({
			afterKey: (key) => (key === "Shift+Tab" ? FREED : undefined),
		});
		const result = await verify(runSession([0, 1, 2], { revisitedIndex: 1 }), adaptor);

		expect(result.outcome).toBe("escaped");
		expect(result.escapedVia).toBe("shift-tab");
		expect(adaptor.keys).toEqual(["Escape", "Shift+Tab"]);
	});

	it("passes a ring at the start of the page when Shift+Tab leaves focus put, uncancelled", async () => {
		const adaptor = fakeAdaptor({ inspection: inspection({ atStart: true }) });
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("escaped");
		expect(result.escapedVia).toBe("shift-tab");
	});

	it("does not mistake a move between members at the edge of the page for leaving it", async () => {
		// Every Tab and Shift+Tab moves focus to the other member, natively and uncancelled.
		let member = 0;
		const adaptor = fakeAdaptor({
			inspection: inspection({ atStart: true, atEnd: true }),
			afterFocus: () => {
				member = 0;

				return TRAPPED;
			},
			afterKey: (key) => {
				if (key !== "Shift+Tab" && key !== "Tab") {
					return undefined;
				}

				member = 1 - member;

				return { ...TRAPPED, member };
			},
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("trapped");
	});

	it("still reports a ring at the edge of the page when the page cancels Tab", async () => {
		const adaptor = fakeAdaptor({
			inspection: inspection({ atStart: true, atEnd: true }),
			tabPrevented: true,
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("trapped");
	});

	it("passes a cycle that an arrow key then Tab leaves", async () => {
		const adaptor = fakeAdaptor({
			inspection: inspection({ arrowSafe: [true] }),
			afterKey: (key, keys) => (key === "Tab" && keys.at(-2) === "ArrowDown" ? FREED : undefined),
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 1 }), adaptor);

		expect(result.outcome).toBe("escaped");
		expect(result.escapedVia).toBe("arrow-key");
	});

	it("never presses an arrow key where it would change a value", async () => {
		const adaptor = fakeAdaptor({ inspection: inspection({ arrowSafe: [false] }) });
		await verify(runSession([0, 1], { revisitedIndex: 1 }), adaptor);

		expect(adaptor.keys.filter((key) => key.startsWith("Arrow"))).toEqual([]);
	});

	it("reports a trap when no exit frees focus across every round, then cleans up", async () => {
		const adaptor = fakeAdaptor();
		const result = await verify(runSession([0, 1, 2], { revisitedIndex: 2 }), adaptor);

		expect(result.outcome).toBe("trapped");
		expect(result.escapedVia).toBeNull();
		expect(result.roundsAttempted).toBe(2);
		expect(result.excludedCount).toBe(3);
		expect(result.summary).toMatchObject({ passed: 0, failed: 1 });
		expect(adaptor.keys).not.toContain("Enter");
		expect(adaptor.cleared).toBe(true);
	});

	it("passes when Tab leaves the ring after the other exits have failed", async () => {
		const adaptor = fakeAdaptor({
			afterKey: (key, keys) =>
				key === "Tab" && keys.filter((k) => k === "Tab").length === 2 ? FREED : undefined,
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 1 }), adaptor);

		expect(result.outcome).toBe("escaped");
		expect(result.escapedVia).toBe("tab");
		expect(result.roundsAttempted).toBe(1);
	});

	it("passes a ring that only frees focus in the second round", async () => {
		const adaptor = fakeAdaptor({
			afterKey: (key, keys) =>
				key === "Escape" && keys.filter((k) => k === "Escape").length === 2
					? { ...TRAPPED, containerVisible: false }
					: undefined,
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("escaped");
		expect(result.roundsAttempted).toBe(2);
	});

	it("treats a key press that loads another page as inconclusive, and still cleans up", async () => {
		const adaptor = fakeAdaptor({
			afterKey: (key) =>
				key === "Escape" ? { ...TRAPPED, href: "https://example.test/elsewhere" } : undefined,
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
		expect(adaptor.cleared).toBe(true);
	});

	it("treats a ring that stops holding focus as inconclusive", async () => {
		const adaptor = fakeAdaptor({ afterFocus: () => FREED });
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
	});

	it("caps the reported ring members but counts them all", async () => {
		const indexes = Array.from({ length: 15 }, (_, i) => i);
		const result = await verify(runSession(indexes, { revisitedIndex: 0 }), fakeAdaptor());

		expect(result.ring).toHaveLength(10);
		expect(result.ringSize).toBe(15);
	});
});
