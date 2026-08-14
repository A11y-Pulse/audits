import { describe, expect, it } from "vitest";
import type { ElementRef } from "./adaptor";
import {
	runSkipLinkLoop,
	type SkipLinkCandidate,
	type SkipLinkProbe,
	type TabStopProbe,
} from "./audit";

const OPTIONS = { candidateLimit: 3, activationPollMs: 0 };

function candidate(
	overrides: Partial<SkipLinkCandidate> & Pick<SkipLinkCandidate, "fragment">,
): SkipLinkCandidate {
	return {
		selector: overrides.selector ?? `a[href="${overrides.fragment}"]`,
		html: overrides.html ?? `<a href="${overrides.fragment}">`,
		fragment: overrides.fragment,
		targetResolves: overrides.targetResolves ?? true,
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

function scriptedProbe(script: {
	stops: TabStopProbe[];
	focusInside?: boolean[];
}): SkipLinkProbe & {
	tabs: number;
	enters: number;
	focused: ElementRef[];
	disposed: ElementRef[];
} {
	let stopCall = 0;
	let focusInsideCall = 0;
	const record = {
		tabs: 0,
		enters: 0,
		focused: [] as ElementRef[],
		disposed: [] as ElementRef[],
	};

	const probe: SkipLinkProbe & typeof record = {
		...record,
		pressTab: async () => {
			record.tabs++;
			probe.tabs = record.tabs;
		},
		pressEnter: async () => {
			record.enters++;
			probe.enters = record.enters;
		},
		probeTabStop: async () =>
			script.stops[stopCall++] ?? stop({ isBody: true, identity: "body" }),
		focusHandle: async (ref) => {
			record.focused.push(ref);
			probe.focused = record.focused;
		},
		isFocusInsideTarget: async () =>
			script.focusInside?.[focusInsideCall++] ?? false,
		disposeRef: async (ref) => {
			record.disposed.push(ref);
			probe.disposed = record.disposed;
		},
	};

	return probe;
}

describe("runSkipLinkLoop", () => {
	it("returns an empty result when no skip-link candidate is found", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: [
					stop({ identity: "logo" }),
					stop({ identity: "nav" }),
					stop({ identity: "search" }),
				],
			}),
			OPTIONS,
		);

		expect(result.skipLinks).toEqual([]);
		expect(result.summary).toEqual({ found: 0, passed: 0, failed: 0 });
	});

	it("records a passing candidate when the target resolves and focus moves", async () => {
		const handle = { id: "skip" };
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: [
					stop({
						identity: "skip",
						candidate: candidate({ fragment: "#main", handle }),
					}),
				],
				focusInside: [true],
			}),
			OPTIONS,
		);

		expect(result.skipLinks).toHaveLength(1);
		expect(result.skipLinks[0]).toMatchObject({
			fragment: "#main",
			tabIndex: 1,
			passed: true,
			failureReason: null,
		});
		expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0 });
	});

	it("records target-missing without pressing Enter", async () => {
		const handle = { id: "broken" };
		const probe = scriptedProbe({
			stops: [
				stop({
					identity: "broken",
					candidate: candidate({
						fragment: "#missing",
						targetResolves: false,
						handle,
					}),
				}),
			],
			focusInside: [true],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks[0]).toMatchObject({
			fragment: "#missing",
			passed: false,
			failureReason: "target-missing",
		});
		expect(result.summary).toEqual({ found: 1, passed: 0, failed: 1 });
		expect(probe.enters).toBe(0);
		expect(probe.disposed).toEqual([handle]);
	});

	it("records activation-no-effect when Enter does not move focus into the target", async () => {
		const handle = { id: "noop" };
		const probe = scriptedProbe({
			stops: [
				stop({
					identity: "noop",
					candidate: candidate({ fragment: "#main", handle }),
				}),
			],
			focusInside: [false, false],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks[0]).toMatchObject({
			passed: false,
			failureReason: "activation-no-effect",
		});
		expect(result.summary.failed).toBe(1);
		expect(probe.enters).toBe(1);
		expect(probe.disposed).toEqual([handle]);
	});

	it("records multiple candidates independently", async () => {
		const main = { id: "main-skip" };
		const nav = { id: "nav-skip" };
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: [
					stop({
						identity: "main-skip",
						candidate: candidate({ fragment: "#main", handle: main }),
					}),
					stop({
						identity: "nav-skip",
						candidate: candidate({ fragment: "#nav", handle: nav }),
					}),
				],
				focusInside: [true, true],
			}),
			OPTIONS,
		);

		expect(result.skipLinks).toHaveLength(2);
		expect(result.skipLinks.map((l) => l.fragment)).toEqual(["#main", "#nav"]);
		expect(result.skipLinks.map((l) => l.tabIndex)).toEqual([1, 2]);
		expect(result.summary).toEqual({ found: 2, passed: 2, failed: 0 });
	});

	it("records a candidate found at the 2nd tab stop", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: [
					stop({ identity: "logo" }),
					stop({
						identity: "skip",
						candidate: candidate({ fragment: "#main" }),
					}),
				],
				focusInside: [true],
			}),
			OPTIONS,
		);

		expect(result.skipLinks).toHaveLength(1);
		expect(result.skipLinks[0]?.tabIndex).toBe(2);
		expect(result.skipLinks[0]?.passed).toBe(true);
	});

	it("records a candidate found at the 3rd tab stop", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: [
					stop({ identity: "logo" }),
					stop({ identity: "search" }),
					stop({
						identity: "skip",
						candidate: candidate({ fragment: "#main" }),
					}),
				],
				focusInside: [true],
			}),
			OPTIONS,
		);

		expect(result.skipLinks).toHaveLength(1);
		expect(result.skipLinks[0]?.tabIndex).toBe(3);
		expect(result.skipLinks[0]?.passed).toBe(true);
	});

	it("respects candidateLimit and misses a skip link at stop 4", async () => {
		const result = await runSkipLinkLoop(
			scriptedProbe({
				stops: [
					stop({ identity: "a" }),
					stop({ identity: "b" }),
					stop({ identity: "c" }),
					stop({
						identity: "skip",
						candidate: candidate({ fragment: "#main" }),
					}),
				],
				focusInside: [true],
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
				stop({
					identity: "skip",
					candidate: candidate({ fragment: "#main" }),
				}),
			],
			focusInside: [true],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks).toEqual([]);
		expect(probe.tabs).toBe(2);
	});

	it("stops when focus cycles back to an already-seen element", async () => {
		const probe = scriptedProbe({
			stops: [
				stop({ identity: "logo" }),
				stop({ identity: "logo" }),
				stop({
					identity: "skip",
					candidate: candidate({ fragment: "#main" }),
				}),
			],
			focusInside: [true],
		});

		const result = await runSkipLinkLoop(probe, OPTIONS);

		expect(result.skipLinks).toEqual([]);
		expect(probe.tabs).toBe(2);
	});
});
