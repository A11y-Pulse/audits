import { fakeStashAdaptor } from "@a11y-pulse/integration-harness/fake-stash-adaptor";
import { describe, expect, it } from "vitest";
import {
	type DisclosureProbe,
	DocumentReplacedError,
	runDisclosureLoop,
	runDisclosureOperabilityAudit,
} from "./audit";
import {
	type CollectedTrigger,
	type DisclosureCollection,
	type DisclosureReading,
	installDisclosureScript,
} from "./browser-scripts";

const TIMEOUT = 100;

function trigger(overrides: Partial<CollectedTrigger> = {}): CollectedTrigger {
	return {
		html: '<button aria-expanded="false">',
		role: null,
		expanded: "false",
		hasControlled: true,
		inTabOrder: true,
		inComposite: false,
		spaceExpected: true,
		link: false,
		...overrides,
	};
}

/** One trigger as a fake page models it. Handlers mutate the state the probe reads back. */
type FakeTrigger = {
	open: boolean;
	/** `aria-expanded` follows `open` unless the page never updates it. */
	exposesState: boolean;
	/** Whether the panel is an `aria-controls` target, or only seen in the page-wide scan. */
	controlled: boolean;
	focusable: boolean;
	focused: boolean;
	connected: boolean;
	/** Elements that came and went by themselves since the trigger was begun. */
	noise: number;
	/**
	 * Focus is somewhere else and will not come back: what the trigger opened keeps it, as a
	 * dialog's focus trap does. The trigger cannot be focused and is not safe to click.
	 */
	trapped: boolean;
	/** Focusing the trigger works, but the page takes focus away again a moment later. */
	losesFocus: boolean;
	/** A modal dialog the trigger is not part of is on show. */
	behindModal: boolean;
	/** Clicks the browser delivered to the trigger: what a key press on a button produces. */
	clicks: number;
	/** Whether a transition is still playing. */
	settling: boolean;
	blocked: { submits: number; navigations: number };
	onKey?: (key: string, self: FakeTrigger) => void;
	onClick?: (self: FakeTrigger) => void;
	onHover?: (on: boolean, self: FakeTrigger) => void;
	onFocus?: (self: FakeTrigger) => void;
	onBlur?: (self: FakeTrigger) => void;
	/** Called on every read, to model changes that take time. */
	onRead?: (self: FakeTrigger, reads: number) => void;
};

function fake(overrides: Partial<FakeTrigger> = {}): FakeTrigger {
	return {
		open: false,
		exposesState: true,
		controlled: true,
		focusable: true,
		focused: false,
		connected: true,
		noise: 0,
		trapped: false,
		losesFocus: false,
		behindModal: false,
		clicks: 0,
		settling: false,
		blocked: { submits: 0, navigations: 0 },
		...overrides,
	};
}

const toggle = (self: FakeTrigger) => {
	self.open = !self.open;
};

/** A button: Enter and Space act only while it has focus, and both click it. */
function button(overrides: Partial<FakeTrigger> = {}): FakeTrigger {
	return fake({
		onKey: (key, self) => {
			if (self.focused && (key === "Enter" || key === "Space")) {
				self.clicks++;
				self.onClick?.(self);
			}
		},
		onClick: toggle,
		...overrides,
	});
}

