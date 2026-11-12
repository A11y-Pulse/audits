import type { ElementInspection } from "./adaptor";
import type { RawCandidate } from "./browser-scripts";
import type { ControlSignals, MissingRoleReason, UnreachableReason } from "./result";

/** Events that activate a control. */
const ACTIVATION_EVENTS = new Set(["click", "dblclick"]);

/** Pointer and touch presses: a control, a drag handle or a swipe area. */
const PRESS_EVENTS = new Set([
	"mousedown",
	"mouseup",
	"pointerdown",
	"pointerup",
	"touchstart",
	"touchend",
]);

const KEY_EVENTS = new Set(["keydown", "keyup", "keypress"]);

/**
 * Events a single control has no reason to listen for together. A framework that delegates (React
 * at its root and at each portal container) listens for every event it supports on one element, so
 * a long list that includes several of these is the framework's, not a control's.
 */
const DELEGATION_MARKER_EVENTS = new Set([
	"submit",
	"reset",
	"invalid",
	"change",
	"input",
	"beforeinput",
	"load",
	"error",
	"toggle",
	"play",
	"pause",
	"copy",
	"cut",
	"paste",
	"compositionstart",
	"compositionend",
]);

const DELEGATION_MIN_EVENT_TYPES = 10;
const DELEGATION_MIN_MARKERS = 3;

/** Fewer candidates than this say nothing about what is usual on the page. */
const BLANKET_MIN_CANDIDATES = 20;

/** The share of unreached elements listening for clicks above which the listener is page-wide. */
const BLANKET_SHARE = 0.5;

/** Roles that say nothing about what an element is. */
const EMPTY_ROLES = new Set(["presentation", "none", "generic"]);

/**
 * Roles the browser may compute for an element that a `role` attribute does not show: a custom
 * element that sets one internally. An element with one of these already exposes what it is.
 */
const OPERABLE_ROLES = new Set([
	"button",
	"link",
	"checkbox",
	"switch",
	"radio",
	"tab",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"option",
	"slider",
	"spinbutton",
	"textbox",
	"searchbox",
	"combobox",
	"treeitem",
	"listbox",
	"menu",
	"menubar",
	"tablist",
	"tree",
	"grid",
	"treegrid",
	"radiogroup",
	"toolbar",
	"scrollbar",
	"application",
	"dialog",
	"alertdialog",
]);

export type ClassifiedUnreachable = {
	finding: "unreachable";
	index: number;
	verdict: "failed" | "review";
	reason: UnreachableReason;
	signals: ControlSignals;
};

export type ClassifiedMissingRole = {
	finding: "missing-role";
	index: number;
	verdict: "failed" | "review";
	reason: MissingRoleReason;
	signals: ControlSignals;
	computedRole: string | null;
};

export type Classified = ClassifiedUnreachable | ClassifiedMissingRole;

/** `onclick` and the like as event types, joined with the listeners the browser reported. */
function eventTypes(candidate: RawCandidate, inspection: ElementInspection | undefined): string[] {
	const types = new Set(candidate.handlers.map((handler) => handler.replace(/^on/, "")));

	for (const type of inspection?.listeners ?? []) {
		if (ACTIVATION_EVENTS.has(type) || PRESS_EVENTS.has(type) || KEY_EVENTS.has(type)) {
			types.add(type);
		}
	}

	return [...types].sort();
}

/** The element carries a framework's whole delegated event set. */
function isDelegationRoot(inspection: ElementInspection | undefined): boolean {
	const types = new Set(inspection?.listeners ?? []);

	if (types.size < DELEGATION_MIN_EVENT_TYPES) {
		return false;
	}

	let markers = 0;

	for (const type of types) {
		if (DELEGATION_MARKER_EVENTS.has(type)) {
			markers++;
		}
	}

	return markers >= DELEGATION_MIN_MARKERS;
}

/** The page set a click handler on this element by attribute or property. */
function hasOwnActivationHandler(candidate: RawCandidate): boolean {
	return candidate.handlers.some((handler) => ACTIVATION_EVENTS.has(handler.replace(/^on/, "")));
}

/**
 * Most elements Tab does not reach listen for clicks: a script that instruments every element (click
 * tracking, session replay), so a listener alone no longer marks a control.
 */
function hasBlanketListener(
	candidates: readonly RawCandidate[],
	inspections: readonly ElementInspection[] | null,
): boolean {
	if (inspections === null) {
		return false;
	}

	let unreached = 0;
	let listening = 0;

	for (const candidate of candidates) {
		if (candidate.kind !== "unreached") {
			continue;
		}

		unreached++;

		if (inspections[candidate.index]?.listeners.some((type) => ACTIVATION_EVENTS.has(type))) {
			listening++;
		}
	}

	return unreached >= BLANKET_MIN_CANDIDATES && listening / unreached >= BLANKET_SHARE;
}

function signalsOf(candidate: RawCandidate, listeners: string[]): ControlSignals {
	return {
		listeners,
		role: candidate.role,
		cursorPointer: candidate.cursorPointer,
		tabindex: candidate.tabindex,
	};
}

