/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they must
 * not reference any symbols outside their own scope. Everything that needs the fragment parsing,
 * target resolution or skip-link heuristics goes through `inspectSkipLinkScript`, so there is one
 * copy of that logic and the tests exercise the code that ships.
 */

/** Where the focused element sits relative to a skip link and its target. */
export type SkipLinkFocusPosition =
	/** Focus is on the target or inside it. */
	| "inside-target"
	/** Focus is on content that follows the target in document order. */
	| "after-target"
	/** Focus is on content after the link, and the link has no target to compare against. */
	| "after-link"
	/** Focus is still on the skip link. */
	| "skip-link"
	/** Nothing is focused. */
	| "body"
	/** Focus is somewhere else, such as before the link or between the link and its target. */
	| "elsewhere";

export type SkipLinkUnreachableReason =
	| "not-rendered"
	| "visibility-hidden"
	| "inert"
	| "negative-tabindex";

export type SkipLinkTargetInspection = {
	selector: string;
	/** Opening tag of the target. */
	html: string;
	/** False when the target or an ancestor is `display: none` (or otherwise not rendered). */
	rendered: boolean;
};

export type SkipLinkInspection = {
	/** True when the inspected element is missing or is `<body>`. */
	isBody: boolean;
	/** Opening tag of the inspected element. */
	html: string;
	/** Visible text of the link, falling back to its `aria-label`. */
	linkText: string;
	/**
	 * The same-document fragment the link points at, such as "#main". Null when the element is not a
	 * link to a fragment of this document.
	 */
	fragment: string | null;
	/** Whether the link looks like a skip link rather than a menu toggle or other in-page link. */
	skipLike: boolean;
	target: SkipLinkTargetInspection | null;
	focus: {
		position: SkipLinkFocusPosition;
		/** Whether the document's URL fragment is the one the link points at. */
		navigated: boolean;
	};
};

export type SkipLinkUnreachableInspection = {
	html: string;
	linkText: string;
	fragment: string;
	reason: SkipLinkUnreachableReason;
};

export type SkipLinkInspectionResult = {
	/** The inspected element. Null in "unreachable" mode. */
	link: SkipLinkInspection | null;
	/** Skip links that can never receive focus. Only filled in "unreachable" mode. */
	unreachable: SkipLinkUnreachableInspection[];
};

/** Attribute that marks unreachable skip links so a handle can be taken to each one in turn. */
export const UNREACHABLE_MARKER = "data-a11y-pulse-unreachable-skip-link";

/**
 * Inspect skip links in the page.
 *
 * - "classify": describe `el` and decide whether it is a skip link.
 * - "focus": describe `el` and where keyboard focus is relative to it and its target.
 * - "unreachable": ignore `el` and find skip links that can never receive keyboard focus, marking
 *   each with `data-a11y-pulse-unreachable-skip-link`.
 */
