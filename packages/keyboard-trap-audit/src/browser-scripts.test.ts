// @vitest-environment happy-dom
import { TABBABLE_SELECTOR } from "@a11y-pulse/tab-orchestrator";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	CONTAINER_ATTR,
	clearContainerScript,
	containerHandleScript,
	escapeIgnoredScript,
	focusOutsideScript,
	focusSelectorScript,
	inspectRingScript,
	leaveOutsideScript,
	outsideOpenedScript,
	probeFocusScript,
	type RingInspection,
	watchEscapeScript,
} from "./browser-scripts";

type Resolved = Extract<RingInspection, { resolved: true }>;

beforeAll(() => {
	// happy-dom lays nothing out, so visibility here is the `hidden` attribute alone.
	Element.prototype.checkVisibility = function (this: Element) {
		return this.closest("[hidden]") === null;
	};
});

afterEach(() => {
	clearContainerScript(CONTAINER_ATTR);
	document.body.innerHTML = "";
});

function inspect(html: string, selectors: string[]): Resolved {
	document.body.innerHTML = html;
	const inspection = inspectRingScript(selectors, CONTAINER_ATTR, TABBABLE_SELECTOR);

	if (!inspection.resolved) {
		throw new Error("ring did not resolve");
	}

	return inspection;
}

const WIDGET = `
	<a id="before" href="#a">Before</a>
	<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>
	<a id="after" href="#b">After</a>`;

