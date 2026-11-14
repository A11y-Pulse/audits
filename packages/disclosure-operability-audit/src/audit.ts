import {
	type BrowserAdaptor,
	releaseStashedElements,
	stashedElementSelectors,
} from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import {
	type CollectedTrigger,
	callDisclosureScript,
	type DisclosureAction,
	type DisclosureApi,
	type DisclosureCollection,
	type DisclosureReading,
	installDisclosureScript,
	isDisclosureInstalledScript,
} from "./browser-scripts";
import {
	classifyTrigger,
	type DisclosureAttempt,
	type DisclosureKey,
	type DisclosureObservation,
	type DisclosureRestore,
} from "./classify";
import type { DisclosureOperabilityResult, DisclosureSkipped, DisclosureTrigger } from "./result";

export const DEFAULT_TRIGGER_LIMIT = 20;
export const DEFAULT_ACTIVATION_TIMEOUT_MS = 250;

/**
 * Names the audit will not activate, as the source of a case-insensitive pattern. A control that
 * carries `aria-expanded` but is named for an action that cannot be undone is left alone: the
 * audit cannot tell what its handler does until it has run.
 */
export const DEFAULT_RISKY_NAME_PATTERN =
	"\\b(delete|remove|erase|log\\s?out|sign\\s?out|unsubscribe|pay|buy|purchase|send|order\\s+now|(place|confirm|complete|submit)\\s+(your\\s+|my\\s+)?order)\\b";

/** How many skipped triggers to list. */
const SKIP_LIMIT = 10;

/** Pages with more elements than this are not scanned for content appearing outside `aria-controls`. */
const SCAN_LIMIT = 5000;

const POLL_INTERVAL_MS = 25;

/**
 * The longest a trigger is given to finish what it started: a handler that ran but has not acted
 * yet, or a transition still playing. Pressing a key into a panel that is mid-transition is how a
 * working toggle gets reported as stuck.
 */
const SETTLE_LIMIT_MS = 1000;

/** How long the page is watched untouched, to tell a change the audit caused from one it did not. */
const IDLE_WATCH_MS = 50;

const STASH_KEY = "__a11yPulseDisclosure";

export type DisclosureOperabilityOptions = {
	/**
	 * Max triggers to operate. A page with more is sampled evenly from top to bottom. Defaults to
	 * 20.
	 */
	triggerLimit?: number;
	/**
	 * How long to wait, in milliseconds, for a key press to change something before deciding that it
	 * did nothing. Defaults to 250.
	 */
	activationTimeout?: number;
	/**
	 * Source of a case-insensitive pattern. A trigger whose accessible name matches is listed in
	 * `skipped` as `risky-name` and never activated. Defaults to `DEFAULT_RISKY_NAME_PATTERN`; pass
	 * null to operate every trigger whatever it is called.
	 */
	riskyNamePattern?: string | null;
	/**
	 * Also operate buttons that have `aria-controls` naming hidden content and no `aria-expanded`.
	 * Off by default: without `aria-expanded` nothing says the button is a disclosure, and
	 * operating it runs whatever its handler does.
	 */
	includeControlsOnly?: boolean;
};

/** Thrown by a probe when the document the audit started on has been replaced. */
export class DocumentReplacedError extends Error {
	constructor() {
		super("The document was replaced while a disclosure trigger was being operated");
		this.name = "DocumentReplacedError";
	}
}

/** The browser-coupled seams the audit drives. Faked in unit tests. */
export type DisclosureProbe = {
	/** Record the page as it stands before trigger `index` is touched. */
	begin(index: number): Promise<DisclosureReading>;
	/** Focus the trigger. Resolves to whether it took focus. */
	focus(index: number): Promise<boolean>;
	read(index: number): Promise<DisclosureReading>;
	/** Whether a key press or a click on the trigger would land where it is meant to. */
	ready(index: number, action: DisclosureAction): Promise<boolean>;
	blur(index: number): Promise<void>;
	pressKey(key: DisclosureKey | "Escape"): Promise<void>;
	/** A scripted click on the trigger. */
	click(index: number): Promise<void>;
	/** Scripted pointer events entering (`on`) or leaving the trigger. */
	hover(index: number, on: boolean): Promise<void>;
	/** Put scrolling back as it was when the trigger was begun. */
	end(index: number): Promise<void>;
	sleep(ms: number): Promise<void>;
};

