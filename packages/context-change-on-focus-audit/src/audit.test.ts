import type {
	ContextChangeDetails,
	ContextChangeSignals,
	LateContextChange,
	TabSessionHandle,
	TabStopSnapshot,
	UnattributedContextChange,
} from "@a11y-pulse/tab-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContextChangeOnFocusAudit } from "./audit";

const PNG = new Uint8Array([1]);

function signals(partial: Partial<ContextChangeSignals> = {}): ContextChangeSignals {
	return {
		openedWindow: false,
		submittedForm: false,
		focusRemoved: false,
		redirect: null,
		softUrlChange: false,
		navigation: false,
		...partial,
	};
}

/** The snapshot the orchestrator hands over for the `n`th tab stop, focused on `#el-n`. */
function stop(
	n: number,
	partial: Partial<ContextChangeSignals> = {},
	extra: {
		details?: ContextChangeDetails;
		late?: LateContextChange[];
		unattributed?: UnattributedContextChange[];
	} = {},
): TabStopSnapshot {
	return {
		tabIndex: n,
		activeElement: {
			index: n,
			isBody: false,
			isIframe: false,
			selector: `#el-${n}`,
			html: `<button id="el-${n}">`,
			styles: { element: {}, before: {}, after: {} },
			rect: { x: 0, y: 0, width: 10, height: 10 },
		},
		contextSignals: {
			signals: signals(partial),
			details: extra.details ?? {},
			late: extra.late,
			unattributed: extra.unattributed,
		},
	};
}

type FakeSession = TabSessionHandle & {
	disconnects: number;
	shots: string[];
	/** Targets whose capture should reject. */
	failing: Set<string>;
};

function fakeSession(): FakeSession {
	const session: FakeSession = {
		disconnects: 0,
		shots: [],
		failing: new Set(),
		disconnect() {
			session.disconnects++;
		},
		async ensureUnfocusedPair() {
			throw new Error("not used by this audit");
		},
		async screenshotClip(target = "focused") {
			session.shots.push(target);

			if (session.failing.has(target)) {
				throw new Error(`no ${target} element`);
			}

			return PNG;
		},
	};

	return session;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("createContextChangeOnFocusAudit", () => {
	it("asks the orchestrator for context signals and screenshots only", () => {
		expect([...createContextChangeOnFocusAudit().capabilities].sort()).toEqual([
			"contextSignals",
			"screenshot",
		]);
	});

	it("passes a stop with no signals and counts it", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();

		await audit.onTabStop(stop(1), session);
		audit.onSessionEnd?.("completed", { revisitedIndex: null });

		expect(audit.result.elements).toEqual([
			{
				selector: "#el-1",
				html: '<button id="el-1">',
				tabIndex: 1,
				findings: [],
				failed: false,
				screenshot: undefined,
			},
		]);
		expect(audit.result.summary).toMatchObject({
			checked: 1,
			passed: 1,
			failed: 0,
			sessionEnd: "completed",
		});
		expect(session.shots).toEqual([]);
	});

	it("keeps what is known about each change on its finding", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();
		const form = { selector: "#search", html: '<form id="search">', action: "http://x/results" };

		await audit.onTabStop(
			stop(
				1,
				{ openedWindow: true, submittedForm: true, softUrlChange: true },
				{
					details: {
						openedWindowUrl: "http://x/popup",
						submittedForm: form,
						urlChange: { from: "http://x/", to: "http://x/#tab" },
					},
				},
			),
			session,
		);

		expect(audit.result.elements[0]?.findings).toEqual([
			{ kind: "new-window", bucket: "violation", url: "http://x/popup" },
			{ kind: "auto-submit", bucket: "violation", form },
			{ kind: "url-changed", bucket: "incomplete", from: "http://x/", to: "http://x/#tab" },
		]);
		expect(audit.result.elements[0]?.failed).toBe(true);
	});

	it("does not count an element with only review findings as failed", async () => {
		const audit = createContextChangeOnFocusAudit();

		await audit.onTabStop(stop(1, { softUrlChange: true }), fakeSession());

		expect(audit.result.elements[0]?.failed).toBe(false);
		expect(audit.result.summary).toMatchObject({ checked: 1, passed: 1, failed: 0 });
	});

	it("reports a native dialog raised on focus", async () => {
		const audit = createContextChangeOnFocusAudit();

		await audit.onTabStop(stop(1, { openedDialog: true }), fakeSession());

		expect(audit.result.elements[0]?.findings).toEqual([{ kind: "dialog", bucket: "violation" }]);
	});

	it("reports nothing for focus passed on by a focus guard", async () => {
		const audit = createContextChangeOnFocusAudit();

		await audit.onTabStop(stop(1, { focusGuard: true }), fakeSession());

		expect(audit.result.elements[0]).toMatchObject({ selector: "#el-1", findings: [] });
	});
});