export function inspectSkipLinkScript(
	el: Element | null,
	mode: "classify" | "focus" | "unreachable",
	limit = 3,
): SkipLinkInspectionResult {
	// Letters, digits and underscore in any script. `\b` only knows ASCII, so without this
	// "aller au" matches inside "Smaller audiences" and accented words are cut in two.
	const WORD = "\\p{L}\\p{N}_";
	const START = `(?:^|[^${WORD}])`;
	const END = `(?![${WORD}])`;
	// Verbs and prepositions that mean "go to" as much as "skip to" ("Aller au panier", "Ga naar
	// winkelwagen"), so they only count when a noun from NOUN follows.
	const GO =
		"skip|jump|go|zum|zur|springe|aller|passer|accéder|ir|saltar|salta|vai|passa|pular|avançar|ga|naar|spring|hoppa|hopp|gå|till|siirry|hyppää|przejdź|przeskocz|pomiń|přeskočit|přejít|перейти|пропустить";
	const FILLER =
		"to|the|main|primary|zu|zum|zur|dem|der|direkt|au|aux|à|la|le|du|directement|al|a|el|alla|allo|ai|il|para|o|ao|naar|de|het|direct|till|til|det|do|na|k|ke|głównej|hlavní|hlavnímu|к|основному";
	const NOUN =
		"content|main|navigation|nav|menu|search|footer|\\p{L}*inhalt|\\p{L}*navigation|menü|suche|contenu|recherche|contenido|navegación|menú|búsqueda|contenuto|navigazione|ricerca|conteúdo|navegação|pesquisa|\\p{L}*inhoud|navigatie|zoeken|\\p{L}*innehåll\\p{L}*|navigering\\p{L}*|meny\\p{L}*|\\p{L}*innhold\\p{L}*|\\p{L}*indhold\\p{L}*|navigasjon\\p{L}*|\\p{L}*sisält\\p{L}*|navigaatio\\p{L}*|valikko\\p{L}*|treści|zawartości|nawigacj\\p{L}*|obsah\\p{L}*|navigac\\p{L}*|содержани\\p{L}*|контент\\p{L}*|навигаци\\p{L}*|меню";
	const SKIP_WORDS = new RegExp(
		[
			// "Skip to content", "Aller au contenu", "Ga direct naar de inhoud", "Перейти к содержанию".
			`${START}(?:${GO})(?:\\s+(?:${FILLER})){0,3}\\s+(?:${NOUN})${END}`,
			// Verbs that only ever mean "skip".
			`${START}(?:skip|überspringen)${END}`,
			// Scripts written without spaces between words.
			"スキップ|本文へ|メインコンテンツへ|跳[过過]|跳(?:到|至|转到|轉到)\\s*(?:主要|主|正文|内容|內容|导航|導航)|건너뛰기|본문\\s*(?:으로|바로\\s*가기)",
		].join("|"),
		"iu",
	);
	// A class or id that names the link a skip link: "skip", "skip-link", "skiplink", "skip-to-content".
	const SKIP_TOKEN = /^skip(?:[-_]?(?:link|nav|navigation|main|content|to[-_]?[a-z]+))?$/i;
	// Ids that pages conventionally give their main content when they have no main landmark.
	const CONTENT_ID =
		/^(?:(?:main|page|site|primary|skip)[-_]?)?(?:content|main)(?:[-_]?(?:area|wrapper|container|start))?$|^primary$/i;
	const UNREACHABLE_ATTR = "data-a11y-pulse-unreachable-skip-link";

	function openingTag(node: Element): string {
		return (node.cloneNode(false) as Element).outerHTML;
	}

	function isRendered(node: Element): boolean {
		if (typeof node.checkVisibility === "function") {
			return node.checkVisibility();
		}

		for (let current: Element | null = node; current; current = current.parentElement) {
			if (getComputedStyle(current).display === "none") {
				return false;
			}
		}

		return true;
	}

	function textOf(node: Element): string {
		const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();

		return (text || (node.getAttribute("aria-label") ?? "").trim()).slice(0, 200);
	}

	/** The fragment of a link to this document, or null for any other element or destination. */
	function fragmentOf(node: Element): string | null {
		if (node.tagName !== "A" || !node.hasAttribute("href")) {
			return null;
		}

		let url: URL;
		let here: URL;

		try {
			// `href` is the resolved URL, so `/page#main`, absolute URLs and `<base>` are all handled.
			url = new URL((node as HTMLAnchorElement).href);
			here = new URL(location.href);
		} catch {
			return null;
		}

		if (
			url.origin !== here.origin ||
			url.pathname !== here.pathname ||
			url.search !== here.search
		) {
			return null;
		}

		const hash = url.hash;

		// A bare `#` and `#top` scroll to the top, and hash-router paths are not element ids.
		if (hash === "" || hash === "#" || hash.toLowerCase() === "#top") {
			return null;
		}

		if (hash.startsWith("#/") || hash.startsWith("#!/")) {
			return null;
		}

		return hash;
	}

	/** Resolve a fragment the way browsers do: an id first, then an `<a name>`. */
	function targetOf(fragment: string): Element | null {
		const raw = fragment.slice(1);
		let decoded = raw;

		try {
			decoded = decodeURIComponent(raw);
		} catch {
			// Keep the raw id when it is not valid percent-encoding.
		}

		for (const id of raw === decoded ? [raw] : [raw, decoded]) {
			const byId = document.getElementById(id);

			if (byId) {
				return byId;
			}

			for (const named of Array.from(document.getElementsByName(id))) {
				if (named.tagName === "A") {
					return named;
				}
			}
		}

		return null;
	}

	function follows(node: Node, reference: Node): boolean {
		return Boolean(reference.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
	}

	/** Skip wording in what the link says: its text or its `aria-label`. */
	function hasSkipWords(node: Element): boolean {
		return SKIP_WORDS.test(`${textOf(node)} ${node.getAttribute("aria-label") ?? ""}`);
	}

	/** A class or id that marks the link as a skip link, such as `class="skip-link"`. */
	function hasSkipToken(node: Element): boolean {
		if (SKIP_TOKEN.test(node.id)) {
			return true;
		}

		return (node.getAttribute("class") ?? "").split(/\s+/).some((token) => SKIP_TOKEN.test(token));
	}

	/** Whether the target is the page's main content: the main landmark, a heading, or around either. */
	function isContentTarget(target: Element): boolean {
		if (target.matches('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
			return true;
		}

		const main = document.querySelector('main, [role="main"]');

		if (main) {
			return target === main || target.contains(main) || main.contains(target);
		}

		// Without a main landmark, an id such as "content" or "main-content" is the next best sign.
		return CONTENT_ID.test(target.id || (target.getAttribute("name") ?? ""));
	}

	function isSkipLike(link: Element, target: Element | null): boolean {
		const role = link.getAttribute("role");

		// Disclosure toggles, tabs and link-shaped buttons act on the page instead of moving focus.
		if (link.hasAttribute("aria-expanded") || role === "tab" || role === "button") {
			return false;
		}

		if (hasSkipWords(link) || hasSkipToken(link)) {
			return true;
		}

		// From here on only the target can vouch for the link. Jumping past other controls is not
		// enough: a "Menu" link to a navigation block further down the page does that too.
		if (!target || !follows(target, link)) {
			return false;
		}

		// A menu or panel revealed by `:target` is hidden until its link is followed, and navigation
		// is what a skip link skips, not where one goes without saying so.
		if (!isRendered(target) || target.closest('nav, [role="navigation"]')) {
			return false;
		}

		return isContentTarget(target);
	}

	function targetSelector(target: Element): string {
		if (target.id) {
			return `#${CSS.escape(target.id)}`;
		}

		return `a[name="${CSS.escape(target.getAttribute("name") ?? "")}"]`;
	}

	function unreachableReason(link: Element): SkipLinkUnreachableReason | null {
		if (!isRendered(link)) {
			return "not-rendered";
		}

		const visibility = getComputedStyle(link).visibility;

		if (visibility === "hidden" || visibility === "collapse") {
			return "visibility-hidden";
		}

		if (link.closest("[inert]")) {
			return "inert";
		}

		const tabindex = link.getAttribute("tabindex");

		if (tabindex !== null && Number.parseInt(tabindex, 10) < 0) {
			return "negative-tabindex";
		}

		return null;
	}

	if (mode === "unreachable") {
		const unreachable: SkipLinkUnreachableInspection[] = [];

		for (const marked of Array.from(document.querySelectorAll(`[${UNREACHABLE_ATTR}]`))) {
			marked.removeAttribute(UNREACHABLE_ATTR);
		}

		// Skip links sit at the top of the document, so only its first links are worth reading.
		for (const link of Array.from(document.querySelectorAll("a[href]")).slice(0, 50)) {
			if (unreachable.length >= limit) {
				break;
			}

			const fragment = fragmentOf(link);

			// Only what the link says counts here. A hidden link is not about to be followed, so there
			// is no target behaviour to go on, and class names are too loose a sign on their own.
			if (!fragment || !hasSkipWords(link) || !isSkipLike(link, targetOf(fragment))) {
				continue;
			}

			const reason = unreachableReason(link);

			if (!reason) {
				continue;
			}

			const html = openingTag(link);

			link.setAttribute(UNREACHABLE_ATTR, String(unreachable.length));
			unreachable.push({ html, linkText: textOf(link), fragment, reason });
		}

		return { link: null, unreachable };
	}

	if (!el || el === document.body || el === document.documentElement) {
		return {
			link: {
				isBody: true,
				html: "",
				linkText: "",
				fragment: null,
				skipLike: false,
				target: null,
				focus: { position: "body", navigated: false },
			},
			unreachable: [],
		};
	}

	const fragment = fragmentOf(el);
	const target = fragment ? targetOf(fragment) : null;

	// Compare document positions on the light-DOM host, and identity on the deepest focused node.
	const host = document.activeElement;
	let active = host;

	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}

	let position: SkipLinkFocusPosition = "elsewhere";

	if (!host || !active || host === document.body || host === document.documentElement) {
		position = "body";
	} else if (active === el) {
		position = "skip-link";
	} else if (target && (active === target || target.contains(active) || target.contains(host))) {
		position = "inside-target";
	} else if (target && follows(host, target)) {
		position = "after-target";
	} else if (!target && follows(host, el)) {
		position = "after-link";
	}

	return {
		link: {
			isBody: false,
			html: openingTag(el),
			linkText: textOf(el),
			fragment,
			skipLike: mode === "classify" && fragment !== null ? isSkipLike(el, target) : false,
			target: target
				? {
						selector: targetSelector(target),
						html: openingTag(target),
						rendered: isRendered(target),
					}
				: null,
			focus: { position, navigated: fragment !== null && location.hash === fragment },
		},
		unreachable: [],
	};
}

/**
 * Return the focused element, descending open shadow roots.
 */
export function activeElementHandleScript(): Element | null {
	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	return el;
}

/**
 * Return the next skip link marked by `inspectSkipLinkScript` in "unreachable" mode, removing its
 * marker so the following call returns the one after it.
 */
export function takeUnreachableSkipLinkScript(): Element | null {
	const marked = document.querySelector("[data-a11y-pulse-unreachable-skip-link]");

	marked?.removeAttribute("data-a11y-pulse-unreachable-skip-link");

	return marked;
}

export type SkipLinkPageState = {
	href: string;
	scrollX: number;
	scrollY: number;
	/** `history.length` before the link was activated, to tell whether following it added an entry. */
	historyLength: number;
};

export function readPageStateScript(): SkipLinkPageState {
	return {
		href: location.href,
		scrollX: window.scrollX,
		scrollY: window.scrollY,
		historyLength: history.length,
	};
}

/**
 * Put the URL, the `:target` element and the scroll position back the way they were before a skip
 * link was activated, so whatever runs next sees the page as it was loaded.
 *
 * Following a fragment link adds a history entry, so the way back is to go back: that returns the
 * document to the entry it was on, which also resets `:target` (rewriting the URL with
 * `replaceState` does not). The entry that was added stays ahead in the history as a forward entry,
 * because nothing can remove one. When the URL changed without a new entry, or by more than its
 * fragment, the URL is rewritten in place instead and `:target` is left as it is.
 */
export function restorePageStateScript(state: SkipLinkPageState): Promise<void> {
	const withoutFragment = (href: string): string => href.split("#")[0] ?? href;

	const rewrite = (): void => {
		if (location.href === state.href) {
			return;
		}

		try {
			history.replaceState(history.state, "", state.href);
		} catch {
			// Documents that cannot rewrite their URL (`about:blank`, sandboxed frames) keep the hash.
		}
	};

	const scroll = (): void => {
		window.scrollTo(state.scrollX, state.scrollY);
	};

	if (
		location.href === state.href ||
		withoutFragment(location.href) !== withoutFragment(state.href) ||
		history.length !== state.historyLength + 1
	) {
		rewrite();
		scroll();

		return Promise.resolve();
	}

	return new Promise((resolve) => {
		let settled = false;

		const settle = (): void => {
			if (settled) {
				return;
			}

			settled = true;
			window.removeEventListener("popstate", onPopState);
			rewrite();
			scroll();
			resolve();
		};

		// The browser finishes a traversal (its own scroll restoration, and moving the point Tab
		// starts from) when it next renders, so wait that out instead of racing it. The timer is
		// for a page that is not being rendered and so never gets its frames.
		const onPopState = (): void => {
			requestAnimationFrame(() => requestAnimationFrame(settle));
			setTimeout(settle, 100);
		};

		window.addEventListener("popstate", onPopState);
		// A traversal that the page or the browser never completes must not hold the audit up.
		setTimeout(settle, 1000);
		history.back();
	});
}

export function focusScript(el: Element | null): void {
	(el as HTMLElement | null)?.focus();
}

/**
 * Drop focus and put the point sequential focus navigation starts from back at the top of the
 * document, so the next Tab press reaches the first tab stop as it would on a freshly loaded page.
 * Blurring alone leaves that point where focus last was: on a skip link's target, mid-page.
 *
 * The point is moved by focusing a throwaway node. On a page with a positive `tabindex` the node
 * has to stay in front of the first element in the tab order until focus next moves, and removes
 * itself then; otherwise it is taken straight out again and nothing is left behind.
 */
export function resetFocusScript(): Promise<void> {
	// Must be a string literal inside this function: it is serialized into the page.
	const anchorAttr = "data-a11y-pulse-skip-link-focus-start";

	// Following a fragment, or going back from one, moves the starting point when the browser next
	// renders. Resetting it before then would be undone, so let pending frames run first. The timer
	// is for a page that is not being rendered and so never gets its frames.
	return new Promise((resolve) => {
		let done = false;

		const run = (): void => {
			if (done) {
				return;
			}

			done = true;

			try {
				reset();
			} finally {
				resolve();
			}
		};

		requestAnimationFrame(() => requestAnimationFrame(run));
		setTimeout(run, 100);
	});

	function reset(): void {
		let active = document.activeElement;

		while (active?.shadowRoot?.activeElement) {
			active = active.shadowRoot.activeElement;
		}

		(active as HTMLElement | null)?.blur?.();

		for (const leftover of Array.from(document.querySelectorAll(`[${anchorAttr}]`))) {
			leftover.remove();
		}

		const root = document.documentElement;
		const body = document.body;

		if (!root || !body) {
			return;
		}

		const place = (parent: Node, before: Node | null): HTMLElement | null => {
			const anchor = document.createElement("span");

			anchor.tabIndex = -1;
			anchor.setAttribute(anchorAttr, "");
			anchor.setAttribute("aria-hidden", "true");
			anchor.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;outline:none";

			try {
				parent.insertBefore(anchor, before);
				anchor.focus({ preventScroll: true });
			} catch {
				// A document that refuses the node is left as it is.
			}

			if (document.activeElement === anchor) {
				return anchor;
			}

			anchor.remove();

			return null;
		};

		// A positive tabindex puts its element ahead of everything else, lowest value first.
		let first: Element | null = null;
		let lowest = Number.POSITIVE_INFINITY;

		for (const candidate of Array.from(document.querySelectorAll("[tabindex]"))) {
			const tabIndex = (candidate as HTMLElement).tabIndex;

			if (tabIndex <= 0 || tabIndex >= lowest) {
				continue;
			}

			if (
				candidate.matches(":disabled") ||
				candidate.closest("[inert]") ||
				(typeof candidate.checkVisibility === "function" &&
					!candidate.checkVisibility({ checkVisibilityCSS: true }))
			) {
				continue;
			}

			first = candidate;
			lowest = tabIndex;
		}

		if (first?.parentNode) {
			const anchor = place(first.parentNode, first);

			if (anchor) {
				anchor.blur();

				const cleanUp = (event: Event): void => {
					if (event.target !== anchor) {
						anchor.remove();
						window.removeEventListener("focus", cleanUp, true);
					}
				};

				window.addEventListener("focus", cleanUp, true);

				return;
			}
		}

		// Ahead of <body> first, so that a focusable <body> is still the first stop.
		const places: Array<[Node, Node | null]> = [
			[root, body],
			[body, body.firstChild],
		];

		for (const [parent, before] of places) {
			const anchor = place(parent, before);

			if (anchor) {
				anchor.remove();

				return;
			}
		}
	}
}