function fakeProbe(triggers: FakeTrigger[]) {
	const log: string[] = [];
	/** Enter and Space presses that landed somewhere other than on the trigger. */
	const stray: string[] = [];
	let current = 0;
	let reads = 0;
	let replaced = false;

	const guard = () => {
		if (replaced) {
			throw new DocumentReplacedError();
		}
	};

	const read = (index: number): DisclosureReading => {
		guard();

		const self = triggers[index]!;

		self.onRead?.(self, ++reads);

		return {
			connected: self.connected,
			expanded: self.exposesState ? String(self.open) : "false",
			controlled: self.controlled ? self.open : null,
			appeared: (self.controlled ? 0 : Number(self.open)) + self.noise,
			disappeared: 0,
			focused: self.focused,
			settling: self.settling,
			clicks: self.clicks,
			blocked: { ...self.blocked },
		};
	};

	const probe: DisclosureProbe = {
		begin: async (index) => {
			current = index;
			reads = 0;
			triggers[index]!.clicks = 0;
			triggers[index]!.blocked = { submits: 0, navigations: 0 };
			log.push(`begin ${index}`);

			return read(index);
		},
		focus: async (index) => {
			guard();

			const self = triggers[index]!;

			if (self.focusable && !self.trapped && !self.focused) {
				self.focused = true;
				self.onFocus?.(self);
			}

			return self.focused;
		},
		read: async (index) => read(index),
		ready: async (index, action) => {
			guard();

			const self = triggers[index]!;

			if (self.losesFocus) {
				self.focused = false;
			}

			if (!self.connected || self.trapped || self.behindModal) {
				return false;
			}

			return action === "key" ? self.focused : true;
		},
		blur: async (index) => {
			const self = triggers[index]!;

			self.focused = false;
			self.onBlur?.(self);
			log.push("blur");
		},
		pressKey: async (key) => {
			guard();
			log.push(key);

			if (key !== "Escape" && !triggers[current]!.focused) {
				stray.push(key);
			}

			triggers[current]!.onKey?.(key, triggers[current]!);
		},
		click: async (index) => {
			guard();
			log.push("click");
			triggers[index]!.onClick?.(triggers[index]!);
		},
		hover: async (index, on) => {
			log.push(on ? "hover" : "unhover");
			triggers[index]!.onHover?.(on, triggers[index]!);
		},
		end: async (index) => {
			guard();
			log.push(`end ${index}`);
		},
		sleep: async () => {},
	};

	return {
		probe,
		log,
		stray,
		replace: () => {
			replaced = true;
		},
	};
}

async function exercise(model: FakeTrigger, collected: Partial<CollectedTrigger> = {}) {
	const page = fakeProbe([model]);
	const { exercised, stopped } = await runDisclosureLoop(page.probe, [trigger(collected)], TIMEOUT);

	return { ...exercised[0]!, stopped, log: page.log, stray: page.stray };
}

