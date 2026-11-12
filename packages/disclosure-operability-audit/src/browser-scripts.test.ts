// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	callDisclosureScript,
	type DisclosureApi,
	type DisclosureInstallOptions,
	type DisclosureReading,
	installDisclosureScript,
	isDisclosureInstalledScript,
} from "./browser-scripts";

const STASH_KEY = "__testDisclosure";

type Store = Record<string, unknown>;

function install(
	triggerLimit = 20,
	skipLimit = 10,
	scanLimit = 5000,
	options: DisclosureInstallOptions = {},
) {
	return installDisclosureScript(STASH_KEY, triggerLimit, skipLimit, scanLimit, options);
}

function call<T>(method: keyof DisclosureApi, ...args: unknown[]): T {
	return callDisclosureScript(STASH_KEY, method, ...args) as T;
}

function stash(): Element[] {
	return ((window as unknown as Store)[STASH_KEY] as Element[] | undefined) ?? [];
}

function byId(id: string): HTMLElement {
	return document.getElementById(id) as HTMLElement;
}

function ids(elements: readonly (Element | null)[]): (string | null)[] {
	return elements.map((element) => element?.id ?? null);
}

beforeEach(() => {
	// happy-dom does no layout. An element is laid out here unless it, or an ancestor, is `hidden`,
	// and sits at the top left unless it, or an ancestor, is `data-parked` far off to the right.
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
		const size = this.closest("[hidden]") ? 0 : 10;
		const left = this.closest("[data-parked]") ? 100_000 : 0;

		return {
			x: left,
			y: 0,
			left,
			top: 0,
			right: left + size,
			bottom: size,
			width: size,
			height: size,
		};
	} as () => DOMRect);
});

afterEach(() => {
	// Finishing is what lifts the block on form submissions.
	if (isDisclosureInstalledScript(STASH_KEY)) {
		call("finish");
	}

	vi.restoreAllMocks();

	for (const key of [STASH_KEY, `${STASH_KEY}Controls`, `${STASH_KEY}Api`]) {
		delete (window as unknown as Store)[key];
	}

	document.body.innerHTML = "";
});