function classifyUnreached(
	candidate: RawCandidate,
	inspection: ElementInspection | undefined,
	blanket: boolean,
): ClassifiedUnreachable | null {
	if (candidate.roving || candidate.backdrop) {
		return null;
	}

	const ownHandler = hasOwnActivationHandler(candidate);

	// A framework root or portal container with nothing focusable inside: its listeners are there
	// whether or not anything in it can be operated.
	if (isDelegationRoot(inspection) && !candidate.widgetRole && !ownHandler) {
		return null;
	}

	const listeners = eventTypes(candidate, inspection);
	const activates = listeners.some((type) => ACTIVATION_EVENTS.has(type));
	const presses = listeners.some((type) => PRESS_EVENTS.has(type));
	const scriptFocusOnly = candidate.tabindex !== null && candidate.tabindex < 0;
	let verdict: ClassifiedUnreachable["verdict"];
	let reason: UnreachableReason;

	if (candidate.widgetRole || activates) {
		if (scriptFocusOnly) {
			verdict = "review";
			reason = "script-focus-only";
		} else if (candidate.widgetRole) {
			verdict = "failed";
			reason = "widget-role";
		} else if (blanket && !ownHandler && !candidate.cursorSetHere) {
			verdict = "review";
			reason = "blanket-listener";
		} else if (candidate.containerLike && !candidate.cursorPointer) {
			verdict = "review";
			reason = "container-handler";
		} else {
			verdict = "failed";
			reason = "click-handler";
		}
	} else if (candidate.hiddenControlLabel) {
		verdict = "failed";
		reason = "hidden-control-label";
	} else if (presses) {
		verdict = "review";
		reason = "press-handler";
	} else if (candidate.cursorSetHere) {
		verdict = "review";
		reason = "pointer-cursor";
	} else {
		return null;
	}

	return {
		finding: "unreachable",
		index: candidate.index,
		verdict,
		reason,
		signals: signalsOf(candidate, listeners),
	};
}

function classifyFocused(
	candidate: RawCandidate,
	inspection: ElementInspection | undefined,
	blanket: boolean,
): ClassifiedMissingRole | null {
	if (candidate.role !== null && !EMPTY_ROLES.has(candidate.role)) {
		return null;
	}

	const computedRole = inspection?.role?.toLowerCase() ?? null;

	if (computedRole !== null && OPERABLE_ROLES.has(computedRole)) {
		return null;
	}

	const listeners = eventTypes(candidate, inspection);
	const handles = listeners.some((type) => ACTIVATION_EVENTS.has(type) || KEY_EVENTS.has(type));
	let verdict: ClassifiedMissingRole["verdict"];
	let reason: MissingRoleReason;

	if (handles) {
		// Without the browser's word, a custom element may still set its role internally.
		const unknownInternals = candidate.customElement && computedRole === null;
		const onlyClicks = !listeners.some((type) => KEY_EVENTS.has(type));

		if (candidate.holdsTabbable || isDelegationRoot(inspection)) {
			// A scrollable region or a framework root that takes focus: what it listens for most
			// likely serves the controls inside it.
			verdict = "review";
			reason = "container-handler";
		} else if (
			blanket &&
			candidate.handlers.length === 0 &&
			onlyClicks &&
			!candidate.cursorPointer
		) {
			verdict = "review";
			reason = "blanket-listener";
		} else {
			verdict = unknownInternals ? "review" : "failed";
			reason = unknownInternals ? "custom-element" : "handler-without-role";
		}
	} else if (candidate.cursorPointer) {
		verdict = "review";
		reason = "pointer-cursor";
	} else {
		// A focusable element with no sign of being a control: a scrollable region, a focus target.
		return null;
	}

	return {
		finding: "missing-role",
		index: candidate.index,
		verdict,
		reason,
		signals: signalsOf(candidate, listeners),
		computedRole,
	};
}

/**
 * Decide which candidates to report. `inspections` is what the browser said about each candidate,
 * by index, or null when it could not be asked.
 */
export function classifyCandidates(
	candidates: readonly RawCandidate[],
	inspections: readonly ElementInspection[] | null,
): Classified[] {
	const classified = new Map<number, Classified>();
	const blanket = hasBlanketListener(candidates, inspections);

	for (const candidate of candidates) {
		const inspection = inspections?.[candidate.index];
		const result =
			candidate.kind === "focused"
				? classifyFocused(candidate, inspection, blanket)
				: classifyUnreached(candidate, inspection, blanket);

		if (result) {
			classified.set(candidate.index, result);
		}
	}

	const byIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));

	const failedAncestor = (index: number): boolean => {
		for (let parent = byIndex.get(index)?.parent ?? null; parent !== null; ) {
			if (classified.get(parent)?.verdict === "failed") {
				return true;
			}

			parent = byIndex.get(parent)?.parent ?? null;
		}

		return false;
	};

	// A weaker report on an element around or inside a control already reported says nothing new.
	const holdsFailed = new Set<number>();

	for (const result of classified.values()) {
		if (result.verdict !== "failed") {
			continue;
		}

		for (let parent = byIndex.get(result.index)?.parent ?? null; parent !== null; ) {
			holdsFailed.add(parent);
			parent = byIndex.get(parent)?.parent ?? null;
		}
	}

	return [...classified.values()].filter(
		(result) =>
			result.finding !== "unreachable" ||
			result.verdict === "failed" ||
			(!holdsFailed.has(result.index) && !failedAncestor(result.index)),
	);
}