describe("runDisclosureLoop", () => {
	it("presses Enter then Space, closing the trigger with the same key after each", async () => {
		const model = button();
		const { observation, keysTried, log } = await exercise(model);

		expect(keysTried).toEqual(["Enter", "Space"]);
		expect(log).toEqual(["begin 0", "Enter", "Enter", "Space", "Space", "end 0"]);
		expect(observation.attempts).toEqual([
			{
				key: "Enter",
				expandedBefore: "false",
				expandedAfter: "true",
				contentChanged: true,
				restoredBy: "Enter",
			},
			{
				key: "Space",
				expandedBefore: "false",
				expandedAfter: "true",
				contentChanged: true,
				restoredBy: "Space",
			},
		]);
		expect(observation).toMatchObject({
			focusable: true,
			openedOnFocus: null,
			pointer: { click: null, hover: null },
			restored: true,
		});
		expect(model.open).toBe(false);
	});

	it("sends a native link Enter only", async () => {
		const { keysTried } = await exercise(button(), { link: true, spaceExpected: false });

		expect(keysTried).toEqual(["Enter"]);
	});

	it("closes a popup that took focus with Escape, before pressing the key into it", async () => {
		const model = button({
			onClick: (self) => {
				self.open = true;
				self.focused = false;
			},
			onKey: (key, self) => {
				if (key === "Escape") {
					self.open = false;
				} else if (self.focused) {
					self.onClick?.(self);
				}
			},
		});
		const { observation, log } = await exercise(model);

		expect(log).toEqual(["begin 0", "Enter", "Escape", "Space", "Escape", "end 0"]);
		expect(observation.attempts.map(({ restoredBy }) => restoredBy)).toEqual(["Escape", "Escape"]);
		expect(observation.restored).toBe(true);
	});

	it("tries a click and then a hover only when no key changed anything", async () => {
		const { observation, log } = await exercise(fake());

		expect(log).toEqual(["begin 0", "Enter", "Space", "click", "hover", "unhover", "end 0"]);
		expect(observation.attempts.map(({ restoredBy }) => restoredBy)).toEqual([null, null]);
		expect(observation.pointer).toEqual({ click: false, hover: false });
	});

	it("records that a click operates what the keys do not, and clicks again to close it", async () => {
		const model = fake({ onClick: toggle });
		const { observation, log } = await exercise(model);

		expect(log).toEqual(["begin 0", "Enter", "Space", "click", "click", "end 0"]);
		expect(observation.pointer).toEqual({ click: true, hover: null });
		expect(observation.restored).toBe(true);
		expect(model.open).toBe(false);
	});

	it("records a hover-only trigger and lets the pointer leaving close it", async () => {
		const model = fake({
			onHover: (on, self) => {
				self.open = on;
			},
		});
		const { observation, log } = await exercise(model);

		expect(log.slice(3)).toEqual(["click", "hover", "unhover", "end 0"]);
		expect(observation.pointer).toEqual({ click: false, hover: true });
		expect(observation.restored).toBe(true);
	});

	it("goes straight to the pointer when the trigger cannot take focus", async () => {
		const { observation, keysTried, log } = await exercise(
			fake({ focusable: false, onClick: toggle }),
		);

		expect(keysTried).toEqual([]);
		expect(log).toEqual(["begin 0", "click", "click", "end 0"]);
		expect(observation).toMatchObject({ focusable: false, pointer: { click: true, hover: null } });
	});

	it("stops pressing keys on a trigger it could not close, and says the page was left changed", async () => {
		const model = button({
			onClick: (self) => {
				self.open = true;
			},
		});
		const { observation, keysTried, log } = await exercise(model);

		expect(keysTried).toEqual(["Enter"]);
		// The same key, Escape and a click are each tried once.
		expect(log).toEqual(["begin 0", "Enter", "Enter", "Escape", "click", "end 0"]);
		expect(observation.attempts[0]?.restoredBy).toBeNull();
		expect(observation.restored).toBe(false);
		expect(observation.pointer).toEqual({ click: null, hover: null });
	});

	it("presses only Escape once what the trigger opened has taken focus for good", async () => {
		// A dialog with a focus trap: it ignores Escape, and focus cannot be put back on the trigger.
		const model = button({
			onClick: (self) => {
				self.open = true;
				self.focused = false;
				self.trapped = true;
			},
		});
		const { observation, keysTried, log, stray } = await exercise(model);

		// No second Enter, no Space and no click: each would have landed in the dialog.
		expect(log).toEqual(["begin 0", "Enter", "Escape", "end 0"]);
		expect(stray).toEqual([]);
		expect(keysTried).toEqual(["Enter"]);
		expect(observation.attempts[0]?.restoredBy).toBeNull();
		expect(observation.restored).toBe(false);
		expect(observation.pointer).toEqual({ click: null, hover: null });
	});

	it("does not click a trigger that cannot take focus once a popup has taken it", async () => {
		const model = fake({
			focusable: false,
			onClick: (self) => {
				self.open = true;
				self.trapped = true;
			},
		});
		const { observation, log } = await exercise(model);

		expect(log).toEqual(["begin 0", "click", "Escape", "end 0"]);
		expect(observation.pointer).toEqual({ click: true, hover: null });
		expect(observation.restored).toBe(false);
	});

	it("presses no key at all when the page takes focus off the trigger again", async () => {
		const model = button({ losesFocus: true });
		const { observation, keysTried, log, stray } = await exercise(model);

		expect(log).toEqual(["begin 0", "end 0"]);
		expect(stray).toEqual([]);
		expect(keysTried).toEqual([]);
		expect(observation).toMatchObject({ focusable: true, restored: true });
		expect(model.open).toBe(false);
	});

	it("presses no key and makes no click while a modal dialog is on show", async () => {
		const { observation, keysTried, log } = await exercise(button({ behindModal: true }));

		expect(log).toEqual(["begin 0", "end 0"]);
		expect(keysTried).toEqual([]);
		expect(observation.pointer).toEqual({ click: null, hover: null });
	});

	it("runs a handler with no visible effect once: no second key and no scripted click", async () => {
		let calls = 0;
		const model = button({
			onClick: () => {
				calls++;
			},
		});
		const { observation, keysTried, log } = await exercise(model);

		expect(calls).toBe(1);
		expect(keysTried).toEqual(["Enter"]);
		expect(log).toEqual(["begin 0", "Enter", "hover", "unhover", "end 0"]);
		// What a click does is already known, so it is recorded without clicking.
		expect(observation.pointer).toEqual({ click: false, hover: false });
		expect(observation.restored).toBe(true);
	});

	it("gives a handler that ran time to act before deciding the key did nothing", async () => {
		// The toggle lands well after the activation timeout, as a panel built on demand does.
		let due: number | null = null;
		let reads = 0;
		const model = button({
			onClick: () => {
				due = reads + 12;
			},
			onRead: (self) => {
				reads++;

				if (due !== null && reads >= due) {
					due = null;
					self.open = !self.open;
				}
			},
		});
		const { observation, log } = await exercise(model);

		expect(log).toEqual(["begin 0", "Enter", "Enter", "Space", "Space", "end 0"]);
		expect(observation.attempts.map(({ restoredBy }) => restoredBy)).toEqual(["Enter", "Space"]);
		expect(observation.pointer).toEqual({ click: null, hover: null });
		expect(model.open).toBe(false);
	});

	it("waits out a transition during which the trigger ignores input", async () => {
		let ignored = 0;
		let playing = 0;
		const model = button({
			onClick: (self) => {
				if (self.settling) {
					ignored++;
					return;
				}

				self.open = !self.open;
				self.settling = true;
				playing = 6;
			},
			onRead: (self) => {
				if (self.settling && --playing <= 0) {
					self.settling = false;
				}
			},
		});
		const { observation } = await exercise(model);

		expect(ignored).toBe(0);
		expect(observation.attempts.map(({ restoredBy }) => restoredBy)).toEqual(["Enter", "Space"]);
		expect(observation.restored).toBe(true);
		expect(model.open).toBe(false);
	});

	it("stops operating a trigger that tried to submit a form, and says so", async () => {
		const model = button({
			onClick: (self) => {
				self.blocked.submits++;
			},
		});
		const { observation, keysTried, log } = await exercise(model);

		expect(keysTried).toEqual(["Enter"]);
		expect(log).toEqual(["begin 0", "Enter", "end 0"]);
		expect(observation.blocked).toEqual({ submit: true, navigation: false });
		expect(observation.pointer).toEqual({ click: null, hover: null });
	});

	it("stops operating a trigger that tried to leave the page, and says so", async () => {
		const model = button({
			onClick: (self) => {
				self.blocked.navigations++;
			},
		});
		const { observation, keysTried, log } = await exercise(model);

		expect(keysTried).toEqual(["Enter"]);
		expect(log).toEqual(["begin 0", "Enter", "end 0"]);
		expect(observation.blocked).toEqual({ submit: false, navigation: true });
	});

	it("puts back a change that arrives after the audit stopped waiting for it", async () => {
		// A key handler that is not a click, and opens the panel long after the timeout.
		let due: number | null = null;
		let reads = 0;
		const model = fake({
			onKey: (key, self) => {
				if (key === "Escape") {
					self.open = false;
				} else if (key === "Space" && self.focused) {
					due = reads + 14;
				}
			},
			onRead: (self) => {
				reads++;

				if (due !== null && reads >= due) {
					due = null;
					self.open = true;
				}
			},
		});
		const { observation } = await exercise(model);

		expect(observation.restored).toBe(true);
		expect(model.open).toBe(false);
	});

	it("notes a popup only a click closes", async () => {
		const model = fake({
			onKey: (key, self) => {
				if (key !== "Escape") {
					self.open = true;
				}
			},
			onClick: (self) => {
				self.open = false;
			},
		});
		const { observation } = await exercise(model);

		expect(observation.attempts.map(({ restoredBy }) => restoredBy)).toEqual(["click", "click"]);
		expect(observation.restored).toBe(true);
	});

	it("records a trigger that opens on focus, blurs it to close it and presses nothing", async () => {
		const model = button({
			onFocus: (self) => {
				self.open = true;
			},
			onBlur: (self) => {
				self.open = false;
			},
		});
		const { observation, keysTried, log } = await exercise(model);

		expect(keysTried).toEqual([]);
		expect(log).toEqual(["begin 0", "blur", "end 0"]);
		expect(observation.openedOnFocus).toEqual({ expandedChanged: true });
		expect(observation.restored).toBe(true);
	});

	it("waits for a panel that appears after the state has flipped", async () => {
		let shown = false;
		let readsWhileOpen = 0;
		const model = button({
			controlled: false,
			onClick: toggle,
			onRead: (self) => {
				// The panel only joins the page a few reads after the state has flipped.
				readsWhileOpen = self.open ? readsWhileOpen + 1 : 0;
				shown = readsWhileOpen > 2;
			},
		});
		const page = fakeProbe([model]);
		const read = page.probe.read;

		page.probe.read = async (index) => {
			const reading = await read(index);

			return { ...reading, appeared: shown ? 1 : 0 };
		};

		const { exercised } = await runDisclosureLoop(page.probe, [trigger()], TIMEOUT);

		expect(exercised[0]?.observation.attempts[0]).toMatchObject({
			expandedAfter: "true",
			contentChanged: true,
		});
	});

	it("ignores page-wide changes on a page that changes by itself", async () => {
		// A carousel keeps adding elements; the trigger's own panel is only seen page-wide.
		const model = button({
			controlled: false,
			exposesState: false,
			onRead: (self) => {
				self.noise++;
			},
		});
		const { observation, keysTried } = await exercise(model);

		// Enter clicked the button and nothing that can be trusted changed, so Space is not pressed.
		expect(keysTried).toEqual(["Enter"]);
		expect(observation.attempts.map(({ contentChanged }) => contentChanged)).toEqual([false]);
	});

	it("marks a trigger that leaves the document, presses Escape and moves on", async () => {
		const first = button({
			onClick: (self) => {
				self.connected = false;
			},
		});
		const page = fakeProbe([first, button()]);
		const { exercised, stopped } = await runDisclosureLoop(
			page.probe,
			[trigger(), trigger()],
			TIMEOUT,
		);

		expect(stopped).toBeNull();
		expect(exercised[0]?.observation).toMatchObject({ removed: true, navigated: false });
		expect(exercised[0]?.keysTried).toEqual(["Enter"]);
		expect(page.log.slice(0, 5)).toEqual(["begin 0", "Enter", "Escape", "end 0", "begin 1"]);
		expect(exercised[1]?.observation).toMatchObject({ removed: false, restored: true });
	});

	it("stops the loop when the document is replaced, without touching the page again", async () => {
		const page = fakeProbe([button({ onClick: () => page.replace() }), button()]);
		const { exercised, stopped } = await runDisclosureLoop(
			page.probe,
			[trigger(), trigger()],
			TIMEOUT,
		);

		expect(stopped).toBe("navigated");
		expect(exercised).toHaveLength(1);
		expect(exercised[0]?.observation).toMatchObject({ navigated: true });
		expect(page.log).toEqual(["begin 0", "Enter"]);
	});
});

