import { describe, expect, it } from "vitest";
import type { ElementRef } from "./adaptor";
import {
	type FocusReading,
	runSkipLinkLoop,
	type SkipLinkCandidate,
	type SkipLinkProbe,
	type TabStopProbe,
} from "./audit";
import type { SkipLinkFocusPosition } from "./browser-scripts";
import type { SkipLinkUnreachableResult } from "./result";

const OPTIONS = { candidateLimit: 3, activationPollMs: 0 };
const TARGET = { selector: "#main", html: '<main id="main">', rendered: true };

function candidate(
	overrides: Partial<SkipLinkCandidate> & Pick<SkipLinkCandidate, "fragment">,
): SkipLinkCandidate {
	return {
		selector: overrides.selector ?? `a[href="${overrides.fragment}"]`,
		html: overrides.html ?? `<a href="${overrides.fragment}">`,
		fragment: overrides.fragment,
		linkText: overrides.linkText ?? "Skip to content",
		target: overrides.target === undefined ? TARGET : overrides.target,
		handle: overrides.handle ?? { id: overrides.fragment },
	};
}

function stop(partial: Partial<TabStopProbe> = {}): TabStopProbe {
	return {
		isBody: partial.isBody ?? false,
		identity: partial.identity ?? "el",
		candidate: partial.candidate ?? null,
	};
}

/** A focus reading for a link whose target exists and is rendered, unless overridden. */
function focus(
	position: SkipLinkFocusPosition,
	overrides: Partial<FocusReading> = {},
): FocusReading {
	return { position, navigated: false, targetExists: true, targetRendered: true, ...overrides };
}

function scriptedProbe(script: {
	stops: TabStopProbe[];
	/** Successive focus readings. The last one repeats once the script runs out. */
	focus?: FocusReading[];
	unreachable?: SkipLinkUnreachableResult[];
}) {
	let stopCall = 0;
	let focusCall = 0;
	const calls: string[] = [];
	const record = {
		calls,
		focused: [] as ElementRef[],
		screenshotted: [] as ElementRef[],
		disposed: [] as ElementRef[],
		restored: [] as unknown[],
		count: (name: string) => calls.filter((call) => call === name).length,
	};

	const probe: SkipLinkProbe = {
		pressTab: async () => {
			calls.push("tab");
		},
		pressEnter: async () => {
			calls.push("enter");
		},
		probeTabStop: async () => script.stops[stopCall++] ?? stop({ isBody: true, identity: "body" }),
		focusHandle: async (ref) => {
			record.focused.push(ref);
		},
		readFocus: async () => {
			const readings = script.focus ?? [focus("skip-link")];

			return readings[Math.min(focusCall++, readings.length - 1)] as FocusReading;
		},
		describeFocused: async () => ({ selector: `#focused-${focusCall}`, html: "<a>" }),
		findUnreachable: async () => {
			calls.push("findUnreachable");

			return script.unreachable ?? [];
		},
		saveState: async () => ({
			href: `https://example.test/#${calls.length}`,
			scrollX: 0,
			scrollY: 0,
			historyLength: 1,
		}),
		restoreState: async (state) => {
			calls.push("restore");
			record.restored.push(state);
		},
		clearFocus: async () => {
			calls.push("clearFocus");
		},
		screenshotFocused: async (ref) => {
			record.screenshotted.push(ref);

			return new Uint8Array([1]);
		},
		disposeRef: async (ref) => {
			record.disposed.push(ref);
		},
	};

	return Object.assign(probe, record);
}

function oneCandidate(overrides: Partial<SkipLinkCandidate> = {}) {
	return [stop({ identity: "skip", candidate: candidate({ fragment: "#main", ...overrides }) })];
}

