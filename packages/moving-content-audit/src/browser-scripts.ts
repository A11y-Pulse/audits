/**
 * IMPORTANT: The `*Script` functions in this file are serialized and injected into the audited
 * page, so they must not reference any symbols outside their own scope.
 */

import type { Rect } from "@a11y-pulse/browser-adaptor";

export type CollectedAnimation = {
	name: string | null;
	/** A CSS animation, as opposed to one a script started through the Web Animations API. */
	css: boolean;
	infinite: boolean;
	activeDurationMs: number | null;
	/** Properties whose value changes over the animation. Empty when they could not be read. */
	properties: string[];
	/** The pseudo-element the animation runs on, such as `::after`. Null for the element itself. */
	pseudoElement: string | null;
	/** The pseudo-element's own area in CSS px², or null when its size could not be read. */
	pseudoArea: number | null;
};

export type CollectedVideo = {
	controls: boolean;
	/** The video loops, or is a live stream with no end. */
	endless: boolean;
	/** Null for a live stream or a video whose length is not known yet. */
	durationS: number | null;
	/** The video was already playing when observation started. */
	playingAtStart: boolean;
	/** Its playback position moved during observation. */
	advanced: boolean;
};

export type CollectedControl = {
	/** Index of the control in the stash. */
	elementIndex: number;
	html: string;
	name: string;
	foundBy: "name" | "attribute" | "page-control";
};

export type CollectedRegion = {
	/** Index of the region's element in the stash. */
	elementIndex: number;
	/** Shallow outerHTML. */
	html: string;
	/** The visible part of the region, in document coordinates. */
	rect: Rect;
	/**
	 * When, in ms since observation started, an element in the region was seen to change position,
	 * size, visibility or scroll offset, or a short animation was seen to start on it. The changes
	 * that first brought an element into view are left out.
	 */
	times: number[];
	/** Every element seen changing only came into view, or was only inserted, during the watch. */
	appeared: boolean;
	/** Animations still running that last longer than the limit. */
	animations: CollectedAnimation[];
	/** Set for a `<marquee>`: its `loop` count, -1 for endless. */
	marquee: { loop: number } | null;
	video: CollectedVideo | null;
	control: CollectedControl | null;
	pausesOn: ("hover" | "focus")[];
	reducedMotion: boolean | null;
};

export type RegionCollection = {
	/** How long the page was observed for. */
	elapsedMs: number;
	regions: CollectedRegion[];
	/** Every moving region, including those past the region limit. */
	total: number;
	/** Moving regions under the size threshold. */
	tooSmall: number;
	/** Moving progress indicators, status messages and busy regions. */
	essential: number;
};

export type CollectOptions = {
	/** Animations no longer than this are allowed to run to their end. */
	durationLimitMs: number;
	minRegionArea: number;
	regionLimit: number;
	/** Regular expression source matched against a nearby control's label. */
	controlNamePattern: string;
	/** Regular expression source matched against an unlabelled nearby control's class and id. */
	controlAttributePattern: string;
	/** Regular expression source matched against the label of any control on the page. */
	pageControlPattern: string;
	/** Regular expression source matched against the class and id of loading indicators. */
	essentialPattern: string;
};

type TrackedElement = {
	signature: string;
	/**
	 * When the script touched the element in a way that is itself a change (an attribute, a
	 * scroll), provided the element was showing. Only counted once a visible change follows.
	 */
	initial: number | null;
	/** When the element was seen to look different from the sample before. */
	times: number[];
	/** When the element came into view during the watch. Null when it was showing all along. */
	appearedAt: number | null;
	/** Still inside the run of changes that brought the element into view. */
	entering: boolean;
	/** When the element was last touched or seen to change. */
	lastActivity: number;
	wasShown: boolean;
	/** The element or an ancestor is fixed to the viewport. */
	fixed: boolean;
};

type ObservationState = {
	start: number;
	tracked: Map<Element, TrackedElement>;
	/** When each short animation on an element was first seen. */
	starts: Map<Element, number[]>;
	/** Elements seen showing at some point during the watch. */
	shownOnce: WeakSet<Element>;
	videos: Map<HTMLVideoElement, { time: number; playing: boolean }>;
	poll: () => void;
	stop: () => void;
};

/**
 * Start watching the page for movement nothing asked for. Records, on `window[stateKey]`, when
 * elements a script touches change position, size, visibility or scroll offset, and when short
 * animations start. Changes that bring an element into view (a banner sliding in, a slot being
 * filled) are its entrance, not movement, and are left out: a run of changes ends once
 * `quietGapMs` passes without one. collectRegionsScript reads the record and stops the watch.
 */