describe("attribution of focus that was given away", () => {
	const thief = { selector: "#thief", html: '<input id="thief">' };

	it("reports the element that redirected focus, with where focus went on the finding", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();

		// Focus settled on #el-1, but #thief is the element that received it and passed it on.
		await audit.onTabStop(
			stop(1, { redirect: "outside" }, { details: { attributed: thief } }),
			session,
		);

		expect(audit.result.elements).toEqual([
			{
				...thief,
				tabIndex: 1,
				findings: [
					{
						kind: "focus-redirected-outside",
						bucket: "violation",
						redirectedTo: { selector: "#el-1", html: '<button id="el-1">' },
					},
				],
				failed: true,
				screenshot: PNG,
			},
		]);
		expect(session.shots).toEqual(["attributed"]);
	});

	it("falls back to the focused element's screenshot when the redirecting one is gone", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();
		session.failing.add("attributed");

		await audit.onTabStop(
			stop(1, { redirect: "outside" }, { details: { attributed: thief } }),
			session,
		);

		expect(session.shots).toEqual(["attributed", "focused"]);
		expect(audit.result.elements[0]).toMatchObject({ selector: "#thief", screenshot: PNG });
	});

	it("keeps the focused element when it is itself the attributed one", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();

		// A self-blurring element: the orchestrator's synthetic stop is already about that element.
		await audit.onTabStop(
			stop(
				1,
				{ focusRemoved: true },
				{ details: { attributed: { selector: "#el-1", html: '<button id="el-1">' } } },
			),
			session,
		);

		expect(audit.result.elements[0]).toMatchObject({
			selector: "#el-1",
			findings: [{ kind: "focus-removed", bucket: "violation" }],
		});
		expect(session.shots).toEqual(["focused"]);
	});
});

describe("changes that arrive after focus has moved on", () => {
	const late = (index: number | null, html: string): LateContextChange => ({
		index,
		html,
		signals: signals({ openedWindow: true }),
		details: { openedWindowUrl: "http://x/late" },
	});

	it("adds a delayed finding to the earlier element, not the focused one", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();

		await audit.onTabStop(stop(1), session);
		await audit.onTabStop(stop(2), session);
		await audit.onTabStop(stop(3, {}, { late: [late(1, '<button id="el-1">')] }), session);

		expect(audit.result.elements.map((element) => [element.selector, element.failed])).toEqual([
			["#el-1", true],
			["#el-2", false],
			["#el-3", false],
		]);
		expect(audit.result.elements[0]?.findings).toEqual([
			{ kind: "new-window", bucket: "violation", url: "http://x/late", delayed: true },
		]);
		expect(audit.result.summary).toMatchObject({ checked: 3, failed: 1, passed: 2 });
	});

	it("finds an element that redirected focus by its markup", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();
		const thief = { selector: "#thief", html: '<input id="thief">' };

		await audit.onTabStop(
			stop(1, { redirect: "outside" }, { details: { attributed: thief } }),
			session,
		);
		await audit.onTabStop(stop(2, {}, { late: [late(null, thief.html)] }), session);

		expect(audit.result.elements).toHaveLength(2);
		expect(audit.result.elements[0]?.findings.map((finding) => finding.kind)).toEqual([
			"focus-redirected-outside",
			"new-window",
		]);
	});

	it("reports a delayed change from an element that was never a stop on its own entry", async () => {
		const audit = createContextChangeOnFocusAudit();

		await audit.onTabStop(stop(1, {}, { late: [late(null, "<div tabindex=0>")] }), fakeSession());

		expect(audit.result.elements).toEqual([
			{
				selector: "",
				html: "<div tabindex=0>",
				tabIndex: 1,
				findings: [
					{ kind: "new-window", bucket: "violation", url: "http://x/late", delayed: true },
				],
				failed: true,
			},
			expect.objectContaining({ selector: "#el-1", findings: [] }),
		]);
	});
});

