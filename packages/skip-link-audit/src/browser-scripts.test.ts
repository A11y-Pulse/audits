// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
	isFocusInsideTargetScript,
	parseInPageFragment,
	probeActiveElementScript,
	resolveFragmentTargetScript,
} from "./browser-scripts";

describe("parseInPageFragment", () => {
	it("returns the fragment for an in-page hash href", () => {
		expect(parseInPageFragment("#main")).toBe("#main");
		expect(parseInPageFragment("#content")).toBe("#content");
	});

	it("rejects a bare hash", () => {
		expect(parseInPageFragment("#")).toBeNull();
	});

	it("rejects #top", () => {
		expect(parseInPageFragment("#top")).toBeNull();
	});

	it("rejects non-fragment hrefs", () => {
		expect(parseInPageFragment("/about")).toBeNull();
		expect(parseInPageFragment("https://example.com/#main")).toBeNull();
		expect(parseInPageFragment(null)).toBeNull();
		expect(parseInPageFragment("")).toBeNull();
	});

	it("rejects hash-router and hashbang paths", () => {
		expect(parseInPageFragment("#/home")).toBeNull();
		expect(parseInPageFragment("#/about/team")).toBeNull();
		expect(parseInPageFragment("#!/route")).toBeNull();
	});
});

describe("resolveFragmentTargetScript", () => {
	it("resolves a target by id", () => {
		document.body.innerHTML = `<main id="main">hello</main>`;

		expect(resolveFragmentTargetScript("#main")).toBe(
			document.getElementById("main"),
		);
	});

	it("resolves a target by name attribute", () => {
		document.body.innerHTML = `<a name="content">anchor</a>`;

		expect(resolveFragmentTargetScript("#content")).toBe(
			document.getElementsByName("content")[0],
		);
	});

	it("returns null when nothing matches", () => {
		document.body.innerHTML = `<main id="other">hello</main>`;

		expect(resolveFragmentTargetScript("#main")).toBeNull();
	});
});

describe("probeActiveElementScript candidate detection", () => {
	it("treats an in-page fragment anchor as a candidate whose target resolves", () => {
		document.body.innerHTML = `<a href="#main">Skip</a><main id="main"></main>`;
		(document.querySelector("a") as HTMLElement).focus();

		expect(probeActiveElementScript()).toMatchObject({
			isBody: false,
			fragment: "#main",
			targetResolves: true,
		});
	});

	it("rejects a bare hash and #top", () => {
		document.body.innerHTML = `<a href="#">Top</a>`;
		(document.querySelector("a") as HTMLElement).focus();
		expect(probeActiveElementScript().fragment).toBeNull();

		document.body.innerHTML = `<a href="#top">Top</a>`;
		(document.querySelector("a") as HTMLElement).focus();
		expect(probeActiveElementScript().fragment).toBeNull();
	});

	it("rejects hash-router paths so SPA nav is not treated as a skip link", () => {
		document.body.innerHTML = `<a href="#/home">Home</a>`;
		(document.querySelector("a") as HTMLElement).focus();
		expect(probeActiveElementScript().fragment).toBeNull();
	});

	it("does not treat a non-anchor as a candidate", () => {
		document.body.innerHTML = "<button>go</button>";
		(document.querySelector("button") as HTMLElement).focus();

		expect(probeActiveElementScript()).toMatchObject({
			isBody: false,
			fragment: null,
		});
	});

	it("flags the body when nothing is focused", () => {
		document.body.innerHTML = `<a href="#main">Skip</a>`;

		expect(probeActiveElementScript().isBody).toBe(true);
	});
});

describe("isFocusInsideTargetScript", () => {
	it("is true when the active element is the target", () => {
		document.body.innerHTML = `<main id="main" tabindex="-1">hello</main>`;
		(document.getElementById("main") as HTMLElement).focus();

		expect(isFocusInsideTargetScript("#main")).toBe(true);
	});

	it("is true when the active element is inside the target", () => {
		document.body.innerHTML = `<main id="main"><a href="/in">inside</a></main>`;
		(document.querySelector("a") as HTMLElement).focus();

		expect(isFocusInsideTargetScript("#main")).toBe(true);
	});

	it("is false when focus is outside the target", () => {
		document.body.innerHTML = `<a href="#main">Skip</a><main id="main"></main>`;
		(document.querySelector("a") as HTMLElement).focus();

		expect(isFocusInsideTargetScript("#main")).toBe(false);
	});
});
