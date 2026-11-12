// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { collectTabRolesScript } from "./browser-scripts";

const STASH_KEY = "__testStash";

function collect() {
	return collectTabRolesScript(STASH_KEY);
}

afterEach(() => {
	delete (window as unknown as Record<string, unknown>)[STASH_KEY];
	document.body.innerHTML = "";
});

describe("collectTabRolesScript", () => {
	it("collects tabs and tab panels, hidden ones included", () => {
		document.body.innerHTML = `
			<div role="tablist"><button role="tab">A</button></div>
			<div role="tabpanel" hidden></div>
			<div role="TabPanel tab" style="display: none"></div>
			<div role="region"></div>
		`;

		expect(collect().map((element) => element.role)).toEqual(["tab", "tabpanel", "tabpanel"]);
	});

	it("resolves aria-controls and aria-labelledby to collected indices", () => {
		document.body.innerHTML = `
			<button id="t1" role="tab" aria-controls="p1 missing">A</button>
			<button id="t2" role="tab" aria-controls="note">B</button>
			<p id="note">Note</p>
			<div id="p1" role="tabpanel" aria-labelledby="t1 note"></div>
		`;

		const [first, second, panel] = collect();

		expect(first).toMatchObject({ controls: [2], hasControls: true, controlsOther: false });
		expect(second).toMatchObject({ controls: [], hasControls: true, controlsOther: true });
		expect(panel?.labelledBy).toEqual([0]);
	});

	it("reports an aria-controls that resolves to nothing as declared but unresolved", () => {
		document.body.innerHTML = `<button role="tab" aria-controls="lazy-panel">A</button>`;

		expect(collect()[0]).toMatchObject({ controls: [], hasControls: true, controlsOther: false });
	});

	it("marks tabs that link to another document", () => {
		document.body.innerHTML = `
			<a role="tab" href="/other-page">Other</a>
			<a href="https://elsewhere.test/"><span role="tab">Elsewhere</span></a>
			<a role="tab" href="#panel">Fragment</a>
			<a role="tab" href="${location.pathname}${location.search}#panel">Same page</a>
			<a role="tab" href="javascript:void(0)">Script</a>
			<button role="tab">Button</button>
		`;

		expect(collect().map((element) => element.navigates)).toEqual([
			true,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it("reports where a navigating tab goes", () => {
		document.body.innerHTML = `
			<a href="https://elsewhere.test/shop?x=1"><span role="tab">Elsewhere</span></a>
			<a role="tab" href="#panel">Fragment</a>
		`;

		expect(collect().map((element) => element.href)).toEqual([
			"https://elsewhere.test/shop?x=1",
			null,
		]);
	});

	it("lists what each aria-controls id resolves to", () => {
		document.body.innerHTML = `
			<button role="tab" aria-controls="p1 gone wrapper">A</button>
			<div id="p1" role="tabpanel"></div>
			<section id="wrapper"></section>
		`;

		expect(collect()[0]?.controlsTargets).toEqual([
			{ id: "p1", found: true, role: "tabpanel", tag: "div" },
			{ id: "gone", found: false, role: null, tag: null },
			{ id: "wrapper", found: true, role: null, tag: "section" },
		]);
	});

	it("groups tabs by their nearest tablist, nested and aria-owns ones included", () => {
		document.body.innerHTML = `
			<div id="outer" role="tablist">
				<button role="tab" aria-selected="true">Outer A</button>
				<div role="presentation"><button role="tab">Outer B</button></div>
				<div id="inner" role="tablist">
					<button role="tab">Inner A</button>
				</div>
			</div>
			<div id="owner" role="tablist" aria-owns="owned"></div>
			<button id="owned" role="tab">Owned</button>
			<button role="tab">Loose</button>
			<div role="tabpanel"></div>
		`;

		const collected = collect();
		const stash = (window as unknown as Record<string, Element[]>)[STASH_KEY]!;
		const tablistId = (index: number | null | undefined) =>
			typeof index === "number" ? stash[index]?.id : null;

		expect(collected.map((element) => tablistId(element.tablist))).toEqual([
			"outer",
			"outer",
			"inner",
			"owner",
			null,
			null,
		]);
		expect(collected.map((element) => element.selected)).toEqual([
			true,
			false,
			false,
			false,
			false,
			false,
		]);
	});

	it("leaves the collected elements on the stash key in collection order", () => {
		document.body.innerHTML = `<button id="a" role="tab"></button><div id="b" role="tabpanel"></div>`;
		collect();

		const stash = (window as unknown as Record<string, Element[]>)[STASH_KEY];

		expect(stash?.map((element) => element.id)).toEqual(["a", "b"]);
	});
});
