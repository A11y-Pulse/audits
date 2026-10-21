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

	it("leaves the collected elements on the stash key in collection order", () => {
		document.body.innerHTML = `<button id="a" role="tab"></button><div id="b" role="tabpanel"></div>`;
		collect();

		const stash = (window as unknown as Record<string, Element[]>)[STASH_KEY];

		expect(stash?.map((element) => element.id)).toEqual(["a", "b"]);
	});
});