type Exercise = {
	probe: DisclosureProbe;
	index: number;
	timeout: number;
	initial: DisclosureReading;
	/** False when the page changes by itself, so only the trigger's own attributes are trusted. */
	stable: boolean;
};

class TriggerRemoved extends Error {}

function pageDiff({ stable }: Exercise, reading: DisclosureReading): number {
	return stable ? (reading.appeared ?? 0) + (reading.disappeared ?? 0) : 0;
}

function contentChanged(exercise: Exercise, from: DisclosureReading, to: DisclosureReading) {
	return from.controlled !== to.controlled || pageDiff(exercise, from) !== pageDiff(exercise, to);
}

function differs(exercise: Exercise, from: DisclosureReading, to: DisclosureReading): boolean {
	return from.expanded !== to.expanded || contentChanged(exercise, from, to);
}

/**
 * Read until `done` holds or the timeout runs out. Past the timeout it keeps reading for as long
 * as `extend` says the trigger is still busy, up to the settle limit. Resolves to the last reading.
 */
async function poll(
	exercise: Exercise,
	timeout: number,
	done: (reading: DisclosureReading) => boolean,
	extend?: (reading: DisclosureReading) => boolean,
): Promise<DisclosureReading> {
	const { probe, index } = exercise;
	let reading = await probe.read(index);

	for (let waited = 0; ; waited += POLL_INTERVAL_MS) {
		if (!reading.connected) {
			throw new TriggerRemoved();
		}

		if (done(reading)) {
			return reading;
		}

		if (waited >= timeout && !(waited < SETTLE_LIMIT_MS && extend?.(reading))) {
			return reading;
		}

		await probe.sleep(POLL_INTERVAL_MS);
		reading = await probe.read(index);
	}
}

/** Wait for a transition or a resizing panel to come to rest, so the next key is not swallowed. */
async function awaitSettled(exercise: Exercise): Promise<void> {
	const { probe, index } = exercise;
	let calm = 0;

	for (let waited = 0; waited < SETTLE_LIMIT_MS; waited += POLL_INTERVAL_MS) {
		const reading = await probe.read(index);

		if (!reading.connected) {
			throw new TriggerRemoved();
		}

		calm = reading.settling ? 0 : calm + 1;

		if (calm >= 2) {
			return;
		}

		await probe.sleep(POLL_INTERVAL_MS);
	}
}

/**
 * Wait for a key press or click to change the trigger. A state that flips before its panel has
 * begun to animate, or the reverse, is given the rest of the timeout to catch up. `clicksBefore`
 * is the trigger's click count before a key was pressed: once the key has clicked it, a handler is
 * known to have run and is given the settle limit to act.
 */
async function awaitChange(
	exercise: Exercise,
	timeout: number,
	clicksBefore: number | null = null,
): Promise<DisclosureReading> {
	const { initial } = exercise;
	const started = Date.now();
	const busy = (reading: DisclosureReading) =>
		reading.settling || (clicksBefore !== null && reading.clicks > clicksBefore);
	const first = await poll(
		exercise,
		timeout,
		(reading) => differs(exercise, initial, reading),
		busy,
	);

	// A trigger with no aria-expanded has no state to wait for.
	if (!differs(exercise, initial, first) || initial.expanded === null) {
		return first;
	}

	const both = (reading: DisclosureReading) =>
		reading.expanded !== initial.expanded && contentChanged(exercise, initial, reading);

	return poll(
		exercise,
		Math.max(0, timeout - (Date.now() - started)),
		both,
		(reading) => reading.settling,
	);
}