export function startObservationScript(
	stateKey: string,
	pollMs: number,
	durationLimitMs: number,
	trackLimit: number,
	quietGapMs: number,
): void {
	const TIMES_LIMIT = 400;
	// SVG is moved by rewriting its geometry attributes as often as by styling it.
	const SVG_ATTRIBUTES = [
		"transform",
		"d",
		"points",
		"x",
		"y",
		"x1",
		"y1",
		"x2",
		"y2",
		"cx",
		"cy",
		"r",
		"rx",
		"ry",
		"width",
		"height",
		"viewBox",
	];
	// An entrance that never pauses stops being an entrance after this many quiet gaps.
	const ENTRANCE_GAPS = 2;
	// With the watch full, an element that changed in the past makes room once it has been still for
	// this many quiet gaps.
	const EVICT_GAPS = 3;
	const store = window as unknown as Record<string, ObservationState | undefined>;

	store[stateKey]?.stop();

	const start = performance.now();
	const tracked = new Map<Element, TrackedElement>();
	const starts = new Map<Element, number[]>();
	const shownOnce = new WeakSet<Element>();
	// When each element the page inserted during the watch was inserted.
	const added = new WeakMap<Element, number>();
	const seenAnimations = new WeakSet<Animation>();
	const videos = new Map<HTMLVideoElement, { time: number; playing: boolean }>();

	// What an element looks like from the outside: where it is, how large, whether it shows, how far
	// it has scrolled and what image it carries. Text is left out on purpose, since a clock or a
	// counter updating is not movement.
	const signatureOf = (el: Element): string => {
		const rect = el.getBoundingClientRect();
		const style = getComputedStyle(el);

		return [
			Math.round(rect.left + window.scrollX),
			Math.round(rect.top + window.scrollY),
			Math.round(rect.width),
			Math.round(rect.height),
			Math.round(Number.parseFloat(style.opacity) * 20),
			style.visibility,
			style.transform,
			Math.round(el.scrollLeft),
			Math.round(el.scrollTop),
			style.backgroundPosition,
			style.backgroundImage.slice(0, 120),
			(el as HTMLImageElement).currentSrc ?? "",
			// A rotation about its own centre leaves a shape's box where it was.
			el instanceof SVGElement ? (el.getAttribute("transform") ?? "") : "",
		].join("|");
	};

	const isFixed = (el: Element): boolean => {
		for (let node: Element | null = el; node; node = node.parentElement) {
			if (getComputedStyle(node).position === "fixed") {
				return true;
			}
		}

		return false;
	};

	// Whether any of the element can be seen: rendered, not transparent or hidden, and lying at
	// least partly inside the document (inside the viewport, when it is fixed to it).
	const isShown = (el: Element, fixed: boolean): boolean => {
		if (!el.isConnected) {
			return false;
		}

		if (typeof el.checkVisibility === "function") {
			if (
				!el.checkVisibility({
					opacityProperty: true,
					visibilityProperty: true,
					contentVisibilityAuto: true,
				})
			) {
				return false;
			}
		} else {
			const style = getComputedStyle(el);

			if (style.visibility !== "visible" || Number.parseFloat(style.opacity) === 0) {
				return false;
			}
		}

		const rect = el.getBoundingClientRect();

		if (rect.width <= 0 || rect.height <= 0) {
			return false;
		}

		if (fixed) {
			return (
				rect.right > 0 &&
				rect.bottom > 0 &&
				rect.left < window.innerWidth &&
				rect.top < window.innerHeight
			);
		}

		const root = document.documentElement;

		return (
			rect.right + window.scrollX > 0 &&
			rect.bottom + window.scrollY > 0 &&
			rect.left + window.scrollX < Math.max(root.scrollWidth, root.clientWidth) &&
			rect.top + window.scrollY < Math.max(root.scrollHeight, root.clientHeight)
		);
	};

	const addedAt = (el: Element): number | null => {
		for (let node: Element | null = el; node; node = node.parentElement) {
			const time = added.get(node);

			if (time !== undefined) {
				return time;
			}
		}

		return null;
	};

	// Make room for one more element by dropping one that has settled: gone from the page, touched
	// without ever changing, or changed a while ago and still since.
	const makeRoom = (now: number): boolean => {
		let settled: Element | null = null;

		for (const [el, record] of tracked) {
			const idle = now - record.lastActivity;

			if (!el.isConnected || (record.times.length === 0 && idle > quietGapMs)) {
				tracked.delete(el);

				return true;
			}

			if (settled === null && idle > quietGapMs * EVICT_GAPS) {
				settled = el;
			}
		}

		return settled !== null && tracked.delete(settled);
	};

	/**
	 * `how` is what the script did: changed one of the element's own attributes or scrolled it
	 * (`changed`), gave it children when it had none (`filled`), or changed its children some other
	 * way (`children`).
	 */
	const track = (el: Element, how: "changed" | "filled" | "children"): void => {
		if (tracked.has(el) || el === document.documentElement || el === document.body) {
			return;
		}

		const now = performance.now() - start;

		if (tracked.size >= trackLimit && !makeRoom(now)) {
			return;
		}

		const fixed = isFixed(el);
		const shown = isShown(el, fixed);
		const inserted = addedAt(el);
		// An element that cannot be seen yet, or that the page has only just put in, is arriving.
		const entering = !shown || (inserted !== null && now - inserted <= quietGapMs);

		if (shown) {
			shownOnce.add(el);
		}

		tracked.set(el, {
			signature: signatureOf(el),
			// Touching an element that is showing is the first sign of a change to it. Gaining
			// children is content arriving, which is not.
			initial: how === "changed" && !entering ? now : null,
			times: [],
			appearedAt: inserted ?? (how === "filled" ? now : null),
			entering,
			lastActivity: now,
			wasShown: shown,
			fixed,
		});
	};

	const observer = new MutationObserver((records) => {
		const now = performance.now() - start;

		for (const record of records) {
			const target = record.target instanceof Element ? record.target : record.target.parentElement;

			if (!target) {
				continue;
			}

			if (record.type !== "childList") {
				track(target, "changed");
				continue;
			}

			const addedElements = [...record.addedNodes].filter((node) => node instanceof Element);
			const removedElements = [...record.removedNodes].filter((node) => node instanceof Element);

			for (const el of addedElements) {
				added.set(el, now);
			}

			// Text swapped for other text is an update, not movement.
			if (addedElements.length === 0 && removedElements.length === 0) {
				continue;
			}

			const filled =
				removedElements.length === 0 && [...target.children].every((child) => added.has(child));

			track(target, filled ? "filled" : "children");
		}
	});

	const observe = (root: Node): void => {
		observer.observe(root, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: [
				"style",
				"class",
				"hidden",
				"src",
				"srcset",
				"aria-hidden",
				"open",
				...SVG_ATTRIBUTES,
			],
		});
	};

	observe(document);

	for (const el of document.querySelectorAll("*")) {
		if (el.shadowRoot) {
			observe(el.shadowRoot);
		}
	}

	const onScroll = (event: Event): void => {
		if (event.target instanceof Element) {
			track(event.target, "changed");
		}
	};

	document.addEventListener("scroll", onScroll, { capture: true, passive: true });

	for (const video of document.querySelectorAll("video")) {
		videos.set(video, { time: video.currentTime, playing: !video.paused && !video.ended });
	}

	const poll = (): void => {
		const now = performance.now() - start;

		for (const [el, record] of tracked) {
			if (!el.isConnected) {
				continue;
			}

			const signature = signatureOf(el);
			const shown = isShown(el, record.fixed);

			if (shown) {
				shownOnce.add(el);
			}

			if (signature !== record.signature) {
				record.signature = signature;

				if (record.entering) {
					// Coming into view: note when, and leave the changes that bring it in uncounted.
					if (shown && record.appearedAt === null) {
						record.appearedAt = now;
					}
				} else if ((shown || record.wasShown) && record.times.length < TIMES_LIMIT) {
					// A change nobody could see, before or after, moved nothing.
					record.times.push(now);
				}

				record.lastActivity = now;
			}

			if (record.entering && shown) {
				record.appearedAt ??= now;

				// The entrance is over once the element holds still, or has gone on too long to be one.
				if (
					now - record.lastActivity > quietGapMs ||
					now - record.appearedAt > quietGapMs * ENTRANCE_GAPS
				) {
					record.entering = false;
				}
			}

			record.wasShown = shown;
		}

		for (const el of starts.keys()) {
			if (isShown(el, false)) {
				shownOnce.add(el);
			}
		}

		const animations = typeof document.getAnimations === "function" ? document.getAnimations() : [];

		for (const animation of animations) {
			const effect = animation.effect;
			const target = effect instanceof KeyframeEffect ? effect.target : null;

			if (!target || animation.playState !== "running" || seenAnimations.has(animation)) {
				continue;
			}

			// A long animation is still there to be read when the window closes. A short one is not, so
			// note when it started: a run of them is how a script animates a carousel.
			if (Number(effect?.getComputedTiming().activeDuration) > durationLimitMs) {
				continue;
			}

			seenAnimations.add(animation);

			const times = starts.get(target) ?? [];

			if (times.length < TIMES_LIMIT) {
				times.push(now);
			}

			starts.set(target, times);
		}
	};

	const timer = setInterval(poll, pollMs);

	const stop = (): void => {
		clearInterval(timer);
		observer.disconnect();
		document.removeEventListener("scroll", onScroll, { capture: true });
		delete store[stateKey];
	};

	store[stateKey] = { start, tracked, starts, shownOnce, videos, poll, stop };

	poll();
}