describe("what the session still had to report when it ended", () => {
	it("adds a change the last element deferred to that element, and counts it", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();

		await audit.onTabStop(stop(1), session);
		await audit.onTabStop(stop(2), session);
		audit.onSessionEnd?.("completed", {
			revisitedIndex: null,
			contextSignals: {
				late: [
					{
						index: 2,
						html: '<button id="el-2">',
						signals: signals({ navigationPrevented: true }),
						details: { navigationUrl: "http://x/next" },
					},
				],
			},
		});

		expect(audit.result.elements.map((element) => [element.selector, element.findings])).toEqual([
			["#el-1", []],
			["#el-2", [{ kind: "navigation", bucket: "violation", url: "http://x/next", delayed: true }]],
		]);
		expect(audit.result.summary).toMatchObject({
			checked: 2,
			failed: 1,
			passed: 1,
			sessionEnd: "completed",
		});
	});

	it("records how the session ended, including on lost focus", async () => {
		const audit = createContextChangeOnFocusAudit();

		await audit.onTabStop(stop(1), fakeSession());
		audit.onSessionEnd?.("lostFocus", { revisitedIndex: null });

		expect(audit.result.summary).toMatchObject({ sessionEnd: "lostFocus", checked: 1 });
		expect(audit.result.unattributed).toBeUndefined();
	});
});

describe("changes no focused element can be shown to have caused", () => {
	const unattributed = (
		partial: Partial<ContextChangeSignals>,
		details: ContextChangeDetails = {},
	): UnattributedContextChange => ({ signals: signals(partial), details });

	it("keeps them off the focused element, for review, once each", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();
		const redirect = unattributed(
			{ navigationPrevented: true },
			{ navigationUrl: "http://x/signed-out" },
		);

		await audit.onTabStop(stop(1, {}, { unattributed: [redirect] }), session);
		// An interval that keeps trying, and a window opened by something else.
		await audit.onTabStop(
			stop(
				2,
				{},
				{
					unattributed: [
						redirect,
						unattributed({ openedWindow: true }, { openedWindowUrl: "/promotion" }),
					],
				},
			),
			session,
		);
		audit.onSessionEnd?.("completed", {
			revisitedIndex: null,
			contextSignals: { unattributed: [unattributed({ openedDialog: true })] },
		});

		expect(audit.result.elements.map((element) => element.findings)).toEqual([[], []]);
		expect(session.shots).toEqual([]);
		expect(audit.result.unattributed).toEqual([
			{ kind: "navigation", bucket: "incomplete", url: "http://x/signed-out" },
			{ kind: "new-window", bucket: "incomplete", url: "/promotion" },
			{ kind: "dialog", bucket: "incomplete" },
		]);
		expect(audit.result.summary).toMatchObject({ checked: 2, failed: 0, passed: 2 });
	});
});