describe("installDisclosureScript: finding triggers", () => {
	it("collects aria-expanded triggers in document order and stashes them with their targets", () => {
		document.body.innerHTML = `
			<button id="faq" type="button" aria-expanded="false" aria-controls="faq-panel">FAQ</button>
			<div id="faq-panel" hidden>Answers</div>
			<ul role="menubar">
				<li><a id="more" href="#" role="menuitem" tabindex="-1" aria-expanded="true">More</a></li>
			</ul>
			<div id="custom" role="button" tabindex="0" aria-expanded="false">Custom</div>
		`;

		const collection = install();

		expect(collection.triggers).toEqual([
			{
				html: '<button id="faq" type="button" aria-expanded="false" aria-controls="faq-panel">FAQ</button>',
				role: null,
				expanded: "false",
				hasControlled: true,
				inTabOrder: true,
				inComposite: false,
				spaceExpected: true,
				link: false,
			},
			{
				html: '<a id="more" href="#" role="menuitem" tabindex="-1" aria-expanded="true">More</a>',
				role: "menuitem",
				expanded: "true",
				hasControlled: false,
				inTabOrder: false,
				inComposite: true,
				spaceExpected: false,
				link: true,
			},
			{
				html: '<div id="custom" role="button" tabindex="0" aria-expanded="false">Custom</div>',
				role: "button",
				expanded: "false",
				hasControlled: false,
				inTabOrder: true,
				inComposite: false,
				spaceExpected: true,
				link: false,
			},
		]);
		expect(collection).toMatchObject({ skipped: [], skippedTotal: 0, eligible: 3 });
		expect(ids(stash())).toEqual(["faq", "more", "custom"]);
		expect(ids((window as unknown as Store)[`${STASH_KEY}Controls`] as Element[])).toEqual([
			"faq-panel",
			null,
			null,
		]);
	});

	it("leaves native details and select alone", () => {
		document.body.innerHTML = `
			<details aria-expanded="false"><summary aria-expanded="false">More</summary>Text</details>
			<select aria-expanded="false"><option aria-expanded="false">One</option></select>
		`;

		expect(install()).toMatchObject({ triggers: [], skippedTotal: 0, eligible: 0 });
	});

	it("does not take a button with only aria-controls for a trigger unless asked to", () => {
		document.body.innerHTML = `
			<button id="hidden-target" type="button" aria-controls="a">Show</button>
			<div id="a" hidden></div>
		`;

		expect(install()).toMatchObject({ triggers: [], skippedTotal: 0, eligible: 0 });
	});

	it("takes a button with only aria-controls for a trigger when asked to and its target is not on show", () => {
		document.body.innerHTML = `
			<button id="hidden-target" type="button" aria-controls="a">Show</button>
			<div id="a" hidden></div>
			<button id="shown-target" type="button" aria-controls="b">Sort</button>
			<div id="b"></div>
			<button id="no-target" type="button" aria-controls="nowhere">Broken</button>
			<button id="tab" type="button" role="tab" aria-controls="c">Tab</button>
			<div id="c" hidden></div>
			<button id="dialog-opener" type="button" aria-haspopup="dialog" aria-controls="d">Open</button>
			<div id="d" hidden></div>
			<p id="paragraph" aria-controls="e">Text</p>
			<div id="e" hidden></div>
		`;

		install(20, 10, 5000, { includeControlsOnly: true });

		expect(ids(stash())).toEqual(["hidden-target"]);
	});

	it("finds triggers inside open shadow roots and resolves aria-controls within the root", () => {
		const host = document.createElement("div");
		const root = host.attachShadow({ mode: "open" });

		root.innerHTML = `
			<button id="inner" type="button" aria-expanded="false" aria-controls="inner-panel">Menu</button>
			<div id="inner-panel" hidden></div>
		`;
		document.body.append(host);

		const collection = install();

		expect(ids(stash())).toEqual(["inner"]);
		expect(collection.triggers[0]?.hasControlled).toBe(true);
	});

	it("skips triggers it must not or cannot operate, with the reason", () => {
		document.body.innerHTML = `
			<button id="hidden" type="button" aria-expanded="false" hidden>Menu</button>
			<button id="disabled" type="button" aria-expanded="false" disabled>Off</button>
			<button id="aria-disabled" type="button" aria-expanded="false" aria-disabled="true">Off</button>
			<div inert><button id="inert" type="button" aria-expanded="false">Inert</button></div>
			<input id="combobox" role="combobox" aria-expanded="false">
			<input id="search" type="search" aria-expanded="false">
			<div role="tree"><div id="treeitem" role="treeitem" tabindex="0" aria-expanded="false">Node</div></div>
			<a id="link" href="/shop" aria-expanded="false">Shop</a>
			<a href="/more"><span id="in-link" role="button" tabindex="0" aria-expanded="false">More</span></a>
			<form>
				<button id="submit" aria-expanded="false">Send</button>
				<button id="reset" type="reset" aria-expanded="false">Clear</button>
				<button id="plain" type="button" aria-expanded="false">Options</button>
			</form>
			<li id="container" aria-expanded="false"><button type="button">Section</button></li>
			<a id="hash-link" href="#menu" aria-expanded="false">Menu</a>
			<a id="js-link" href="javascript:void(0)" aria-expanded="false">Menu</a>
			<div id="bare" aria-expanded="false">Click me</div>
		`;

		const collection = install(20, 20);

		expect(ids(stash().slice(0, collection.triggers.length))).toEqual([
			"plain",
			"hash-link",
			"js-link",
			"bare",
		]);
		expect(
			collection.skipped.map(({ reason }, i) => [
				stash()[collection.triggers.length + i]?.id,
				reason,
			]),
		).toEqual([
			["hidden", "hidden"],
			["disabled", "disabled"],
			["aria-disabled", "disabled"],
			["inert", "disabled"],
			["combobox", "text-entry"],
			["search", "text-entry"],
			["treeitem", "composite-item"],
			["link", "navigating-link"],
			["in-link", "navigating-link"],
			["submit", "submits-form"],
			["reset", "submits-form"],
			["container", "state-on-container"],
		]);
		expect(collection.skippedTotal).toBe(12);
	});

	it("skips checkboxes, radio buttons and switches, which hold a value", () => {
		document.body.innerHTML = `
			<form>
				<input id="checkbox" type="checkbox" aria-expanded="false">
				<input id="radio" type="radio" name="r" aria-expanded="false">
				<input id="button" type="button" value="Options" aria-expanded="false">
			</form>
			<div id="switch" role="switch" tabindex="0" aria-checked="false" aria-expanded="false">Gift</div>
			<div id="custom-checkbox" role="checkbox" tabindex="0" aria-expanded="false">More</div>
			<div role="menu"><div id="menu-radio" role="menuitemradio" tabindex="-1" aria-expanded="false">A</div></div>
		`;

		const collection = install(20, 20);

		expect(ids(stash().slice(0, collection.triggers.length))).toEqual(["button"]);
		expect(
			collection.skipped.map(({ reason }, i) => [
				stash()[collection.triggers.length + i]?.id,
				reason,
			]),
		).toEqual([
			["checkbox", "checkable"],
			["radio", "checkable"],
			["switch", "checkable"],
			["custom-checkbox", "checkable"],
			["menu-radio", "checkable"],
		]);
	});

	it("skips triggers whose name matches the risky pattern, wherever the name comes from", () => {
		document.body.innerHTML = `
			<button id="text" type="button" aria-expanded="false">Delete   account</button>
			<button id="label" type="button" aria-expanded="false" aria-label="Sign out">X</button>
			<span id="word">Remove</span>
			<button id="labelledby" type="button" aria-expanded="false" aria-labelledby="word">Card</button>
			<button id="image" type="button" aria-expanded="false"><img alt="Log out" src="x.png"></button>
			<button id="title" type="button" aria-expanded="false" title="Unsubscribe"></button>
			<input id="value" type="button" aria-expanded="false" value="Order now">
			<button id="overridden" type="button" aria-expanded="false" aria-label="Options">Delete</button>
			<button id="payment" type="button" aria-expanded="false">Payment methods</button>
			<button id="orders" type="button" aria-expanded="false">Order history</button>
			<button id="sender" type="button" aria-expanded="false">Sender details</button>
		`;

		const pattern =
			"\\b(delete|remove|log\\s?out|sign\\s?out|unsubscribe|pay|send|order\\s+now)\\b";
		const collection = install(20, 20, 5000, { riskyNamePattern: pattern });

		// A word inside another ("Payment", "Sender") is not a match, and aria-label wins over text.
		expect(ids(stash().slice(0, collection.triggers.length))).toEqual([
			"overridden",
			"payment",
			"orders",
			"sender",
		]);
		expect(
			collection.skipped.map(({ reason }, i) => [
				stash()[collection.triggers.length + i]?.id,
				reason,
			]),
		).toEqual([
			["text", "risky-name"],
			["label", "risky-name"],
			["labelledby", "risky-name"],
			["image", "risky-name"],
			["title", "risky-name"],
			["value", "risky-name"],
		]);
	});

	it("operates every name when given no risky pattern", () => {
		document.body.innerHTML = `<button id="text" type="button" aria-expanded="false">Delete account</button>`;

		expect(install(20, 10, 5000, { riskyNamePattern: null })).toMatchObject({
			skippedTotal: 0,
			eligible: 1,
		});
	});

	it("samples evenly past the trigger limit and caps the skipped list", () => {
		document.body.innerHTML = [
			...Array.from(
				{ length: 10 },
				(_, i) => `<button id="t${i}" type="button" aria-expanded="false">T</button>`,
			),
			...Array.from(
				{ length: 5 },
				(_, i) => `<button id="s${i}" type="button" aria-expanded="false" disabled>S</button>`,
			),
		].join("");

		const collection = install(4, 2);

		expect(collection.eligible).toBe(10);
		expect(collection.skippedTotal).toBe(5);
		expect(ids(stash())).toEqual(["t0", "t2", "t5", "t7", "s0", "s1"]);
	});
});