describe("runDisclosureOperabilityAudit", () => {
	function fakePage(collection: DisclosureCollection) {
		return fakeStashAdaptor(installDisclosureScript, collection, "trigger");
	}

	it("rejects a risky-name pattern that is not a valid expression before touching the page", async () => {
		const page = fakePage({ triggers: [], skipped: [], skippedTotal: 0, eligible: 0 });

		await expect(
			runDisclosureOperabilityAudit(page.adaptor, { riskyNamePattern: "(" }),
		).rejects.toThrow(SyntaxError);
	});

	it("returns an empty result when the page has no triggers", async () => {
		const page = fakePage({ triggers: [], skipped: [], skippedTotal: 0, eligible: 0 });

		expect(await runDisclosureOperabilityAudit(page.adaptor)).toEqual({
			failed: [],
			needsReview: [],
			passed: [],
			skipped: [],
			stopped: null,
			summary: { checked: 0, failed: 0, needsReview: 0, passed: 0, skipped: 0, unchecked: 0 },
		});
		expect(page.released()).toBe(true);
	});

	it("lists skipped triggers with their reason and counts those past the list", async () => {
		const page = fakePage({
			triggers: [],
			skipped: [
				{ html: '<a href="/shop" aria-expanded="false">Shop</a>', reason: "navigating-link" },
				{ html: '<button aria-expanded="false">Send</button>', reason: "submits-form" },
			],
			skippedTotal: 14,
			eligible: 0,
		});
		const result = await runDisclosureOperabilityAudit(page.adaptor);

		expect(result.skipped).toEqual([
			{
				selector: "#trigger-0",
				html: '<a href="/shop" aria-expanded="false">',
				reason: "navigating-link",
			},
			{ selector: "#trigger-1", html: '<button aria-expanded="false">', reason: "submits-form" },
		]);
		expect(result.summary).toMatchObject({ checked: 0, skipped: 14 });
	});
});