/**
 * Give the trigger keyboard focus and confirm it kept it. A page that hands focus elsewhere, as a
 * dialog's focus trap does, may do so a moment after the trigger is focused, so focus is checked
 * again after a pause. A key is only ever pressed when this resolves to true.
 */
async function focusForKey({ probe, index }: Exercise): Promise<boolean> {
	if (!(await probe.focus(index))) {
		return false;
	}

	await probe.sleep(POLL_INTERVAL_MS);

	return probe.ready(index, "key");
}

/**
 * Put a changed trigger back as it was found: with the key that changed it, then Escape, then a
 * click. Escape goes first when the popup has taken focus, since a key press would land in it.
 *
 * Enter and Space are only pressed while the trigger holds focus, and it is only clicked while
 * focus has not moved elsewhere and no modal dialog is in the way. When what opened keeps focus
 * to itself, Escape is all that is tried and the trigger is reported as not restored.
 */
async function restore(
	exercise: Exercise,
	first: DisclosureRestore,
): Promise<DisclosureRestore | null> {
	const { probe, index, initial, timeout } = exercise;
	const restored = (reading: DisclosureReading) => !differs(exercise, initial, reading);

	/** Resolves to false when the step was not safe to take, and so was not taken. */
	const act = async (step: DisclosureRestore): Promise<boolean> => {
		if (step === "blur") {
			await probe.blur(index);
		} else if (step === "Escape") {
			await probe.pressKey("Escape");
		} else if (step === "click") {
			if (!(await probe.ready(index, "click"))) {
				return false;
			}

			await probe.click(index);
		} else {
			if (!(await focusForKey(exercise))) {
				return false;
			}

			await probe.pressKey(step);
		}

		return true;
	};

	const now = await probe.read(index);
	const order: DisclosureRestore[] =
		first === "Enter" || first === "Space"
			? now.focused
				? [first, "Escape", "click"]
				: ["Escape", first, "click"]
			: [first, "Escape", "click"];

	for (const step of new Set(order)) {
		const { clicks } = await probe.read(index);

		if (!(await act(step))) {
			continue;
		}

		// A click, or a key that clicked the trigger, ran a handler: give it time to act.
		const busy = (reading: DisclosureReading) =>
			reading.settling || step === "click" || reading.clicks > clicks;

		if (restored(await poll(exercise, timeout, restored, busy))) {
			await awaitSettled(exercise);

			return step;
		}
	}

	return null;
}

function keysFor(trigger: CollectedTrigger): DisclosureKey[] {
	// Space scrolls the page on a link rather than activating it.
	return trigger.link && !trigger.spaceExpected ? ["Enter"] : ["Enter", "Space"];
}

type Exercised = { observation: DisclosureObservation; keysTried: DisclosureKey[] };