describe("runSkipLinkLoop", () => {
	it("returns an empty result when no skip-link candidate is found", async () => {
		const probe = scriptedProbe({
			stops: [stop({ identity: "logo" }), stop({ identity: "nav" }), stop({ identity: "search" })],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks).toEqual([]);
		expect(result.unreachable).toEqual([]);
		expect(result.summary).toEqual({ found: 0, passed: 0, failed: 0, unreachable: 0 });
		expect(probe.count("enter")).toBe(0);
		// Looking for candidates tabbed into the page, so the tab order is still reset.
		expect(probe.count("clearFocus")).toBe(1);
		expect(probe.calls.indexOf("clearFocus")).toBeLessThan(probe.calls.indexOf("findUnreachable"));
	});

	it("restores the page and resets focus when activating a link throws", async () => {
		const probe = scriptedProbe({ stops: oneCandidate(), focus: [focus("inside-target")] });

		probe.pressEnter = async () => {
			throw new Error("target closed");
		};

		await expect(runSkipLinkLoop(probe, OPTIONS)).rejects.toThrow("target closed");

		expect(probe.calls.filter((call) => ["restore", "clearFocus"].includes(call))).toEqual([
			"restore",
			"clearFocus",
		]);
		expect(probe.disposed).toHaveLength(1);
	});

	it("passes when Enter moves focus into the target, without a follow-up Tab", async () => {
		const handle = { id: "skip" };
		const probe = scriptedProbe({
			stops: oneCandidate({ handle }),
			focus: [focus("inside-target", { navigated: true })],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks).toEqual([
			{
				selector: 'a[href="#main"]',
				html: '<a href="#main">',
				fragment: "#main",
				tabIndex: 1,
				passed: true,
				failureReason: null,
				linkText: "Skip to content",
				target: TARGET,
				focusAfterEnter: { position: "inside-target", selector: "#focused-1", html: "<a>" },
				focusAfterTab: null,
				screenshot: undefined,
			},
		]);
		expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
		expect(probe.focused).toEqual([handle]);
		// One Tab to reach the link, one that found the end of the page: none after Enter.
		expect(probe.calls.slice(probe.calls.indexOf("enter"))).not.toContain("tab");
	});

	it("passes when a script moves focus past the target on Enter", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({ stops: oneCandidate(), focus: [focus("after-target")] }),
			OPTIONS,
		);

		expect(result.skipLinks[0]).toMatchObject({ passed: true, focusAfterTab: null });
	});

	it("passes when the follow-up Tab lands inside the target", async () => {
		const handle = { id: "skip" };
		const probe = scriptedProbe({
			stops: oneCandidate({ handle }),
			focus: [focus("skip-link", { navigated: true }), focus("inside-target", { navigated: true })],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks[0]).toMatchObject({
			passed: true,
			failureReason: null,
			focusAfterEnter: { position: "skip-link" },
			focusAfterTab: { position: "inside-target" },
		});
		expect(probe.count("enter")).toBe(1);
		expect(probe.disposed).toEqual([handle]);
	});

	it("passes a target with nothing focusable inside when the follow-up Tab lands after it", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: oneCandidate(),
				focus: [focus("body", { navigated: true }), focus("after-target", { navigated: true })],
			}),
			OPTIONS,
		);

		expect(result.skipLinks[0]).toMatchObject({
			passed: true,
			failureReason: null,
			focusAfterEnter: { position: "body", selector: null, html: null },
			focusAfterTab: { position: "after-target" },
		});
	});

	it("passes when the fragment was followed and the follow-up Tab leaves the document", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: oneCandidate(),
				focus: [focus("skip-link", { navigated: true }), focus("body", { navigated: true })],
			}),
			OPTIONS,
		);

		expect(result.skipLinks[0]).toMatchObject({ passed: true, failureReason: null });
	});

	it("fails when Enter did nothing, even if the next tab stop happens to follow the target", async () => {
		const handle = { id: "noop" };
		const probe = scriptedProbe({
			stops: oneCandidate({ handle }),
			focus: [focus("skip-link"), focus("after-target")],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks[0]).toMatchObject({
			passed: false,
			failureReason: "activation-no-effect",
			focusAfterTab: { position: "after-target" },
			screenshot: new Uint8Array([1]),
		});
		expect(probe.screenshotted).toEqual([handle]);
	});

	it("records activation-no-effect when neither Enter nor the follow-up Tab reaches the target", async () => {
		const handle = { id: "noop" };
		const probe = scriptedProbe({
			stops: oneCandidate({ handle }),
			focus: [focus("skip-link", { navigated: true }), focus("elsewhere", { navigated: true })],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks[0]).toMatchObject({
			passed: false,
			failureReason: "activation-no-effect",
			focusAfterEnter: { position: "skip-link" },
			focusAfterTab: { position: "elsewhere" },
			screenshot: new Uint8Array([1]),
		});
		expect(result.summary).toEqual({ found: 1, passed: 0, failed: 1, unreachable: 0 });
		expect(probe.count("enter")).toBe(1);
		expect(probe.disposed).toEqual([handle]);
	});

	it("activates a link with no target and passes when a script moves focus to later content", async () => {
		const probe = scriptedProbe({
			stops: oneCandidate({ fragment: "#skip", target: null }),
			focus: [focus("after-link", { targetExists: false, targetRendered: false })],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks[0]).toMatchObject({
			fragment: "#skip",
			passed: true,
			failureReason: null,
			target: null,
			focusAfterEnter: { position: "after-link" },
		});
		expect(probe.count("enter")).toBe(1);
	});

	it("records target-missing when activating a link with no target moves focus nowhere", async () => {
		const handle = { id: "broken" };
		const probe = scriptedProbe({
			stops: oneCandidate({ fragment: "#missing", target: null, handle }),
			focus: [focus("skip-link", { navigated: true, targetExists: false, targetRendered: false })],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks[0]).toMatchObject({
			fragment: "#missing",
			passed: false,
			failureReason: "target-missing",
			focusAfterTab: null,
			screenshot: new Uint8Array([1]),
		});
		expect(result.summary).toEqual({ found: 1, passed: 0, failed: 1, unreachable: 0 });
		expect(probe.count("enter")).toBe(1);
		// The follow-up Tab cannot say anything about a target that does not exist.
		expect(probe.calls.slice(probe.calls.indexOf("enter"))).not.toContain("tab");
		expect(probe.disposed).toEqual([handle]);
	});

	it("records target-hidden when the target is not rendered and focus cannot reach it", async () => {
		const probe = scriptedProbe({
			stops: oneCandidate({ target: { ...TARGET, rendered: false } }),
			focus: [focus("skip-link", { navigated: true, targetRendered: false })],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks[0]).toMatchObject({
			passed: false,
			failureReason: "target-hidden",
			focusAfterTab: null,
		});
		expect(probe.calls.slice(probe.calls.indexOf("enter"))).not.toContain("tab");
	});

	it("passes a hidden target that a script reveals and focuses on activation", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: oneCandidate({ target: { ...TARGET, rendered: false } }),
				focus: [focus("inside-target")],
			}),
			OPTIONS,
		);

		expect(result.skipLinks[0]).toMatchObject({ passed: true, failureReason: null });
	});

	it("keeps polling until focus arrives, within the activation window", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: oneCandidate(),
				focus: [focus("skip-link"), focus("skip-link"), focus("inside-target")],
			}),
			{ ...OPTIONS, activationPollMs: 250 },
		);

		expect(result.skipLinks[0]).toMatchObject({ passed: true, focusAfterTab: null });
	});

	it("restores the page after each activation and drops focus at the end", async () => {
		const probe = scriptedProbe({
			stops: [
				stop({ identity: "main-skip", candidate: candidate({ fragment: "#main" }) }),
				stop({ identity: "nav-skip", candidate: candidate({ fragment: "#nav" }) }),
			],
			focus: [focus("inside-target")],
		});

		await runSkipLinkLoop(probe, OPTIONS);

		expect(probe.restored).toHaveLength(2);
		expect(probe.calls.filter((call) => ["enter", "restore", "clearFocus"].includes(call))).toEqual(
			["enter", "restore", "enter", "restore", "clearFocus"],
		);
	});

	it("restores the page and releases the handle when activation throws", async () => {
		const handle = { id: "skip" };
		const probe = scriptedProbe({ stops: oneCandidate({ handle }) });

		probe.pressEnter = async () => {
			throw new Error("page crashed");
		};

		await expect(runSkipLinkLoop(probe, OPTIONS)).rejects.toThrow("page crashed");
		expect(probe.restored).toHaveLength(1);
		expect(probe.disposed).toEqual([handle]);
	});

	it("records multiple candidates independently", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: [
					stop({ identity: "main-skip", candidate: candidate({ fragment: "#main" }) }),
					stop({ identity: "nav-skip", candidate: candidate({ fragment: "#nav" }) }),
				],
				focus: [focus("inside-target"), focus("skip-link"), focus("elsewhere")],
			}),
			OPTIONS,
		);

		expect(result.skipLinks.map((l) => l.fragment)).toEqual(["#main", "#nav"]);
		expect(result.skipLinks.map((l) => l.tabIndex)).toEqual([1, 2]);
		expect(result.skipLinks.map((l) => l.passed)).toEqual([true, false]);
		expect(result.summary).toEqual({ found: 2, passed: 1, failed: 1, unreachable: 0 });
	});

	it("records the tab stop a candidate was found at", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: [
					stop({ identity: "logo" }),
					stop({ identity: "search" }),
					stop({ identity: "skip", candidate: candidate({ fragment: "#main" }) }),
				],
				focus: [focus("inside-target")],
			}),
			OPTIONS,
		);

		expect(result.skipLinks).toHaveLength(1);
		expect(result.skipLinks[0]?.tabIndex).toBe(3);
	});

	it("respects candidateLimit and misses a skip link at stop 4", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: [
					stop({ identity: "a" }),
					stop({ identity: "b" }),
					stop({ identity: "c" }),
					stop({ identity: "skip", candidate: candidate({ fragment: "#main" }) }),
				],
				focus: [focus("inside-target")],
			}),
			{ ...OPTIONS, candidateLimit: 3 },
		);

		expect(result.skipLinks).toEqual([]);
		expect(result.summary.found).toBe(0);
	});

	it("stops when focus reaches the body", async () => {
		const probe = scriptedProbe({
			stops: [
				stop({ identity: "logo" }),
				stop({ isBody: true, identity: "body" }),
				stop({ identity: "skip", candidate: candidate({ fragment: "#main" }) }),
			],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks).toEqual([]);
		expect(probe.count("tab")).toBe(2);
	});

	it("stops when focus cycles back to an already-seen element", async () => {
		const probe = scriptedProbe({
			stops: [
				stop({ identity: "logo" }),
				stop({ identity: "logo" }),
				stop({ identity: "skip", candidate: candidate({ fragment: "#main" }) }),
			],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks).toEqual([]);
		expect(probe.count("tab")).toBe(2);
	});

	it("reports unreachable skip links when tabbing found none", async () => {
		const hidden: SkipLinkUnreachableResult = {
			selector: "a.skip",
			html: '<a class="skip" href="#main">',
			fragment: "#main",
			linkText: "Skip to content",
			reason: "not-rendered",
		};

		const result = await runSkipLinkLoop(
			scriptedProbe({ stops: [stop({ identity: "logo" })], unreachable: [hidden] }),
			OPTIONS,
		);

		expect(result.unreachable).toEqual([hidden]);
		expect(result.summary).toEqual({ found: 0, passed: 0, failed: 0, unreachable: 1 });
	});

	it("does not look for unreachable skip links when one was reached by tabbing", async () => {
		const probe = scriptedProbe({
			stops: oneCandidate(),
			focus: [focus("inside-target")],
			unreachable: [
				{ selector: "a.dup", html: "<a>", fragment: "#main", linkText: "Skip", reason: "inert" },
			],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.unreachable).toEqual([]);
		expect(probe.count("findUnreachable")).toBe(0);
	});
});