describe("inspectRingScript", () => {
	it("is unresolved when a member can no longer be found", () => {
		document.body.innerHTML = WIDGET;

		expect(inspectRingScript(["#w1", "#gone"], CONTAINER_ATTR, TABBABLE_SELECTOR)).toEqual({
			resolved: false,
		});
	});

	it("counts the tabbable elements the ring leaves out and marks its common ancestor", () => {
		const inspection = inspect(WIDGET, ["#w1", "#w2"]);

		expect(inspection).toMatchObject({
			excludedCount: 2,
			shutOutCount: 0,
			containerIsRoot: false,
			tags: ["button", "button"],
			atStart: false,
			atEnd: false,
			dialog: null,
		});
		expect(document.getElementById("widget")?.hasAttribute(CONTAINER_ATTR)).toBe(true);
		expect(containerHandleScript()).toBe(document.getElementById("widget"));
	});

	it("leaves out of the count elements that cannot take focus by Tab", () => {
		const inspection = inspect(
			`<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>
			<button disabled>Disabled</button>
			<a href="#x" tabindex="-1">Scripted focus only</a>
			<a href="#y" hidden>Hidden</a>
			<span>Not focusable</span>`,
			["#w1", "#w2"],
		);

		expect(inspection.excludedCount).toBe(0);
	});

	it("counts links inside open shadow roots as left out", () => {
		document.body.innerHTML = `
			<site-header id="header"></site-header>
			<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>
			<site-footer id="footer"></site-footer>`;

		for (const id of ["header", "footer"]) {
			const root = document.getElementById(id)?.attachShadow({ mode: "open" });

			if (root) {
				root.innerHTML = `<a href="#one">One</a><a href="#two">Two</a>`;
			}
		}

		const inspection = inspectRingScript(["#w1", "#w2"], CONTAINER_ATTR, TABBABLE_SELECTOR);

		expect(inspection).toMatchObject({
			resolved: true,
			excludedCount: 4,
			atStart: false,
			atEnd: false,
		});
	});

	it("resolves ring members inside a shadow root and names their host as the container", () => {
		document.body.innerHTML = `<a id="before" href="#a">Before</a><rich-editor id="editor"></rich-editor>`;
		const root = document.getElementById("editor")?.attachShadow({ mode: "open" });

		if (root) {
			root.innerHTML = `<button class="bold">Bold</button><button class="italic">Italic</button>`;
		}

		const inspection = inspectRingScript(
			["#editor >>> .bold", "#editor >>> .italic"],
			CONTAINER_ATTR,
			TABBABLE_SELECTOR,
		);

		expect(inspection).toMatchObject({
			resolved: true,
			excludedCount: 1,
			atStart: false,
			atEnd: true,
		});
	});

	it("treats a ring whose only common ancestor is the body as naming no component", () => {
		const inspection = inspect(
			`<a id="first" href="#a">First</a><p><a href="#mid">Middle</a></p><a id="last" href="#b">Last</a>`,
			["#first", "#last"],
		);

		expect(inspection.containerIsRoot).toBe(true);
		expect(inspection.excludedCount).toBe(1);
	});

	it("knows when nothing tabbable comes before or after the ring", () => {
		const first = inspect(
			`<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>
			<a href="#after">After</a>`,
			["#w1", "#w2"],
		);

		expect(first).toMatchObject({ atStart: true, atEnd: false });

		clearContainerScript(CONTAINER_ATTR);

		const last = inspect(
			`<a href="#before">Before</a>
			<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>`,
			["#w1", "#w2"],
		);

		expect(last).toMatchObject({ atStart: false, atEnd: true });
	});

	it("counts content under inert as shut out rather than left out", () => {
		const inspection = inspect(
			`<main inert><a href="#a">Behind</a><button>Also behind</button></main>
			<div id="dialog" role="dialog" aria-modal="true">
				<button id="yes">Yes</button><button id="no">No</button>
			</div>`,
			["#yes", "#no"],
		);

		expect(inspection).toMatchObject({
			excludedCount: 0,
			shutOutCount: 2,
			atStart: true,
			atEnd: true,
		});
	});

	it("counts only the tab stop of a radio group, not every radio in it", () => {
		const inspection = inspect(
			`<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>
			<input type="radio" name="size" id="s"><input type="radio" name="size" id="m" checked>
			<input type="radio" name="size" id="l">
			<input type="radio" name="colour" id="red"><input type="radio" name="colour" id="blue">`,
			["#w1", "#w2"],
		);

		// The checked radio of one group, and the first radio of the group with none checked.
		expect(inspection.excludedCount).toBe(2);
	});

	it("allows arrow keys only on members where they cannot change a value", () => {
		const inspection = inspect(
			`<a href="#before">Before</a>
			<div id="widget">
				<button id="plain">Plain</button>
				<input id="text">
				<select id="choice"><option>A</option></select>
				<div id="slider" role="slider" tabindex="0" aria-valuenow="5"></div>
				<div role="tablist"><button id="tab" role="tab">Tab</button></div>
				<div id="editable" contenteditable="true" tabindex="0"></div>
				<a id="link" href="#x">Link</a>
			</div>`,
			["#plain", "#text", "#choice", "#slider", "#tab", "#editable", "#link"],
		);

		expect(inspection.arrowSafe).toEqual([true, false, false, false, false, false, true]);
	});

	it("presses Escape from a member that takes no text when there is one", () => {
		const inspection = inspect(
			`<a href="#before">Before</a>
			<div id="widget"><input id="q" type="search"><button id="go">Go</button></div>`,
			["#q", "#go"],
		);

		expect(inspection.escapeIndex).toBe(1);
	});

	it("presses Escape from a text field that is not a search field when every member takes text", () => {
		const inspection = inspect(
			`<a href="#before">Before</a>
			<div id="widget"><input id="q" type="search"><textarea id="notes"></textarea></div>`,
			["#q", "#notes"],
		);

		expect(inspection.escapeIndex).toBe(1);
	});

	it("never presses Escape when every member is a search field", () => {
		const inspection = inspect(
			`<a href="#before">Before</a><div id="widget"><input id="q" type="search"></div>`,
			["#q"],
		);

		expect(inspection.escapeIndex).toBe(-1);
	});

	it("describes the ARIA dialog a ring sits in, counting only buttons that can be used", () => {
		const inspection = inspect(
			`<a href="#behind">Behind</a>
			<div id="consent" role="alertdialog" aria-modal="true">
				<div id="actions">
					<button id="accept">Accept</button>
					<button id="reject">Reject</button>
				</div>
				<button disabled>Save choices</button>
				<a href="/privacy" tabindex="-1">Privacy policy</a>
				<button hidden>Close</button>
			</div>`,
			["#accept", "#reject"],
		);

		expect(inspection.dialog).toEqual({
			role: "alertdialog",
			native: false,
			modal: true,
			buttons: 3,
		});
		expect(containerHandleScript()?.id).toBe("actions");
	});

	it("describes a native dialog that is not modal", () => {
		const inspection = inspect(
			`<a href="#behind">Behind</a>
			<dialog id="dialog" open><button id="yes">Yes</button><button id="no">No</button></dialog>`,
			["#yes", "#no"],
		);

		expect(inspection.dialog).toEqual({ role: "dialog", native: true, modal: false, buttons: 2 });
	});
});