/**
 * Stop the watch started by startObservationScript, if it is still running.
 */
export function stopObservationScript(stateKey: string): void {
	(window as unknown as Record<string, ObservationState | undefined>)[stateKey]?.stop();
}

/**
 * Stop the watch started by startObservationScript and gather what moved into regions, each with
 * the facts needed to judge it. The region elements and any pause controls found are left on
 * `window[stashKey]`.
 */
export function collectRegionsScript(
	stateKey: string,
	stashKey: string,
	options: CollectOptions,
): RegionCollection {
	const ESSENTIAL_ROLES = new Set(["progressbar", "status", "alert", "timer", "log"]);
	// Things that act on the page they are in. A link goes somewhere else, so one beside a moving
	// region ("Play trailer", "Stop-motion season") is not a control for it.
	const CONTROL_SELECTOR =
		'button, [role="button"], [role="switch"], input[type="button"], input[type="submit"], input[type="checkbox"], summary';
	// A page-wide animation switch may be a link to a setting.
	const PAGE_CONTROL_SELECTOR = `${CONTROL_SELECTOR}, a[href]`;
	// Properties whose animation shows and hides an element, so it can be seen some of the time.
	const SHOWS_AND_HIDES = /^(opacity|visibility)$/i;
	const KEYFRAME_FIELDS = new Set(["offset", "computedOffset", "easing", "composite"]);
	const NAME_LIMIT = 40;
	const RULE_LIMIT = 20000;
	const PAGE_CONTROL_LIMIT = 2000;
	const ANIMATION_LIMIT = 5;
	const TIMES_LIMIT = 400;
	// How far outside the moving region a pause control may sit: this many ancestors up, as long as
	// the ancestor is not much larger than the region.
	const CONTROL_ANCESTORS = 3;
	const CONTROL_SCOPE_GROWTH = 6;

	type Candidate = {
		el: Element;
		/** The elements actually moving, for matching stylesheet rules. */
		targets: Element[];
		times: number[];
		/** Elements seen changing, and how many of them only appeared during the watch. */
		observed: number;
		appeared: number;
		animations: CollectedAnimation[];
		marquee: { loop: number } | null;
		video: CollectedVideo | null;
	};

	type Box = { left: number; top: number; right: number; bottom: number };

	const store = window as unknown as Record<string, unknown>;
	const state = store[stateKey] as ObservationState | undefined;

	state?.poll();
	state?.stop();

	const elapsedMs = state ? performance.now() - state.start : 0;

	const controlName = new RegExp(options.controlNamePattern, "iu");
	const controlAttribute = new RegExp(options.controlAttributePattern, "i");
	const pageControl = new RegExp(options.pageControlPattern, "i");
	const essentialHint = new RegExp(options.essentialPattern, "i");

	const isRoot = (el: Element | null): boolean =>
		!el || el === document.body || el === document.documentElement;

	const isRendered = (el: Element): boolean => {
		if (!el.isConnected) {
			return false;
		}

		if (typeof el.checkVisibility === "function" && !el.checkVisibility()) {
			return false;
		}

		const rect = el.getBoundingClientRect();

		return rect.width > 0 && rect.height > 0;
	};

	// Rendered, and neither it nor an ancestor is transparent or `visibility: hidden`.
	const isVisible = (el: Element): boolean => {
		if (!isRendered(el)) {
			return false;
		}

		if (typeof el.checkVisibility === "function") {
			return el.checkVisibility({
				opacityProperty: true,
				visibilityProperty: true,
				contentVisibilityAuto: true,
			});
		}

		for (let node: Element | null = el; node; node = node.parentElement) {
			const style = getComputedStyle(node);

			if (
				Number.parseFloat(style.opacity) === 0 ||
				(node === el && style.visibility !== "visible")
			) {
				return false;
			}
		}

		return true;
	};

	// Whether a moving element could be seen at the end of the watch or at some point during it. A
	// slide that has just faded out counts; a hidden preloader whose animation never stopped, or a
	// slide parked off-state the whole time, does not.
	const wasVisible = (candidate: Candidate, el: Element): boolean =>
		isVisible(el) ||
		state?.shownOnce.has(candidate.el) === true ||
		(isRendered(el) &&
			(isRoot(el.parentElement) || isVisible(el.parentElement!)) &&
			candidate.animations.some(
				(animation) =>
					animation.pseudoElement === null &&
					animation.properties.some((property) => SHOWS_AND_HIDES.test(property)),
			));

	const boxOf = (el: Element): Box => {
		const rect = el.getBoundingClientRect();

		return {
			left: rect.left + window.scrollX,
			top: rect.top + window.scrollY,
			right: rect.right + window.scrollX,
			bottom: rect.bottom + window.scrollY,
		};
	};

	const areaOf = (box: Box): number =>
		Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);

	const intersect = (a: Box, b: Box): Box => ({
		left: Math.max(a.left, b.left),
		top: Math.max(a.top, b.top),
		right: Math.min(a.right, b.right),
		bottom: Math.min(a.bottom, b.bottom),
	});

	const clips = (el: Element): boolean => {
		const style = getComputedStyle(el);

		return style.overflowX !== "visible" || style.overflowY !== "visible";
	};

	// The part of the element a user can see: its box cut down by every ancestor that clips it and
	// by the edges of the document, or of the viewport when it is fixed there.
	const visibleBox = (el: Element): Box => {
		const root = document.documentElement;
		let box = intersect(boxOf(el), {
			left: 0,
			top: 0,
			right: Math.max(root.scrollWidth, root.clientWidth),
			bottom: Math.max(root.scrollHeight, root.clientHeight),
		});

		for (let node: Element | null = el; !isRoot(node); node = node!.parentElement) {
			if (node !== el && clips(node!)) {
				box = intersect(box, boxOf(node!));
			}

			if (getComputedStyle(node!).position === "fixed") {
				box = intersect(box, {
					left: window.scrollX,
					top: window.scrollY,
					right: window.scrollX + window.innerWidth,
					bottom: window.scrollY + window.innerHeight,
				});
			}
		}

		return box;
	};

	// A track sliding inside a smaller clipping box is seen through that box, so the box is the
	// region.
	const regionElementFor = (el: Element): Element => {
		for (let parent = el.parentElement; !isRoot(parent); parent = parent!.parentElement) {
			if (clips(parent!)) {
				return areaOf(boxOf(parent!)) < areaOf(boxOf(el)) - 1 ? parent! : el;
			}
		}

		return el;
	};

	const isEssential = (el: Element): boolean => {
		let depth = 0;

		for (let node: Element | null = el; !isRoot(node); node = node!.parentElement, depth++) {
			const current = node!;

			if (
				ESSENTIAL_ROLES.has(current.getAttribute("role") ?? "") ||
				current.getAttribute("aria-busy") === "true" ||
				current.tagName === "PROGRESS" ||
				current.tagName === "METER"
			) {
				return true;
			}

			if (depth < 3 && essentialHint.test(`${current.getAttribute("class") ?? ""} ${current.id}`)) {
				return true;
			}
		}

		return false;
	};

	const shallowHtml = (el: Element): string => (el.cloneNode(false) as Element).outerHTML;

	const candidates = new Map<Element, Candidate>();

	const candidateFor = (el: Element): Candidate => {
		let candidate = candidates.get(el);

		if (!candidate) {
			candidate = {
				el,
				targets: [],
				times: [],
				observed: 0,
				appeared: 0,
				animations: [],
				marquee: null,
				video: null,
			};
			candidates.set(el, candidate);
		}

		return candidate;
	};

	// Movement seen while watching: elements that changed, and short animations that kept starting.
	if (state) {
		for (const [el, record] of state.tracked) {
			// Being touched by a script is not movement until the element is seen to look different.
			if (record.times.length >= 1) {
				const candidate = candidateFor(el);
				candidate.targets.push(el);
				candidate.times.push(...(record.initial === null ? [] : [record.initial]), ...record.times);
				candidate.observed++;
				candidate.appeared += record.appearedAt === null ? 0 : 1;
			}
		}

		for (const [el, times] of state.starts) {
			if (times.length >= 2) {
				const candidate = candidateFor(el);
				candidate.targets.push(el);
				candidate.times.push(...times);
				candidate.observed++;
			}
		}
	}

	// An animated pseudo-element is sized by itself where its size can be read: a ten-pixel dot
	// blinking in the corner of a card is not the card moving.
	const pseudoAreaOf = (el: Element, pseudo: string): number | null => {
		const style = getComputedStyle(el, pseudo);
		const width = Number.parseFloat(style.width);
		const height = Number.parseFloat(style.height);

		return Number.isFinite(width) && Number.isFinite(height) ? width * height : null;
	};

	const smallPseudoHosts = new Set<Element>();

	// Animations still running that outlast the limit.
	const running = typeof document.getAnimations === "function" ? document.getAnimations() : [];

	for (const animation of running) {
		const effect = animation.effect;

		if (!(effect instanceof KeyframeEffect) || !effect.target) {
			continue;
		}

		if (animation.playState !== "running") {
			continue;
		}

		const activeDuration = Number(effect.getComputedTiming().activeDuration);

		if (!(activeDuration > options.durationLimitMs)) {
			continue;
		}

		let properties: string[] = [];
		let readable = true;

		try {
			const keyframes = effect.getKeyframes();
			const values = new Map<string, Set<string>>();
			const counts = new Map<string, number>();

			for (const keyframe of keyframes) {
				for (const [property, value] of Object.entries(keyframe)) {
					if (KEYFRAME_FIELDS.has(property)) {
						continue;
					}

					values.set(property, (values.get(property) ?? new Set()).add(String(value)));
					counts.set(property, (counts.get(property) ?? 0) + 1);
				}
			}

			// A property missing from a keyframe animates from or to the element's own value.
			properties = [...values.keys()].filter(
				(property) =>
					values.get(property)!.size > 1 || (counts.get(property) ?? 0) < keyframes.length,
			);
		} catch {
			readable = false;
		}

		// Keyframes that all say the same thing change nothing on screen.
		if (readable && properties.length === 0) {
			continue;
		}

		const pseudoElement = effect.pseudoElement ?? null;
		const pseudoArea = pseudoElement === null ? null : pseudoAreaOf(effect.target, pseudoElement);

		if (pseudoArea !== null && pseudoArea < options.minRegionArea) {
			smallPseudoHosts.add(effect.target);
			continue;
		}

		const css = "animationName" in animation;
		const candidate = candidateFor(effect.target);

		candidate.targets.push(effect.target);

		if (candidate.animations.length < ANIMATION_LIMIT) {
			candidate.animations.push({
				name: css
					? String((animation as CSSAnimation).animationName)
					: animation.id !== ""
						? animation.id
						: null,
				css,
				infinite: !Number.isFinite(activeDuration),
				activeDurationMs: Number.isFinite(activeDuration) ? Math.round(activeDuration) : null,
				properties,
				pseudoElement,
				pseudoArea,
			});
		}
	}

	for (const marquee of document.querySelectorAll("marquee")) {
		if (marquee.getAttribute("scrollamount") === "0") {
			continue;
		}

		const loop = Number.parseInt(marquee.getAttribute("loop") ?? "-1", 10);
		const candidate = candidateFor(marquee);

		candidate.targets.push(marquee);
		candidate.marquee = { loop: Number.isNaN(loop) ? -1 : loop };
	}

	for (const video of document.querySelectorAll("video")) {
		if (video.paused || video.ended) {
			continue;
		}

		const before = state?.videos.get(video);
		const candidate = candidateFor(video);

		candidate.targets.push(video);
		candidate.video = {
			controls: video.controls,
			endless: video.loop || video.duration === Number.POSITIVE_INFINITY,
			durationS: Number.isFinite(video.duration) ? video.duration : null,
			playingAtStart: before?.playing ?? false,
			advanced: before !== undefined && video.currentTime !== before.time,
		};
	}

	// Lift each moving element to the region it is seen through, and drop what cannot be seen or is
	// a loading indicator.
	let essential = 0;
	const lifted = new Map<Element, Candidate>();

	const mergeInto = (into: Candidate, from: Candidate): void => {
		into.targets.push(...from.targets);
		into.times.push(...from.times);
		into.observed += from.observed;
		into.appeared += from.appeared;
		into.animations.push(...from.animations.slice(0, ANIMATION_LIMIT - into.animations.length));
		into.marquee ??= from.marquee;
		into.video ??= from.video;
	};

	for (const candidate of candidates.values()) {
		// The browser animates a <marquee> through an element inside it that the page cannot reach.
		const host = (candidate.el.getRootNode() as ShadowRoot).host;
		const el = host?.tagName === "MARQUEE" ? host : candidate.el;

		if (isRoot(el) || !wasVisible(candidate, el)) {
			continue;
		}

		if (isEssential(el)) {
			essential++;
			continue;
		}

		const regionEl = regionElementFor(el);
		const existing = lifted.get(regionEl);

		if (existing) {
			mergeInto(existing, candidate);
		} else {
			lifted.set(regionEl, { ...candidate, el: regionEl });
		}
	}

	// A moving element inside another moving element is part of it.
	const depthOf = (el: Element): number => {
		let depth = 0;

		for (let node = el.parentElement; node; node = node.parentElement) {
			depth++;
		}

		return depth;
	};

	let regions: Candidate[] = [];

	for (const candidate of [...lifted.values()].sort((a, b) => depthOf(a.el) - depthOf(b.el))) {
		const outer = regions.find((region) => region.el.contains(candidate.el));

		if (outer) {
			mergeInto(outer, candidate);
		} else {
			regions.push(candidate);
		}
	}

	// Slides stacked on top of each other, each fading in turn, are one carousel: join regions that
	// mostly overlap under their common parent.
	const commonAncestor = (a: Element, b: Element): Element | null => {
		for (let node: Element | null = a; node; node = node.parentElement) {
			if (node.contains(b)) {
				return node;
			}
		}

		return null;
	};

	for (let merged = true; merged; ) {
		merged = false;

		search: for (const a of regions) {
			for (const b of regions) {
				if (a === b) {
					continue;
				}

				const boxA = visibleBox(a.el);
				const boxB = visibleBox(b.el);
				const smaller = Math.min(areaOf(boxA), areaOf(boxB));

				if (smaller === 0 || areaOf(intersect(boxA, boxB)) < smaller / 2) {
					continue;
				}

				const ancestor = commonAncestor(a.el, b.el);
				const union = areaOf({
					left: Math.min(boxA.left, boxB.left),
					top: Math.min(boxA.top, boxB.top),
					right: Math.max(boxA.right, boxB.right),
					bottom: Math.max(boxA.bottom, boxB.bottom),
				});
				const [keep, drop] = areaOf(boxA) >= areaOf(boxB) ? [a, b] : [b, a];

				mergeInto(keep, drop);

				if (ancestor && !isRoot(ancestor) && areaOf(visibleBox(ancestor)) <= union * 4) {
					keep.el = ancestor;
				}

				regions = regions.filter((region) => region !== drop);
				merged = true;
				break search;
			}
		}
	}

	// Stylesheet rules that pause an animation on hover or focus, and rules under a
	// prefers-reduced-motion query that touch animation.
	const pauseRules: { selector: string; on: "hover" | "focus" }[] = [];
	const reducedMotionSelectors: string[] = [];
	let rulesSeen = 0;

	const walkRules = (rules: CSSRuleList, reduced: boolean): void => {
		for (const rule of rules) {
			if (rulesSeen++ > RULE_LIMIT) {
				return;
			}

			const condition =
				(rule as CSSMediaRule).media?.mediaText ?? (rule as CSSConditionRule).conditionText ?? "";
			const nowReduced = reduced || condition.includes("prefers-reduced-motion");
			const selector = (rule as CSSStyleRule).selectorText;
			const style = (rule as CSSStyleRule).style;

			if (selector && style) {
				if (
					nowReduced &&
					(style.animationName ||
						style.animationDuration ||
						style.animationPlayState ||
						style.animationIterationCount ||
						style.transitionDuration ||
						style.transitionProperty)
				) {
					reducedMotionSelectors.push(selector);
				}

				if (style.animationPlayState === "paused" || style.animationName === "none") {
					if (selector.includes(":hover")) {
						pauseRules.push({ selector, on: "hover" });
					}

					if (selector.includes(":focus")) {
						pauseRules.push({ selector, on: "focus" });
					}
				}
			}

			const nested = (rule as CSSGroupingRule).cssRules;

			if (nested) {
				walkRules(nested, nowReduced);
			}
		}
	};

	for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]) {
		try {
			walkRules(sheet.cssRules, false);
		} catch {
			// A cross-origin stylesheet cannot be read.
		}
	}

	const matches = (el: Element, selector: string): boolean => {
		try {
			return el.matches(selector);
		} catch {
			return false;
		}
	};

	// The selector with its hover and focus conditions taken as met.
	const withoutState = (selector: string): string =>
		selector
			.replace(/(^|[\s>+~,(])(?::hover|:focus-within|:focus-visible|:focus)+/g, "$1*")
			.replace(/:hover|:focus-within|:focus-visible|:focus/g, "");

	const nameOf = (el: Element): string => {
		const labelledBy = (el.getAttribute("aria-labelledby") ?? "")
			.split(/\s+/)
			.map((id) => (id ? (document.getElementById(id)?.textContent ?? "") : ""))
			.join(" ");
		const labels = [...((el as HTMLInputElement).labels ?? [])]
			.map((label) => label.textContent ?? "")
			.join(" ");
		const name =
			el.getAttribute("aria-label") ||
			labelledBy.trim() ||
			labels.trim() ||
			(el.textContent ?? "").trim() ||
			el.getAttribute("title") ||
			el.querySelector("img[alt]")?.getAttribute("alt") ||
			(el as HTMLInputElement).value ||
			"";

		return String(name).replace(/\s+/g, " ").trim();
	};

	const stash: Element[] = [];

	const stashIndex = (el: Element): number => {
		const index = stash.indexOf(el);

		return index === -1 ? stash.push(el) - 1 : index;
	};

	const toControl = (el: Element, foundBy: CollectedControl["foundBy"]): CollectedControl => ({
		elementIndex: stashIndex(el),
		html: shallowHtml(el),
		name: nameOf(el).slice(0, NAME_LIMIT),
		foundBy,
	});

	let pageControlEl: Element | null | undefined;

	const findPageControl = (): Element | null => {
		if (pageControlEl === undefined) {
			pageControlEl = null;

			let seen = 0;

			for (const el of document.querySelectorAll(PAGE_CONTROL_SELECTOR)) {
				if (seen++ > PAGE_CONTROL_LIMIT) {
					break;
				}

				if (pageControl.test(nameOf(el)) && isRendered(el)) {
					pageControlEl = el;
					break;
				}
			}
		}

		return pageControlEl;
	};

	const findControl = (regionEl: Element, regionArea: number): CollectedControl | null => {
		const scopes = [regionEl];

		for (
			let parent = regionEl.parentElement, level = 0;
			!isRoot(parent) && level < CONTROL_ANCESTORS;
			parent = parent!.parentElement, level++
		) {
			if (areaOf(boxOf(parent!)) > regionArea * CONTROL_SCOPE_GROWTH) {
				break;
			}

			scopes.push(parent!);
		}

		const outermost = scopes[scopes.length - 1]!;
		const nearby = [...outermost.querySelectorAll(CONTROL_SELECTOR)];

		if (regionEl.id) {
			nearby.push(...document.querySelectorAll(`[aria-controls~="${CSS.escape(regionEl.id)}"]`));
		}

		const rendered = nearby.filter(isRendered);
		// A long label is a link or a heading inside the moving content, not a control for it.
		const named = rendered.find((el) => {
			const name = nameOf(el);

			return name.length <= NAME_LIMIT && controlName.test(name);
		});

		if (named) {
			return toControl(named, "name");
		}

		const hinted = rendered.find(
			(el) =>
				nameOf(el) === "" && controlAttribute.test(`${el.getAttribute("class") ?? ""} ${el.id}`),
		);

		if (hinted) {
			return toControl(hinted, "attribute");
		}

		const pageWide = findPageControl();

		return pageWide ? toControl(pageWide, "page-control") : null;
	};

	// Elements whose only movement is a pseudo-element too small to report.
	let tooSmall = [...smallPseudoHosts].filter(
		(host) => isVisible(host) && !regions.some((region) => region.el.contains(host)),
	).length;
	const sized: { candidate: Candidate; box: Box }[] = [];

	for (const candidate of regions) {
		const box = visibleBox(candidate.el);
		const area = areaOf(box);

		if (area === 0) {
			continue;
		}

		if (area < options.minRegionArea) {
			tooSmall++;
			continue;
		}

		sized.push({ candidate, box });
	}

	sized.sort((a, b) => areaOf(b.box) - areaOf(a.box));

	const collected: CollectedRegion[] = sized
		.slice(0, options.regionLimit)
		.map(({ candidate, box }) => {
			const cssTargets = candidate.animations.some((animation) => animation.css)
				? [...new Set(candidate.targets)]
				: [];
			const pausesOn = (["hover", "focus"] as const).filter((on) =>
				pauseRules.some(
					(rule) =>
						rule.on === on && cssTargets.some((el) => matches(el, withoutState(rule.selector))),
				),
			);

			return {
				elementIndex: stashIndex(candidate.el),
				html: shallowHtml(candidate.el),
				rect: {
					x: Math.round(box.left),
					y: Math.round(box.top),
					width: Math.round(box.right - box.left),
					height: Math.round(box.bottom - box.top),
				},
				times: [...new Set(candidate.times.map((time) => Math.round(time)))]
					.sort((a, b) => a - b)
					.slice(0, TIMES_LIMIT),
				appeared: candidate.observed > 0 && candidate.appeared === candidate.observed,
				animations: candidate.animations,
				marquee: candidate.marquee,
				video: candidate.video,
				control: findControl(candidate.el, areaOf(box)),
				pausesOn,
				reducedMotion:
					cssTargets.length === 0
						? null
						: cssTargets.some((el) =>
								reducedMotionSelectors.some((selector) => matches(el, selector)),
							),
			};
		});

	store[stashKey] = stash;

	return {
		elapsedMs: Math.round(elapsedMs),
		regions: collected,
		total: sized.length,
		tooSmall,
		essential,
	};
}

export function scrollPositionScript(): { x: number; y: number } {
	return { x: window.scrollX, y: window.scrollY };
}

export function restoreScrollScript(position: { x: number; y: number }): void {
	window.scrollTo({ left: position.x, top: position.y, behavior: "instant" });
}
