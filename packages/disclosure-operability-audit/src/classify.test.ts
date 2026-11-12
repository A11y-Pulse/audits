import { describe, expect, it } from "vitest";
import { classifyTrigger, type DisclosureAttempt, type DisclosureObservation } from "./classify";

function attempt(overrides: Partial<DisclosureAttempt> = {}): DisclosureAttempt {
	return {
		key: "Enter",
		expandedBefore: "false",
		expandedAfter: "true",
		contentChanged: true,
		restoredBy: overrides.key ?? "Enter",
		...overrides,
	};
}

/** A key press that changed nothing. */
function dead(key: DisclosureAttempt["key"]): DisclosureAttempt {
	return attempt({ key, expandedAfter: "false", contentChanged: false, restoredBy: null });
}

function observation(overrides: Partial<DisclosureObservation> = {}): DisclosureObservation {
	return {
		focusable: true,
		inTabOrder: true,
		inComposite: false,
		spaceExpected: true,
		openedOnFocus: null,
		attempts: [attempt(), attempt({ key: "Space" })],
		pointer: { click: null, hover: null },
		blocked: { submit: false, navigation: false },
		removed: false,
		navigated: false,
		restored: true,
		...overrides,
	};
}

describe("classifyTrigger", () => {
	it("passes a trigger both keys open, with its state and content changing together", () => {
		expect(classifyTrigger(observation())).toEqual({ verdict: null, signals: [] });
	});

	it("passes a trigger that starts open and closes", () => {
		const closing = { expandedBefore: "true", expandedAfter: "false" };

		expect(
			classifyTrigger(
				observation({ attempts: [attempt(closing), attempt({ key: "Space", ...closing })] }),
			).verdict,
		).toBeNull();
	});

	it("fails a trigger that only a pointer operates", () => {
		const attempts = [dead("Enter"), dead("Space")];

		expect(
			classifyTrigger(observation({ attempts, pointer: { click: true, hover: null } })),
		).toEqual({ verdict: "failed", signals: ["keyboard-inoperable"] });
		expect(
			classifyTrigger(observation({ attempts, pointer: { click: false, hover: true } })),
		).toEqual({ verdict: "failed", signals: ["keyboard-inoperable"] });
	});

	it("sends a trigger nothing operates for review rather than calling it a keyboard failure", () => {
		expect(
			classifyTrigger(
				observation({
					attempts: [dead("Enter"), dead("Space")],
					pointer: { click: false, hover: false },
				}),
			),
		).toEqual({ verdict: "review", signals: ["unresponsive"] });
	});

	it("fails a trigger that cannot take focus only when a pointer does operate it", () => {
		const unfocusable = { focusable: false, inTabOrder: false, attempts: [] };

		expect(
			classifyTrigger(observation({ ...unfocusable, pointer: { click: true, hover: null } })),
		).toEqual({ verdict: "failed", signals: ["not-focusable"] });
		expect(
			classifyTrigger(observation({ ...unfocusable, pointer: { click: false, hover: false } })),
		).toEqual({ verdict: "review", signals: ["unresponsive"] });
	});

	it("fails a trigger whose content changes while aria-expanded stays put or is missing", () => {
		const stale = { expandedBefore: "false", expandedAfter: "false" };
		const absent = { expandedBefore: null, expandedAfter: null };

		for (const state of [stale, absent]) {
			expect(
				classifyTrigger(
					observation({ attempts: [attempt(state), attempt({ key: "Space", ...state })] }),
				),
			).toEqual({ verdict: "failed", signals: ["state-not-exposed"] });
		}
	});

	it("sends a state that changes with no content seen for review", () => {
		expect(
			classifyTrigger(
				observation({
					attempts: [
						attempt({ contentChanged: false }),
						attempt({ key: "Space", contentChanged: false }),
					],
				}),
			),
		).toEqual({ verdict: "review", signals: ["state-without-content"] });
	});

	it("reviews a button that ignores Space, but not a link or generic element that does", () => {
		const attempts = [attempt(), dead("Space")];

		expect(classifyTrigger(observation({ attempts }))).toEqual({
			verdict: "review",
			signals: ["space-inoperable"],
		});
		expect(classifyTrigger(observation({ attempts, spaceExpected: false }))).toEqual({
			verdict: null,
			signals: [],
		});
		// A link is only ever sent Enter.
		expect(
			classifyTrigger(observation({ attempts: [attempt()], spaceExpected: false })).verdict,
		).toBeNull();
	});

	it("reviews a trigger that Space operates and Enter does not", () => {
		expect(
			classifyTrigger(observation({ attempts: [dead("Enter"), attempt({ key: "Space" })] })),
		).toEqual({ verdict: "review", signals: ["enter-inoperable"] });
	});

	it("accepts Escape as the way to close, and reviews a popup only a click closes", () => {
		expect(
			classifyTrigger(
				observation({
					attempts: [
						attempt({ restoredBy: "Escape" }),
						attempt({ key: "Space", restoredBy: "Escape" }),
					],
				}),
			).verdict,
		).toBeNull();

		expect(
			classifyTrigger(
				observation({
					attempts: [attempt({ restoredBy: "click" }), attempt({ key: "Space" })],
				}),
			),
		).toEqual({ verdict: "review", signals: ["pointer-only-close"] });
	});

	it("reviews a trigger that could not be closed again", () => {
		expect(
			classifyTrigger(observation({ attempts: [attempt({ restoredBy: null })], restored: false })),
		).toEqual({ verdict: "review", signals: ["not-restored"] });
	});

	it("passes a trigger that opens on focus and says so, and reviews one that does not", () => {
		const onFocus = { attempts: [] };

		expect(
			classifyTrigger(observation({ ...onFocus, openedOnFocus: { expandedChanged: true } })),
		).toEqual({ verdict: null, signals: [] });
		expect(
			classifyTrigger(observation({ ...onFocus, openedOnFocus: { expandedChanged: false } })),
		).toEqual({ verdict: "review", signals: ["opens-on-focus"] });
	});

	it("reviews a trigger that vanished or navigated, whatever else was seen", () => {
		expect(
			classifyTrigger(observation({ attempts: [dead("Enter")], removed: true, restored: false })),
		).toEqual({ verdict: "review", signals: ["trigger-removed"] });
		expect(
			classifyTrigger(observation({ attempts: [], navigated: true, restored: false })),
		).toEqual({ verdict: "review", signals: ["navigated"] });
	});

	it("reviews a working trigger outside the tab order unless its widget manages focus", () => {
		expect(classifyTrigger(observation({ inTabOrder: false }))).toEqual({
			verdict: "review",
			signals: ["not-in-tab-order"],
		});
		expect(
			classifyTrigger(observation({ inTabOrder: false, inComposite: true })).verdict,
		).toBeNull();
	});

	it("lists failing signals ahead of review signals", () => {
		const stale = { expandedBefore: "false", expandedAfter: "false", restoredBy: "click" as const };

		expect(
			classifyTrigger(
				observation({ inTabOrder: false, attempts: [attempt(stale), dead("Space")] }),
			),
		).toEqual({
			verdict: "failed",
			signals: ["state-not-exposed", "space-inoperable", "pointer-only-close", "not-in-tab-order"],
		});
	});

	it("sends a trigger that tried to submit a form or leave the page for review", () => {
		// It did respond, so it is not called unresponsive.
		expect(
			classifyTrigger(
				observation({ attempts: [dead("Enter")], blocked: { submit: true, navigation: false } }),
			),
		).toEqual({ verdict: "review", signals: ["submit-blocked"] });
		expect(
			classifyTrigger(
				observation({ attempts: [dead("Enter")], blocked: { submit: false, navigation: true } }),
			),
		).toEqual({ verdict: "review", signals: ["navigation-blocked"] });
	});

	it("keeps a failure alongside a stopped submission", () => {
		expect(
			classifyTrigger(
				observation({
					attempts: [attempt({ expandedAfter: "false" })],
					blocked: { submit: true, navigation: false },
				}),
			),
		).toEqual({ verdict: "failed", signals: ["state-not-exposed", "submit-blocked"] });
	});
});