describe("probeFocusScript", () => {
	const selectors = ["#w1", "#w2"];

	function probe() {
		return probeFocusScript(selectors, CONTAINER_ATTR);
	}

	it("names the ring member holding focus and describes it", () => {
		inspect(WIDGET, selectors);
		document.getElementById("w2")?.focus();

		expect(probe()).toMatchObject({ member: 1, containerVisible: true });
		expect(probe().landed).toBe('<button id="w2"></button>');
	});

	it("reports focus outside the ring, and focus on nothing", () => {
		inspect(WIDGET, selectors);
		document.getElementById("after")?.focus();

		expect(probe()).toMatchObject({ member: -1, landed: '<a id="after" href="#b"></a>' });

		(document.activeElement as HTMLElement).blur();

		expect(probe()).toMatchObject({ member: -1, landed: null });
	});

	it("still recognises a member the page has re-created since the ring was inspected", () => {
		inspect(WIDGET, selectors);
		const widget = document.getElementById("widget") as HTMLElement;
		widget.innerHTML = `<button id="w1">One</button><button id="w2">Two</button>`;
		document.getElementById("w2")?.focus();

		expect(probe().member).toBe(1);
		// The fresh element is remembered, so the next probe needs no selector lookup.
		selectors.splice(0, selectors.length, "#nothing", "#nothing");
		expect(probe().member).toBe(1);
		selectors.splice(0, selectors.length, "#w1", "#w2");
	});

	it("leaves the container marker out of the description of a focused container", () => {
		inspect(`<a href="#before">Before</a><textarea id="editor"></textarea>`, ["#editor"]);
		document.getElementById("editor")?.focus();

		expect(probeFocusScript(["#editor"], CONTAINER_ATTR).landed).toBe(
			'<textarea id="editor"></textarea>',
		);
	});
});

describe("focusSelectorScript and focusOutsideScript", () => {
	it("focuses a ring member by its position, or by selector once it has been re-created", () => {
		inspect(WIDGET, ["#w1", "#w2"]);

		expect(focusSelectorScript("#w2", 1)).toBe(true);
		expect(document.activeElement?.id).toBe("w2");

		(document.getElementById("widget") as HTMLElement).innerHTML = `<button id="w2">Two</button>`;

		expect(focusSelectorScript("#w2", 1)).toBe(true);
		expect(document.activeElement?.id).toBe("w2");
		expect(focusSelectorScript("#w1", 0)).toBe(false);
	});

	it("focuses the first or last tabbable element outside the ring", () => {
		inspect(
			`<a id="a" href="#a">A</a>
			<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>
			<a id="b" href="#b">B</a><a id="c" href="#c">C</a>`,
			["#w1", "#w2"],
		);

		expect(focusOutsideScript("last")).toBe("focused");
		expect(document.activeElement?.id).toBe("c");
		expect(focusOutsideScript("first")).toBe("focused");
		expect(document.activeElement?.id).toBe("a");
	});

	it("has nothing to focus when the ring leaves nothing out", () => {
		inspect(`<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>`, [
			"#w1",
			"#w2",
		]);

		expect(focusOutsideScript("first")).toBe("none");
	});

	it("looks again for the elements outside the ring once the page has re-created them", () => {
		inspect(
			`<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>
			<footer id="footer"><a id="b" href="#b">B</a></footer>`,
			["#w1", "#w2"],
		);
		const stale = document.getElementById("b");
		(document.getElementById("footer") as HTMLElement).innerHTML =
			`<a id="b" href="#b">B</a><a id="c" href="#c">C</a>`;

		expect(focusOutsideScript("last")).toBe("focused");
		expect(document.activeElement?.id).toBe("c");
		expect(document.activeElement).not.toBe(stale);
		expect(focusOutsideScript("first")).toBe("focused");
		expect(document.activeElement?.id).toBe("b");
	});

	it("looks again when only some of the elements outside the ring were re-created", () => {
		inspect(
			`<a id="a" href="#a">A</a>
			<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>
			<footer id="footer"><a id="b" href="#b">B</a></footer>`,
			["#w1", "#w2"],
		);
		(document.getElementById("footer") as HTMLElement).innerHTML = `<a id="b" href="#b">B</a>`;

		// The last element outside is the new link, not the one before the ring that survived.
		expect(focusOutsideScript("last")).toBe("focused");
		expect(document.activeElement?.id).toBe("b");
	});

	it("says the elements outside the ring have gone when nothing took their place", () => {
		inspect(WIDGET, ["#w1", "#w2"]);
		document.getElementById("before")?.remove();
		document.getElementById("after")?.remove();

		expect(focusOutsideScript("last")).toBe("gone");
		expect(document.activeElement).toBe(document.body);
	});

	it("does not count a re-created ring member as outside the ring", () => {
		inspect(WIDGET, ["#w1", "#w2"]);
		document.getElementById("after")?.remove();
		(document.getElementById("widget") as HTMLElement).innerHTML =
			`<button id="w1">One</button><button id="w2">Two</button>`;
		// Focus on a re-created member is how the audit finds it again.
		document.getElementById("w1")?.focus();
		probeFocusScript(["#w1", "#w2"], CONTAINER_ATTR);
		document.getElementById("w2")?.focus();
		probeFocusScript(["#w1", "#w2"], CONTAINER_ATTR);

		expect(focusOutsideScript("last")).toBe("focused");
		expect(document.activeElement?.id).toBe("before");
	});
});