describe("installDisclosureScript: driving a trigger", () => {
	function page() {
		document.body.innerHTML = `
			<a id="before" href="#x">Before</a>
			<button id="toggle" type="button" aria-expanded="false" aria-controls="panel"><span id="icon">+</span></button>
			<div id="panel" hidden><a id="inside" href="#y">Inside</a></div>
			<div id="portal" hidden>Portal</div>
		`;
		install();
	}

	it("reads the state, the controlled target and what appeared since the trigger was begun", () => {
		page();

		expect(call<DisclosureReading>("begin", 0)).toEqual({
			connected: true,
			expanded: "false",
			controlled: false,
			appeared: 0,
			disappeared: 0,
			focused: false,
			settling: false,
			clicks: 0,
			blocked: { submits: 0, navigations: 0 },
		});

		byId("toggle").setAttribute("aria-expanded", "true");
		byId("panel").hidden = false;
		byId("portal").hidden = false;

		// The panel, the link inside it and the portal.
		expect(call<DisclosureReading>("read", 0)).toMatchObject({
			expanded: "true",
			controlled: true,
			appeared: 3,
			disappeared: 0,
		});

		byId("before").hidden = true;

		expect(call<DisclosureReading>("read", 0)).toMatchObject({ appeared: 3, disappeared: 1 });
	});

	it("does not count content that only moves into or out of the document, as a carousel's slides do", () => {
		document.body.innerHTML = `
			<button id="toggle" type="button" aria-expanded="false" aria-controls="panel">Menu</button>
			<div id="panel" data-parked>Panel</div>
			<div id="slide-1">One</div>
			<div id="slide-2" data-parked>Two</div>
		`;
		install();

		expect(call<DisclosureReading>("begin", 0)).toMatchObject({ controlled: false });

		// The carousel advances: one slide leaves the document and the next arrives.
		byId("slide-1").setAttribute("data-parked", "");
		byId("slide-2").removeAttribute("data-parked");

		expect(call<DisclosureReading>("read", 0)).toMatchObject({
			controlled: false,
			appeared: 0,
			disappeared: 0,
		});

		// The trigger's own panel is named by aria-controls, so moving it into view does count.
		byId("panel").removeAttribute("data-parked");

		expect(call<DisclosureReading>("read", 0)).toMatchObject({
			controlled: true,
			appeared: 0,
			disappeared: 0,
		});
	});

	it("does not count changes inside the trigger itself, such as a swapped icon", () => {
		page();
		call("begin", 0);

		byId("icon").remove();
		byId("toggle").insertAdjacentHTML("beforeend", '<span id="icon-open">-</span>');

		expect(call<DisclosureReading>("read", 0)).toMatchObject({ appeared: 0, disappeared: 0 });
	});

	it("reports no page-wide counts on a page past the scan limit", () => {
		document.body.innerHTML = `
			<button id="toggle" type="button" aria-expanded="false">Menu</button><p>One</p><p>Two</p>
		`;
		install(20, 10, 2);

		expect(call<DisclosureReading>("begin", 0)).toMatchObject({
			appeared: null,
			disappeared: null,
		});
	});

	it("says when the trigger has left the document", () => {
		page();
		call("begin", 0);
		byId("toggle").remove();

		expect(call<DisclosureReading>("read", 0).connected).toBe(false);
	});

	it("focuses and blurs the trigger", () => {
		document.body.innerHTML = `
			<button id="toggle" type="button" aria-expanded="false">Menu</button>
		`;
		install();

		// An element that refuses focus needs a real browser: see the integration tests.
		expect(call<boolean>("focus", 0)).toBe(true);
		expect(call<DisclosureReading>("read", 0).focused).toBe(true);

		call("blur", 0);

		expect(call<DisclosureReading>("read", 0).focused).toBe(false);
	});

	it("clicks the trigger, and hovers it and every ancestor the pointer would cross", () => {
		document.body.innerHTML = `
			<ul><li id="item"><button id="toggle" type="button" aria-expanded="false">Menu</button></li></ul>
		`;
		install();

		const events: string[] = [];

		byId("toggle").addEventListener("click", () => events.push("click"));

		for (const type of ["mouseenter", "mouseleave"]) {
			byId("item").addEventListener(type, () => events.push(`item ${type}`));
		}

		for (const type of ["mouseover", "mouseout"]) {
			document.body.addEventListener(type, (event) =>
				events.push(`${type} ${(event.target as Element).id}`),
			);
		}

		call("click", 0);
		call("hover", 0, true);
		call("hover", 0, false);

		expect(events).toEqual([
			"click",
			"mouseover toggle",
			"item mouseenter",
			"mouseout toggle",
			"item mouseleave",
		]);
	});

	it("says the content is settling while its aria-controls target is changing size", () => {
		page();
		call("begin", 0);

		byId("panel").hidden = false;

		expect(call<DisclosureReading>("read", 0).settling).toBe(true);
		// The same size twice running: it has come to rest.
		expect(call<DisclosureReading>("read", 0).settling).toBe(false);
	});

	it("is ready for a key only while the trigger holds focus", () => {
		page();
		call("begin", 0);

		expect(call<boolean>("ready", 0, "key")).toBe(false);

		call("focus", 0);
		expect(call<boolean>("ready", 0, "key")).toBe(true);

		byId("before").focus();
		expect(call<boolean>("ready", 0, "key")).toBe(false);
	});

	it("is ready for a click until focus has moved somewhere new", () => {
		page();
		call("begin", 0);

		// Nothing has focus, as when the trigger cannot take it.
		expect(call<boolean>("ready", 0, "click")).toBe(true);

		call("focus", 0);
		expect(call<boolean>("ready", 0, "click")).toBe(true);

		// What the trigger opened has taken focus: a click now is not the audit's to make.
		byId("panel").hidden = false;
		byId("inside").focus();
		expect(call<boolean>("ready", 0, "click")).toBe(false);
	});

	it("is ready for a click while focus stays where it was when the trigger was begun", () => {
		page();
		byId("before").focus();
		call("begin", 0);

		expect(call<boolean>("ready", 0, "click")).toBe(true);
	});

	it("is not ready for anything behind a modal dialog, inside inert content or once removed", () => {
		document.body.innerHTML = `
			<main id="main"><button id="toggle" type="button" aria-expanded="false">Menu</button></main>
			<div id="dialog" role="dialog" aria-modal="true" hidden><button id="ok" type="button">OK</button></div>
		`;
		install();
		call("begin", 0);
		call("focus", 0);

		expect(call<boolean>("ready", 0, "key")).toBe(true);

		byId("dialog").hidden = false;
		expect(call<boolean>("ready", 0, "key")).toBe(false);
		expect(call<boolean>("ready", 0, "click")).toBe(false);

		byId("dialog").hidden = true;
		byId("main").setAttribute("inert", "");
		expect(call<boolean>("ready", 0, "click")).toBe(false);

		byId("main").removeAttribute("inert");
		expect(call<boolean>("ready", 0, "click")).toBe(true);

		byId("toggle").remove();
		expect(call<boolean>("ready", 0, "click")).toBe(false);
	});

	it("is ready for a trigger inside the modal dialog itself", () => {
		document.body.innerHTML = `
			<div role="dialog" aria-modal="true"><button id="toggle" type="button" aria-expanded="false">More</button></div>
		`;
		install();
		call("begin", 0);
		call("focus", 0);

		expect(call<boolean>("ready", 0, "key")).toBe(true);
	});

	it("stops every form submission until it is finished, and counts them per trigger", () => {
		document.body.innerHTML = `
			<button id="toggle" type="button" aria-expanded="false">Menu</button>
			<form id="form" action="/send"><input name="q"><button id="go">Go</button></form>
			<form id="later" action="/send"></form>
		`;

		const form = byId("form") as HTMLFormElement;
		// happy-dom remembers the first submit() it hands out for an element, so what happens once
		// the block is lifted is checked on a form that was not touched while it was in place.
		const later = byId("later") as HTMLFormElement;
		const seen: string[] = [];
		// happy-dom's own submit() would try to load the form's action.
		const realSubmit = HTMLFormElement.prototype.submit;

		HTMLFormElement.prototype.submit = () => {
			seen.push("native submit()");
		};

		for (const each of [form, later]) {
			each.addEventListener("submit", (event) => {
				event.preventDefault();
				seen.push("page handler");
			});
		}

		install();
		call("begin", 0);

		const event = new Event("submit", { bubbles: true, cancelable: true });

		form.dispatchEvent(event);
		form.submit();
		form.requestSubmit();

		// Stopped before the page's own handler, which might have sent the form by script.
		expect(event.defaultPrevented).toBe(true);
		expect(seen).toEqual([]);
		expect(call<DisclosureReading>("read", 0).blocked).toEqual({ submits: 3, navigations: 0 });

		// The count starts again with each trigger.
		expect(call<DisclosureReading>("begin", 0).blocked).toEqual({ submits: 0, navigations: 0 });

		call("finish");

		later.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		later.submit();

		expect(seen).toEqual(["page handler", "native submit()"]);
		HTMLFormElement.prototype.submit = realSubmit;
	});

	it("puts focus back where it was and removes itself when finished", () => {
		document.body.innerHTML = `
			<a id="before" href="#x">Before</a>
			<button id="toggle" type="button" aria-expanded="false">Menu</button>
		`;
		byId("before").focus();
		install();

		call("focus", 0);
		expect(document.activeElement).toBe(byId("toggle"));

		call("finish");

		expect(document.activeElement).toBe(byId("before"));
		expect(isDisclosureInstalledScript(STASH_KEY)).toBe(false);
		expect(call("read", 0)).toEqual({ gone: true });
	});

	it("drops focus when nothing had it before", () => {
		document.body.innerHTML = `<button id="toggle" type="button" aria-expanded="false">Menu</button>`;
		install();

		expect(isDisclosureInstalledScript(STASH_KEY)).toBe(true);

		call("focus", 0);
		call("finish");

		expect(document.activeElement).toBe(document.body);
	});
});