/** Operate one trigger with the keyboard, then with a pointer if the keyboard did nothing. */
async function exerciseTrigger(
	probe: DisclosureProbe,
	index: number,
	trigger: CollectedTrigger,
	timeout: number,
): Promise<Exercised> {
	const observation: DisclosureObservation = {
		focusable: false,
		inTabOrder: trigger.inTabOrder,
		inComposite: trigger.inComposite,
		spaceExpected: trigger.spaceExpected,
		openedOnFocus: null,
		attempts: [],
		pointer: { click: null, hover: null },
		blocked: { submit: false, navigation: false },
		removed: false,
		navigated: false,
		restored: true,
	};
	const attempts: DisclosureAttempt[] = [];
	const keysTried: DisclosureKey[] = [];
	const done = (): Exercised => ({ observation: { ...observation, attempts }, keysTried });

	const noteBlocked = ({ blocked }: DisclosureReading): boolean => {
		observation.blocked.submit ||= blocked.submits > 0;
		observation.blocked.navigation ||= blocked.navigations > 0;

		return blocked.submits > 0 || blocked.navigations > 0;
	};

	const operate = async (): Promise<void> => {
		const initial = await probe.begin(index);

		if (!initial.connected) {
			throw new TriggerRemoved();
		}

		const exercise: Exercise = { probe, index, timeout, initial, stable: true };

		await probe.sleep(IDLE_WATCH_MS);
		exercise.stable = pageDiff(exercise, await probe.read(index)) === 0;

		const changedFromInitial = (reading: DisclosureReading) => differs(exercise, initial, reading);
		const pointerTimeout = Math.min(timeout, 150);

		const tryHover = async (): Promise<void> => {
			await probe.hover(index, true);
			observation.pointer.hover = changedFromInitial(await awaitChange(exercise, pointerTimeout));
			await probe.hover(index, false);

			if (observation.pointer.hover) {
				const closed = await poll(
					exercise,
					timeout,
					(reading) => !changedFromInitial(reading),
					(reading) => reading.settling,
				);

				observation.restored =
					!changedFromInitial(closed) || (await restore(exercise, "Escape")) !== null;
			}
		};

		const tryPointer = async (): Promise<void> => {
			if (!(await probe.ready(index, "click"))) {
				return;
			}

			await probe.click(index);

			const clicked = await awaitChange(exercise, pointerTimeout);

			observation.pointer.click = changedFromInitial(clicked);

			if (noteBlocked(clicked)) {
				return;
			}

			if (observation.pointer.click) {
				await awaitSettled(exercise);
				observation.restored = (await restore(exercise, "click")) !== null;
				return;
			}

			await tryHover();
		};

		const exerciseKeys = async (): Promise<void> => {
			observation.focusable = await probe.focus(index);

			if (!observation.focusable) {
				await tryPointer();
				return;
			}

			const afterFocus = await poll(exercise, IDLE_WATCH_MS, changedFromInitial);

			if (changedFromInitial(afterFocus)) {
				observation.openedOnFocus = { expandedChanged: afterFocus.expanded !== initial.expanded };
				observation.restored = (await restore(exercise, "blur")) !== null;
				return;
			}

			/** Set when a key clicked the trigger and nothing came of it: a handler ran to no effect. */
			let clickedToNoEffect = false;

			for (const key of keysFor(trigger)) {
				// Never press a key that could land anywhere but on the trigger.
				if (!(await focusForKey(exercise))) {
					return;
				}

				const { clicks } = await probe.read(index);

				keysTried.push(key);
				await probe.pressKey(key);

				const after = await awaitChange(exercise, timeout, clicks);
				const attempt: DisclosureAttempt = {
					key,
					expandedBefore: initial.expanded,
					expandedAfter: after.expanded,
					contentChanged: contentChanged(exercise, initial, after),
					restoredBy: null,
				};

				attempts.push(attempt);

				const stopped = noteBlocked(after);

				if (changedFromInitial(after)) {
					await awaitSettled(exercise);
					attempt.restoredBy = await restore(exercise, key);

					if (attempt.restoredBy === null) {
						observation.restored = false;
						return;
					}
				} else if (after.clicks > clicks) {
					// The other key, and a scripted click, would only run the same handler again.
					clickedToNoEffect = true;
				}

				if (stopped) {
					return;
				}

				if (clickedToNoEffect) {
					break;
				}
			}

			if (attempts.some((attempt) => attempt.restoredBy !== null)) {
				return;
			}

			if (clickedToNoEffect) {
				// The key already clicked it, so what a click does is known.
				observation.pointer.click = false;
				await tryHover();
			} else {
				await tryPointer();
			}
		};

		await exerciseKeys();

		// A change that arrived after the audit stopped waiting for it would otherwise be left
		// behind unreported. Only the trigger's own state is trusted this late.
		const last = await probe.read(index);

		if (!last.connected) {
			throw new TriggerRemoved();
		}

		noteBlocked(last);

		if (
			observation.restored &&
			(last.expanded !== initial.expanded || last.controlled !== initial.controlled)
		) {
			observation.restored = (await restore(exercise, keysTried.at(-1) ?? "click")) !== null;
		}
	};

	try {
		await operate();
	} catch (error) {
		if (error instanceof TriggerRemoved) {
			observation.removed = true;

			// The trigger cannot be operated again, so Escape is the one thing left that may close
			// whatever it opened.
			try {
				await probe.pressKey("Escape");
			} catch {
				// Best effort.
			}
		} else if (error instanceof DocumentReplacedError) {
			observation.navigated = true;
		} else {
			throw error;
		}
	}

	if (!observation.navigated) {
		try {
			await probe.end(index);
		} catch (error) {
			if (!(error instanceof DocumentReplacedError)) {
				throw error;
			}

			observation.navigated = true;
		}
	}

	return done();
}

