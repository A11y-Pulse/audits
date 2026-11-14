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
	escapeIgnoredScript,
	type FocusProbe,
	focusOutsideScript,
	focusSelectorScript,
	inspectRingScript,
	leaveOutsideScript,
	outsideOpenedScript,
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

const TRAPPED: FocusProbe = {
	member: 0,
	containerVisible: true,
	href: PAGE_URL,
	landed: '<button id="e0">',
};

const FREED: FocusProbe = {
	member: -1,
	containerVisible: true,
	href: PAGE_URL,
	landed: '<a id="outside" href="#">',
};

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
	/**
	 * Whether focus given to an element outside the ring stays there. Unset when the page has no
	 * such element.
	 */
	outsideHolds?: boolean;
	/** The elements outside the ring were there at inspection and have since gone for good. */
	outsideGone?: boolean;
	/** Giving the element outside the ring focus made the page show something. */
	outsideOpened?: boolean;
	/** The page visibly did nothing with Escape. */
	escapeIgnored?: boolean;
};

function fakeAdaptor(page: FakePage = {}): BrowserAdaptor & {
	keys: EscapeKey[];
	cleared: boolean;
	probes: number;
	focused: number[];
	/** What had been pressed each time the element outside the ring was left again. */
	leftOutsideAfter: EscapeKey[][];
} {
	let state = TRAPPED;
	const adaptor = {
		keys: [] as EscapeKey[],
		cleared: false,
		probes: 0,
		focused: [] as number[],
		leftOutsideAfter: [] as EscapeKey[][],
		evaluate: (async (fn: unknown, ...args: unknown[]) => {
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
				adaptor.focused.push(args[1] as number);
				state = page.afterFocus?.() ?? TRAPPED;

				return true;
			}

			if (fn === focusOutsideScript) {
				if (page.outsideGone) {
					return "gone";
				}

				if (page.outsideHolds === undefined) {
					return "none";
				}

				state = page.outsideHolds ? FREED : TRAPPED;

				return "focused";
			}

			if (fn === outsideOpenedScript) {
				return page.outsideOpened ?? false;
			}

			if (fn === leaveOutsideScript) {
				adaptor.leftOutsideAfter.push([...adaptor.keys]);

				return undefined;
			}

			if (fn === escapeIgnoredScript) {
				return page.escapeIgnored ?? false;
			}

			if (fn === probeFocusScript) {
				adaptor.probes++;

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
	end: {
		reason?: "completed" | "lostFocus" | "stuck";
		revisitedIndex?: number | null;
		stuckIn?: { selector: string; html: string };
	} = {},
	options: KeyboardTrapOptions = {},
) {
	const audit = createKeyboardTrapAudit({ screenshotSettleDelay: 0, ...options });
	audit.onSessionStart?.(session);

	indexes.forEach((index, i) => {
		audit.onTabStop({ tabIndex: i + 1, activeElement: active(index) }, session);
	});

	audit.onSessionEnd?.(end.reason ?? "completed", {
		revisitedIndex: end.revisitedIndex ?? null,
		stuckIn: end.stuckIn ?? null,
	});

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
		expect(result.inconclusiveReason).toBe("session-ended");
		expect(result.summary.sessionEnd).toBe("lostFocus");
	});

	it("treats a session it cut short at the element limit as inconclusive", async () => {
		const audit = runSession([0, 1, 2], {}, { elementLimit: 2 });
		const result = await verify(audit, fakeAdaptor());

		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("element-limit");
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
		expect(result.inconclusiveReason).toBe("scattered-ring");
		expect(adaptor.keys).toEqual([]);
	});

	it("treats a cycle whose members can no longer be found as inconclusive", async () => {
		const adaptor = fakeAdaptor({ inspection: { resolved: false } });
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("ring-unresolved");
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
		// Tab moves from the first member to the second, and from there out of the ring.
		const adaptor = fakeAdaptor({
			afterKey: (key, keys) => {
				if (key !== "Tab") {
					return undefined;
				}

				return keys.filter((k) => k === "Tab").length === 2 ? FREED : { ...TRAPPED, member: 1 };
			},
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
		expect(result.inconclusiveReason).toBe("navigated");
		expect(adaptor.cleared).toBe(true);
	});

	it("treats a ring that stops holding focus as inconclusive", async () => {
		const adaptor = fakeAdaptor({ afterFocus: () => FREED });
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("ring-changed");
	});

	it("names the iframe focus never came back out of", async () => {
		const frame = { selector: "#booking", html: '<iframe id="booking" title="Booking">' };
		const adaptor = fakeAdaptor();
		const result = await verify(runSession([0], { reason: "stuck", stuckIn: frame }), adaptor);

		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("stuck-in-frame");
		expect(result.container).toEqual(frame);
		expect(adaptor.keys).toEqual([]);
	});

	it("does not count the page edge as a way out when the page pulls focus back on re-entry", async () => {
		const adaptor = fakeAdaptor({
			inspection: inspection({ atStart: true }),
			outsideHolds: false,
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("page-edge-only");
		expect(result.escapedVia).toBeNull();
		expect(result.roundsAttempted).toBe(2);
		expect(result.attempts.filter((attempt) => attempt.pageEdge).map(({ key }) => key)).toEqual([
			"Shift+Tab",
			"Shift+Tab",
		]);
	});

	it("treats focus left on nothing at the edge of the page as gone to the browser, not freed", async () => {
		// Chromium drops focus to the document when Shift+Tab leaves the first element of a page.
		const adaptor = fakeAdaptor({
			inspection: inspection({ atStart: true }),
			afterKey: (key) => (key === "Shift+Tab" ? { ...FREED, landed: null } : undefined),
			outsideHolds: false,
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("page-edge-only");
		expect(result.attempts.find((attempt) => attempt.key === "Shift+Tab")).toMatchObject({
			pageEdge: true,
			exited: false,
		});
	});

	it("still counts focus left on nothing as freed away from the edge of the page", async () => {
		const adaptor = fakeAdaptor({
			afterKey: (key) => (key === "Shift+Tab" ? { ...FREED, landed: null } : undefined),
			outsideHolds: false,
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("escaped");
		expect(result.escapedVia).toBe("shift-tab");
	});

	it("counts the page edge as a way out when focus can come back in at the other end", async () => {
		const adaptor = fakeAdaptor({
			inspection: inspection({ atEnd: true }),
			outsideHolds: true,
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("escaped");
		expect(result.escapedVia).toBe("tab");
		expect(result.attempts.at(-1)).toMatchObject({ key: "Tab", pageEdge: true, exited: true });
	});

	it("does not count the page edge as a way out when the elements outside the ring have gone since it was inspected", async () => {
		const adaptor = fakeAdaptor({
			inspection: inspection({ atStart: true }),
			outsideGone: true,
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("page-edge-only");
		expect(result.escapedVia).toBeNull();
	});

	it("leaves the element outside the ring again after focusing it, whether or not focus stayed there", async () => {
		const held = fakeAdaptor({ inspection: inspection({ atStart: true }), outsideHolds: true });
		await verify(runSession([0, 1], { revisitedIndex: 0 }), held);

		const pulledBack = fakeAdaptor({
			inspection: inspection({ atStart: true }),
			outsideHolds: false,
		});
		await verify(runSession([0, 1], { revisitedIndex: 0 }, { escapeAttemptRounds: 1 }), pulledBack);

		expect(held.leftOutsideAfter).toHaveLength(1);
		// Once for Shift+Tab off the start; Tab is not at an edge here.
		expect(pulledBack.leftOutsideAfter).toHaveLength(1);
	});

	it("presses Escape to close what the element outside the ring opened, before leaving it", async () => {
		const adaptor = fakeAdaptor({
			inspection: inspection({ atStart: true, escapeIndex: -1 }),
			outsideHolds: true,
			outsideOpened: true,
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("escaped");
		expect(result.escapedVia).toBe("shift-tab");
		// The Escape that tidies up is not one of the keys tried on the ring.
		expect(result.keysTried).toEqual(["Shift+Tab"]);
		expect(adaptor.keys).toEqual(["Shift+Tab", "Escape"]);
		expect(adaptor.leftOutsideAfter).toEqual([["Shift+Tab", "Escape"]]);
	});

	it("does not press Escape outside the ring when nothing opened, or when the page pulled focus back", async () => {
		const nothingOpened = fakeAdaptor({
			inspection: inspection({ atStart: true, escapeIndex: -1 }),
			outsideHolds: true,
		});
		await verify(runSession([0, 1], { revisitedIndex: 0 }), nothingOpened);

		const pulledBack = fakeAdaptor({
			inspection: inspection({ atStart: true, escapeIndex: -1 }),
			outsideHolds: false,
			outsideOpened: true,
		});
		await verify(runSession([0, 1], { revisitedIndex: 0 }), pulledBack);

		expect(nothingOpened.keys).not.toContain("Escape");
		expect(pulledBack.keys).not.toContain("Escape");
	});

	it("credits Escape, not the next key, when the container goes soon after a wait on Escape that was cut short", async () => {
		// The page showed no sign of handling Escape, and its dialog closed a moment later anyway.
		const adaptor = fakeAdaptor({
			escapeIgnored: true,
			afterKey: (key) => (key === "Shift+Tab" ? { ...FREED, containerVisible: false } : undefined),
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.outcome).toBe("escaped");
		expect(result.escapedVia).toBe("escape-key");
		expect(result.attempts.map(({ key, exited }) => ({ key, exited }))).toEqual([
			{ key: "Escape", exited: true },
			{ key: "Shift+Tab", exited: false },
		]);
	});

	it("credits the key that was pressed when the container goes after Escape was waited on in full", async () => {
		const adaptor = fakeAdaptor({
			afterKey: (key) => (key === "Shift+Tab" ? { ...FREED, containerVisible: false } : undefined),
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.escapedVia).toBe("shift-tab");
		expect(result.attempts.map(({ key, exited }) => ({ key, exited }))).toEqual([
			{ key: "Escape", exited: false },
			{ key: "Shift+Tab", exited: true },
		]);
	});

	it("credits the key that moved focus out while the container stays, even straight after Escape", async () => {
		const adaptor = fakeAdaptor({
			escapeIgnored: true,
			afterKey: (key) => (key === "Shift+Tab" ? FREED : undefined),
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.escapedVia).toBe("shift-tab");
	});

	it("records each key pressed, where focus landed and whether the page cancelled Tab", async () => {
		const adaptor = fakeAdaptor({ tabPrevented: true });
		const result = await verify(
			runSession([0, 1], { revisitedIndex: 0 }, { escapeAttemptRounds: 1 }),
			adaptor,
		);

		expect(result.keysTried).toEqual(["Escape", "Shift+Tab", "Tab"]);
		expect(result.attempts).toEqual([
			{
				round: 1,
				key: "Escape",
				presses: 1,
				from: '<button id="e0">',
				landed: '<button id="e0">',
				exited: false,
			},
			{
				round: 1,
				key: "Shift+Tab",
				presses: 1,
				from: '<button id="e0">',
				landed: '<button id="e0">',
				exited: false,
				cancelled: true,
			},
			{
				round: 1,
				key: "Tab",
				presses: 1,
				from: '<button id="e0">',
				landed: '<button id="e0">',
				exited: false,
				cancelled: true,
			},
		]);
	});

	it("lists only the keys it pressed", async () => {
		const adaptor = fakeAdaptor({ inspection: inspection({ escapeIndex: -1, arrowSafe: [true] }) });
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.keysTried).toEqual(["Shift+Tab", "ArrowDown", "Tab", "ArrowRight"]);
	});

	it("records where the key that freed focus put it", async () => {
		const adaptor = fakeAdaptor({
			afterKey: (key) => (key === "Shift+Tab" ? FREED : undefined),
		});
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.attempts.at(-1)).toMatchObject({
			key: "Shift+Tab",
			exited: true,
			landed: '<a id="outside" href="#">',
		});
	});

	it("stops walking a ring once focus is back on a member it has already been on", async () => {
		// Shift+Tab steps back one member at a time and wraps round; Tab steps forward.
		const size = 5;
		let member = 0;
		const adaptor = fakeAdaptor({
			afterFocus: () => {
				member = 0;

				return TRAPPED;
			},
			afterKey: (key) => {
				if (key !== "Shift+Tab" && key !== "Tab") {
					return undefined;
				}

				member = (member + (key === "Tab" ? 1 : size - 1)) % size;

				return { ...TRAPPED, member };
			},
		});
		const indexes = Array.from({ length: size }, (_, i) => i);
		const result = await verify(
			runSession(indexes, { revisitedIndex: 0 }, { escapeAttemptRounds: 1 }),
			adaptor,
		);

		expect(result.outcome).toBe("trapped");
		// Once round the ring in each direction, where it used to press one more for luck.
		expect(adaptor.keys.filter((key) => key === "Shift+Tab")).toHaveLength(size);
		expect(adaptor.keys.filter((key) => key === "Tab")).toHaveLength(size);
		expect(result.sampledRing).toBe(false);
	});

	it("presses Tab and Shift+Tab only either side of where a large ring wraps round", async () => {
		const size = 150;
		let member = 0;
		const adaptor = fakeAdaptor({
			afterFocus: () => {
				member = adaptor.focused.at(-1) ?? 0;

				return { ...TRAPPED, member };
			},
			afterKey: (key) => {
				if (key !== "Shift+Tab" && key !== "Tab") {
					return undefined;
				}

				member = (member + (key === "Tab" ? 1 : size - 1)) % size;

				return { ...TRAPPED, member };
			},
		});
		const indexes = Array.from({ length: size }, (_, i) => i);
		const result = await verify(
			runSession(indexes, { revisitedIndex: 0 }, { escapeAttemptRounds: 1 }),
			adaptor,
		);

		// A ring that was only sampled is never called a trap: an exit in the middle went untried.
		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("ring-sampled");
		expect(result.summary.failed).toBe(0);
		expect(result.sampledRing).toBe(true);
		expect(adaptor.keys.filter((key) => key === "Shift+Tab")).toHaveLength(16);
		expect(adaptor.keys.filter((key) => key === "Tab")).toHaveLength(16);
		// Escape from the first member, then backwards from the eighth and forwards from eight
		// before the last, so each walk crosses the wrap.
		expect(adaptor.focused).toEqual([0, 8, 141]);
	});

	it("stops waiting on Escape once the page has visibly ignored it", async () => {
		const patient = fakeAdaptor();
		await verify(runSession([0, 1], { revisitedIndex: 0 }, { escapeAttemptRounds: 1 }), patient);

		const quick = fakeAdaptor({ escapeIgnored: true });
		await verify(runSession([0, 1], { revisitedIndex: 0 }, { escapeAttemptRounds: 1 }), quick);

		// 21 polls over the full second against 3 before the page is asked.
		expect(patient.probes - quick.probes).toBe(18);
	});

	it("gives up on the escape attempts when the timeout runs out", async () => {
		const adaptor = fakeAdaptor();
		const result = await verify(
			runSession([0, 1], { revisitedIndex: 0 }, { timeout: 500 }),
			adaptor,
		);

		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("timed-out");
		expect(result.summary.timedOut).toBe(true);
		expect(adaptor.keys).toEqual(["Escape"]);
		expect(adaptor.cleared).toBe(true);
	});

	it("reports the dialog a ring sits in", async () => {
		const dialog = { role: "dialog" as const, native: false, modal: true, buttons: 2 };
		const adaptor = fakeAdaptor({ inspection: inspection({ dialog }) });
		const result = await verify(runSession([0, 1], { revisitedIndex: 0 }), adaptor);

		expect(result.dialog).toEqual(dialog);
	});

	it("caps the reported ring members but counts them all", async () => {
		const indexes = Array.from({ length: 15 }, (_, i) => i);
		const result = await verify(runSession(indexes, { revisitedIndex: 0 }), fakeAdaptor());

		expect(result.ring).toHaveLength(10);
		expect(result.ringSize).toBe(15);
	});
});