describe("outsideOpenedScript and leaveOutsideScript", () => {
	const SEARCH = `
		<div id="widget"><button id="w1">One</button><button id="w2">Two</button></div>
		<input id="search" type="search" aria-label="Search">
		<ul id="suggestions" hidden><li>Recent</li></ul>`;

	const openOnFocus = (): void => {
		document.getElementById("search")?.addEventListener("focus", () => {
			(document.getElementById("suggestions") as HTMLElement).hidden = false;
		});
	};

	it("is true when focusing the element outside the ring changed the document", () => {
		inspect(SEARCH, ["#w1", "#w2"]);
		openOnFocus();
		focusOutsideScript("last");

		expect(outsideOpenedScript()).toBe(true);
	});

	it("is false when nothing changed", () => {
		inspect(SEARCH, ["#w1", "#w2"]);
		focusOutsideScript("last");

		expect(outsideOpenedScript()).toBe(false);
	});

	it("is false when only the ring's own container changed", () => {
		inspect(SEARCH, ["#w1", "#w2"]);
		document.getElementById("search")?.addEventListener("focus", () => {
			document.getElementById("w1")?.classList.add("was-focused");
		});
		focusOutsideScript("last");

		expect(outsideOpenedScript()).toBe(false);
	});

	it("is false when the page moved focus on from the element", () => {
		inspect(SEARCH, ["#w1", "#w2"]);
		openOnFocus();
		document.getElementById("search")?.addEventListener("focus", () => {
			document.getElementById("w1")?.focus();
		});
		focusOutsideScript("last");

		expect(outsideOpenedScript()).toBe(false);
	});

	it("is false for a field holding text, which Escape could clear", () => {
		inspect(SEARCH.replace('type="search"', 'type="search" value="shoes"'), ["#w1", "#w2"]);
		openOnFocus();
		focusOutsideScript("last");

		expect(outsideOpenedScript()).toBe(false);
	});

	it("takes focus off the element and gives a field back what it held", () => {
		inspect(SEARCH.replace('type="search"', 'type="search" value="shoes"'), ["#w1", "#w2"]);
		focusOutsideScript("last");
		const search = document.getElementById("search") as HTMLInputElement;
		search.value = "";
		leaveOutsideScript();

		expect(search.value).toBe("shoes");
		expect(document.activeElement).toBe(document.body);
	});

	it("leaves focus alone when the page has already moved it elsewhere", () => {
		inspect(SEARCH, ["#w1", "#w2"]);
		focusOutsideScript("last");
		document.getElementById("w1")?.focus();
		leaveOutsideScript();

		expect(document.activeElement?.id).toBe("w1");
		// A second call has nothing left to undo.
		expect(() => leaveOutsideScript()).not.toThrow();
	});
});