export type DisclosureLoopResult = {
	exercised: Exercised[];
	stopped: "navigated" | null;
};

/** The engine-neutral loop over the collected triggers. Exported for unit testing with a fake probe. */
export async function runDisclosureLoop(
	probe: DisclosureProbe,
	triggers: readonly CollectedTrigger[],
	timeout: number,
): Promise<DisclosureLoopResult> {
	const exercised: Exercised[] = [];

	for (const [index, trigger] of triggers.entries()) {
		const outcome = await exerciseTrigger(probe, index, trigger, timeout);

		exercised.push(outcome);

		if (outcome.observation.navigated) {
			return { exercised, stopped: "navigated" };
		}
	}

	return { exercised, stopped: null };
}

function createAdaptorProbe(adaptor: BrowserAdaptor): DisclosureProbe {
	const call = async <T>(method: keyof DisclosureApi, ...args: unknown[]): Promise<T> => {
		let answer: unknown;

		try {
			answer = await adaptor.evaluate(callDisclosureScript, STASH_KEY, method, ...args);
		} catch (error) {
			// A navigation in flight fails the call outright. Tell that apart from a real error by
			// asking the page, once it has settled, whether the audit's functions survived.
			await new Promise((resolve) => setTimeout(resolve, 100));

			let installed = false;

			try {
				installed = await adaptor.evaluate(isDisclosureInstalledScript, STASH_KEY);
			} catch {
				// Still navigating.
			}

			if (installed) {
				throw error;
			}

			throw new DocumentReplacedError();
		}

		if (answer !== null && typeof answer === "object" && "gone" in answer) {
			throw new DocumentReplacedError();
		}

		return answer as T;
	};

	return {
		begin: (index) => call("begin", index),
		focus: (index) => call("focus", index),
		read: (index) => call("read", index),
		ready: (index, action) => call("ready", index, action),
		blur: (index) => call("blur", index),
		pressKey: (key) => adaptor.pressKey(key),
		click: (index) => call("click", index),
		hover: (index, on) => call("hover", index, on),
		end: (index) => call("end", index),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	};
}

async function selectorsFor(
	adaptor: BrowserAdaptor,
	collection: DisclosureCollection,
): Promise<{ triggers: string[]; controls: (string | null)[]; skipped: string[] }> {
	const count = collection.triggers.length;
	const all = await stashedElementSelectors(
		adaptor,
		STASH_KEY,
		Array.from({ length: count + collection.skipped.length }, (_, i) => i),
	);

	const withControls = collection.triggers.flatMap((trigger, i) =>
		trigger.hasControlled ? [i] : [],
	);
	const found = await stashedElementSelectors(adaptor, `${STASH_KEY}Controls`, withControls);
	const controls: (string | null)[] = collection.triggers.map(() => null);

	for (const [i, index] of withControls.entries()) {
		controls[index] = found[i]!;
	}

	return { triggers: all.slice(0, count), controls, skipped: all.slice(count) };
}