describe("navigation", () => {
	it("reports a cancelled navigation on the element, with its screenshot, and carries on", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();

		await audit.onTabStop(
			stop(1, { navigationPrevented: true }, { details: { navigationUrl: "http://x/away" } }),
			session,
		);
		await audit.onTabStop(stop(2), session);

		expect(audit.result.elements[0]).toMatchObject({
			selector: "#el-1",
			failed: true,
			findings: [{ kind: "navigation", bucket: "violation", url: "http://x/away" }],
			screenshot: PNG,
		});
		expect(audit.result.elements).toHaveLength(2);
	});

	it("takes no screenshot once the page has really navigated", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();

		await audit.onTabStop(stop(1, { navigation: true }), session);
		audit.onSessionEnd?.("navigation", { revisitedIndex: null });

		expect(audit.result.elements[0]?.findings).toEqual([
			{ kind: "navigation", bucket: "violation" },
		]);
		expect(session.shots).toEqual([]);
		expect(audit.result.navigation).toBeUndefined();
		expect(audit.result.summary.sessionEnd).toBe("navigation");
	});

	it("records a navigation whose element could not be read against the stop before it", async () => {
		const audit = createContextChangeOnFocusAudit();
		const after = { selector: "#el-1", html: '<button id="el-1">' };

		await audit.onTabStop(stop(1), fakeSession());
		audit.onSessionEnd?.("navigation", {
			revisitedIndex: null,
			navigation: { after, url: "http://x/away" },
		});

		expect(audit.result.navigation).toEqual({ after, url: "http://x/away" });
		expect(audit.result.elements[0]?.findings).toEqual([]);
	});
});

describe("limits", () => {
	it("disconnects at elementLimit", async () => {
		const audit = createContextChangeOnFocusAudit({ elementLimit: 2 });
		const session = fakeSession();

		await audit.onTabStop(stop(1), session);
		expect(session.disconnects).toBe(0);

		await audit.onTabStop(stop(2), session);
		expect(session.disconnects).toBe(1);
		expect(audit.result.summary.reachedLimit).toBe(true);

		// A session that ends after the audit left it says nothing about how the audit ended.
		audit.onSessionEnd?.("completed", { revisitedIndex: null });
		expect(audit.result.summary.sessionEnd).toBeNull();
	});

	it("disconnects at failedElementLimit, counting delayed failures too", async () => {
		const audit = createContextChangeOnFocusAudit({ failedElementLimit: 2 });
		const session = fakeSession();

		await audit.onTabStop(stop(1, { openedWindow: true }), session);
		await audit.onTabStop(stop(2), session);
		expect(session.disconnects).toBe(0);

		await audit.onTabStop(
			stop(
				3,
				{},
				{
					late: [
						{
							index: 2,
							html: '<button id="el-2">',
							signals: signals({ submittedForm: true }),
							details: {},
						},
					],
				},
			),
			session,
		);

		expect(session.disconnects).toBe(1);
		expect(audit.result.summary).toMatchObject({
			failed: 2,
			reachedFailedElementLimit: true,
			reachedLimit: false,
		});
	});

	it("never stops for failures when failedElementLimit is 0 (default)", async () => {
		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();

		await audit.onTabStop(stop(1, { openedWindow: true }), session);
		await audit.onTabStop(stop(2, { submittedForm: true }), session);

		expect(session.disconnects).toBe(0);
		expect(audit.result.summary.failed).toBe(2);
	});

	it("omits screenshots past screenshotLimit but keeps every element", async () => {
		const audit = createContextChangeOnFocusAudit({ screenshotLimit: 2 });
		const session = fakeSession();

		for (const n of [1, 2, 3]) {
			await audit.onTabStop(stop(n, { openedWindow: true }), session);
		}

		expect(audit.result.elements.map((element) => element.screenshot)).toEqual([
			PNG,
			PNG,
			undefined,
		]);
	});

	it("leaves the session and marks the result when its timeout passes", async () => {
		vi.useFakeTimers();

		const audit = createContextChangeOnFocusAudit({ timeout: 150 });
		const session = fakeSession();

		audit.onSessionStart?.(session);
		await audit.onTabStop(stop(1), session);
		vi.advanceTimersByTime(149);
		expect(session.disconnects).toBe(0);

		vi.advanceTimersByTime(1);
		expect(session.disconnects).toBe(1);
		expect(audit.result.summary).toMatchObject({ timedOut: true, checked: 1 });
	});

	it("sets no timer when timeout is 0 (default)", async () => {
		vi.useFakeTimers();

		const audit = createContextChangeOnFocusAudit();
		const session = fakeSession();

		audit.onSessionStart?.(session);
		vi.advanceTimersByTime(60_000);

		expect(session.disconnects).toBe(0);
		expect(audit.result.summary.timedOut).toBe(false);
	});
});