describe("escapeIgnoredScript", () => {
	const pressEscape = (): KeyboardEvent => {
		const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		document.getElementById("w1")?.dispatchEvent(event);

		return event;
	};

	// The test's own waits, kept off the `setTimeout` the script notes timers on while a key is
	// handled: a wait set in the same turn as the key press would count as one of the page's.
	const realSetTimeout = setTimeout;
	const pause = (ms: number): Promise<void> =>
		new Promise((resolve) => realSetTimeout(resolve, ms));

	function watch() {
		inspect(WIDGET, ["#w1", "#w2"]);
		document.getAnimations ??= () => [];
		watchEscapeScript();
	}

	it("is true when the page did nothing with the key", () => {
		watch();
		pressEscape();

		expect(escapeIgnoredScript()).toBe(true);
	});

	it("is false before Escape has reached the page", () => {
		watch();

		expect(escapeIgnoredScript()).toBe(false);
	});

	it("is false when the page cancelled the key", () => {
		watch();
		document.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
		pressEscape();

		expect(escapeIgnoredScript()).toBe(false);
	});

	it("is false when the page changed the document in response", () => {
		watch();
		document.addEventListener(
			"keydown",
			() => document.getElementById("widget")?.classList.add("closing"),
			{ once: true },
		);
		pressEscape();

		expect(escapeIgnoredScript()).toBe(false);
	});

	it("is false while a short timer the page set on handling the key is still to fire", () => {
		watch();
		document.addEventListener("keydown", () => setTimeout(() => {}, 400), { once: true });
		pressEscape();

		expect(escapeIgnoredScript()).toBe(false);
	});

	it("is true once that timer has had its time, or when the timer is too long to wait for", async () => {
		watch();
		document.addEventListener("keydown", () => setTimeout(() => {}, 5), { once: true });
		pressEscape();
		await pause(20);

		expect(escapeIgnoredScript()).toBe(true);

		watch();
		document.addEventListener("keydown", () => setTimeout(() => {}, 5000), { once: true });
		pressEscape();

		expect(escapeIgnoredScript()).toBe(true);
	});

	it("ignores timers set before the key was pressed or after its handlers ran", async () => {
		watch();
		setTimeout(() => {}, 400);
		pressEscape();
		await pause(5);
		setTimeout(() => {}, 400);

		expect(escapeIgnoredScript()).toBe(true);
	});

	it("puts setTimeout back as it found it once the key has been handled", async () => {
		const original = window.setTimeout;
		watch();
		let during: typeof window.setTimeout | undefined;
		document.addEventListener(
			"keydown",
			() => {
				during = window.setTimeout;
			},
			{ once: true },
		);
		pressEscape();

		expect(during).not.toBe(original);

		await new Promise((resolve) => original(resolve, 5));

		expect(window.setTimeout).toBe(original);

		// Asking, or clearing up, puts it back at once without waiting for the timer.
		watch();
		pressEscape();
		escapeIgnoredScript();

		expect(window.setTimeout).toBe(original);

		watch();
		pressEscape();
		clearContainerScript(CONTAINER_ATTR);

		expect(window.setTimeout).toBe(original);
	});

	it("is false while something is animating", () => {
		watch();
		const getAnimations = document.getAnimations;
		document.getAnimations = () => [{ playState: "running" } as Animation];

		try {
			pressEscape();

			expect(escapeIgnoredScript()).toBe(false);
		} finally {
			document.getAnimations = getAnimations;
		}
	});
});

describe("clearContainerScript", () => {
	it("removes the container marker, forgets the ring and drops focus", () => {
		inspect(WIDGET, ["#w1", "#w2"]);
		document.getElementById("w1")?.focus();
		clearContainerScript(CONTAINER_ATTR);

		expect(document.querySelector(`[${CONTAINER_ATTR}]`)).toBeNull();
		expect(containerHandleScript()).toBeNull();
		expect(document.activeElement).toBe(document.body);
	});
});