/**
 * Find the page's disclosure triggers and operate each with Enter and Space, checking that it
 * opens, reports the change through `aria-expanded` and closes again.
 *
 * This activates controls on the page. Links that leave the page, buttons that submit a form,
 * checkboxes, radio buttons and controls named for an action that cannot be undone are never
 * activated; a key is only pressed while the trigger holds focus; and form submissions and
 * navigations to another document are stopped for as long as the audit runs. Every trigger is put
 * back as it was found where the page allows it, along with focus and scrolling.
 */
export async function runDisclosureOperabilityAudit(
	adaptor: BrowserAdaptor,
	options: DisclosureOperabilityOptions = {},
): Promise<DisclosureOperabilityResult> {
	const triggerLimit = options.triggerLimit ?? DEFAULT_TRIGGER_LIMIT;
	const timeout = options.activationTimeout ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
	const riskyNamePattern =
		options.riskyNamePattern === undefined ? DEFAULT_RISKY_NAME_PATTERN : options.riskyNamePattern;

	if (riskyNamePattern !== null) {
		// Fail here, with the caller's pattern in the message, rather than inside the page.
		new RegExp(riskyNamePattern, "i");
	}

	// A trigger that opens on focus only does so on a page that has focus.
	await adaptor.ensureFocusReporting();

	const collection = await adaptor.evaluate(
		installDisclosureScript,
		STASH_KEY,
		triggerLimit,
		SKIP_LIMIT,
		SCAN_LIMIT,
		{ includeControlsOnly: options.includeControlsOnly ?? false, riskyNamePattern },
	);

	let stopped: "navigated" | null = null;

	try {
		// Resolved before anything is pressed: a trigger may not survive being operated.
		const selectors = await selectorsFor(adaptor, collection);

		// The page keeps its own references to the triggers, so the stashes can go now.
		await releaseStashedElements(adaptor, STASH_KEY);
		await releaseStashedElements(adaptor, `${STASH_KEY}Controls`);

		const loop = await runDisclosureLoop(createAdaptorProbe(adaptor), collection.triggers, timeout);

		stopped = loop.stopped;

		const failed: DisclosureTrigger[] = [];
		const needsReview: DisclosureTrigger[] = [];
		const passed: DisclosureTrigger[] = [];

		for (const [index, { observation, keysTried }] of loop.exercised.entries()) {
			const collected = collection.triggers[index]!;
			const { verdict, signals } = classifyTrigger(observation);
			const trigger: DisclosureTrigger = {
				selector: selectors.triggers[index]!,
				html: truncateHtml(collected.html),
				role: collected.role,
				expanded: collected.expanded,
				controls: selectors.controls[index]!,
				signals,
				keysTried,
				attempts: [...observation.attempts],
				pointer: observation.pointer,
				openedOnFocus: observation.openedOnFocus !== null,
				restored: observation.restored && !observation.removed && !observation.navigated,
			};

			(verdict === "failed" ? failed : verdict === "review" ? needsReview : passed).push(trigger);
		}

		const skipped: DisclosureSkipped[] = collection.skipped.map(({ html, reason }, i) => ({
			selector: selectors.skipped[i]!,
			html: truncateHtml(html),
			reason,
		}));

		return {
			failed,
			needsReview,
			passed,
			skipped,
			stopped,
			summary: {
				checked: loop.exercised.length,
				failed: failed.length,
				needsReview: needsReview.length,
				passed: passed.length,
				skipped: collection.skippedTotal,
				unchecked: collection.eligible - loop.exercised.length,
			},
		};
	} finally {
		// Runs on every way out, an exception included: this is what lets forms submit and links
		// navigate again, and puts focus and scrolling back.
		if (stopped === null) {
			try {
				await adaptor.evaluate(callDisclosureScript, STASH_KEY, "finish");
			} catch {
				// The document went away after the last trigger: there is nothing left to tidy.
			}
		}
	}
}
