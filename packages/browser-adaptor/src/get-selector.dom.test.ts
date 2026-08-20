// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { getSelector } from "./get-selector";

/**
 * These tests exercise getSelector against a real DOM, where the property that
 * matters is uniqueness: the selector it returns must resolve to exactly the
 * element it was built from. The pure-logic tests in get-selector.test.ts cover
 * the serialised, sibling-unaware behaviour with fake nodes.
 */
function expectUnique(el: Element): string {
	const selector = getSelector(el);
	const matches = el.ownerDocument.querySelectorAll(selector);

	expect(
		matches.length,
		`selector "${selector}" matched ${matches.length} elements`,
	).toBe(1);
	expect(matches[0]).toBe(el);

	return selector;
}

describe("getSelector uniqueness", () => {
	it("disambiguates identical-class siblings with no id ancestor", () => {
		// Mirrors the tyoelake.fi footer navigation: sibling <li>s with identical
		// classes, each wrapping an <a> with identical classes, and no id anywhere
		// in the ancestry to anchor on.
		document.body.innerHTML = `
			<ul class="menu">
				<li class="nav-item"><a class="link" href="/a">A</a></li>
				<li class="nav-item"><a class="link" href="/b">B</a></li>
				<li class="nav-item"><a class="link" href="/c">C</a></li>
			</ul>
		`;

		const links = Array.from(document.querySelectorAll("a.link"));
		expect(links).toHaveLength(3);

		const selectors = links.map((link) => expectUnique(link));

		// Every selector must be distinct from the others.
		expect(new Set(selectors).size).toBe(3);
	});

	it("does not anchor on a non-unique id", () => {
		// Mirrors tyoelake.fi heading links: the page repeats the same id on
		// distinct headings, so "#dup>a" resolves to more than one element.
		document.body.innerHTML = `
			<div><h3 id="dup"><a href="/one">one</a></h3></div>
			<div><h3 id="dup"><a href="/two">two</a></h3></div>
		`;

		const links = Array.from(document.querySelectorAll("a"));
		expect(links).toHaveLength(2);

		for (const link of links) {
			expectUnique(link);
		}
	});

	it("still anchors on a genuinely unique id", () => {
		// The decoy section makes every level below the id ambiguous, so the walk
		// must genuinely reach and anchor on #panel to disambiguate.
		document.body.innerHTML = `
			<section id="panel"><div><span tabindex="0">one</span></div></section>
			<section><div><span tabindex="0">two</span></div></section>
		`;

		const target = document.querySelector("#panel span") as Element;
		const selector = expectUnique(target);

		expect(selector.startsWith("#panel")).toBe(true);
	});
});

describe("getSelector minimal segments", () => {
	it("uses a single discriminating class rather than every class", () => {
		// Mirrors WordPress post cards: a wall of shared utility classes plus one
		// class that is unique to the element.
		document.body.innerHTML = `
			<li class="post hentry status-publish post-1123" tabindex="0">a</li>
			<li class="post hentry status-publish post-1125" tabindex="0">b</li>
		`;

		const first = document.querySelector(".post-1123") as Element;
		const selector = expectUnique(first);

		expect(selector).toContain("post-1123");
		expect(selector).not.toContain("hentry");
		expect(selector).not.toContain("status-publish");
	});

	it("stops walking as soon as the selector is unique", () => {
		// The target's class is unique on the page, so no ancestor segments are
		// needed at all. Matching how axe-core selectors stay short.
		document.body.innerHTML = `
			<div class="wrapper"><div class="inner"><nav class="menu">
				<a class="standalone-cta" href="/cta">cta</a>
			</nav></div></div>
		`;

		const target = document.querySelector(".standalone-cta") as Element;
		const selector = expectUnique(target);

		expect(selector).toBe("a.standalone-cta");
	});

	it("discriminates structurally-identical content by href", () => {
		// Three sections with identical classes and positions inside separate
		// wrappers: nth-of-type pins position within each parent, so it can't
		// tell the copies apart. But their hrefs differ, as on real pages.
		const section = (href: string) => `
			<div class="group"><div class="column">
				<h3 class="arrow-link"><a href="${href}">go</a></h3>
			</div></div>
		`;
		// Absolute URLs commonly run past 60 characters; they must still qualify.
		const base = "https://www.example.com/section/sub-section/long-page-slug";
		document.body.innerHTML =
			section(`${base}-one/`) + section(`${base}-two/`) + section("/three/");

		const links = Array.from(document.querySelectorAll("a"));
		expect(links).toHaveLength(3);

		for (const link of links) {
			const selector = expectUnique(link);

			expect(selector).toContain("[href=");
		}
	});

	it("keeps room for ancestor context when an href is not unique", () => {
		// The same long href appears twice (e.g. a card link and a nav link), so
		// it can't pin either element on its own. Disambiguating ancestors must
		// still fit within the budget alongside the ~100-character href.
		const href = `https://www.example.com/${"long-segment/".repeat(5)}page/`;
		document.body.innerHTML = `
			<nav class="primary-site-navigation-block"><a href="${href}">nav link</a></nav>
			<article class="featured-content-card-block"><a href="${href}">card link</a></article>
		`;

		const links = Array.from(document.querySelectorAll("a"));
		expect(links).toHaveLength(2);

		for (const link of links) {
			expectUnique(link);
		}
	});

	it("does not build href features from values with CSS escape characters", () => {
		// A backslash in an attribute value is a CSS string escape, so the
		// selector can parse to a different string than the attribute holds.
		// Matching nothing, or worse, a different element entirely.
		document.body.innerHTML = String.raw`
			<div><a href="docs\one">one</a><a href="docs\two">two</a></div>
		`;

		const links = Array.from(document.querySelectorAll("a"));
		expect(links).toHaveLength(2);

		for (const link of links) {
			const selector = expectUnique(link);

			expect(selector).not.toContain("[href=");
		}
	});

	it("does not build href features from volatile query-string URLs", () => {
		// Query strings change between scans (pagination, session ids), which
		// would destabilise the selector; positional pins handle these instead.
		document.body.innerHTML = `
			<div><a href="/list?page=1">1</a><a href="/list?page=2">2</a></div>
		`;

		const links = Array.from(document.querySelectorAll("a"));

		for (const link of links) {
			const selector = expectUnique(link);

			expect(selector).not.toContain("?page");
		}
	});

	it("still uses stable fragment hrefs such as skip links", () => {
		document.body.innerHTML = `
			<a href="#main">skip</a><a href="#footer">footer</a>
		`;

		const skip = document.querySelector("a") as Element;
		const selector = expectUnique(skip);

		expect(selector).toContain('[href="#main"]');
	});

	it("rejects a feature the element itself does not match", () => {
		// Simulates an engine/escaping mismatch: if the element doesn't match a
		// candidate feature, that feature can select the wrong element and must
		// not be used.
		document.body.innerHTML = `
			<div><a href="/alpha">a</a><a href="/beta">b</a></div>
		`;

		const link = document.querySelector("a") as Element;
		const originalMatches = link.matches.bind(link);
		(link as { matches: (selectors: string) => boolean }).matches = (
			selector: string,
		) => (selector.includes("[href=") ? false : originalMatches(selector));

		const selector = expectUnique(link);

		expect(selector).not.toContain("[href=");
	});

	it("pins position with nth-of-type when classes cannot discriminate", () => {
		document.body.innerHTML = `
			<div><button class="btn">one</button><button class="btn">two</button></div>
		`;

		const second = document.querySelectorAll("button")[1] as Element;
		const selector = expectUnique(second);

		expect(selector).toContain(":nth-of-type(2)");
	});
});

describe("getSelector length budget", () => {
	it("caps the selector at 128 characters and still matches the element", () => {
		// Deeply nested markup where every level shares the same classes, so
		// uniqueness is never reached and the walk is bounded by the budget; the
		// capped selector may not be unique, but it must still match the element.
		const open = Array.from(
			{ length: 30 },
			() =>
				`<div class="level-alpha level-beta"><div class="level-alpha level-beta">`,
		).join("");
		document.body.innerHTML = `${open}<a href="/target">target</a>${"</div></div>".repeat(30)}`;

		const link = document.querySelector("a") as Element;
		const selector = getSelector(link);

		expect(selector.length).toBeLessThanOrEqual(128);
		expect(Array.from(document.querySelectorAll(selector))).toContain(link);
	});

	it("degrades a leaf segment that alone exceeds the budget to tag and position", () => {
		// A single class longer than the whole budget: the selector must stay
		// non-empty, within budget, and unique via the position pin.
		const giant = "x".repeat(200);
		document.body.innerHTML = `
			<div>
				<button class="${giant}">one</button>
				<button class="${giant}">two</button>
			</div>
		`;

		const second = document.querySelectorAll("button")[1] as Element;
		const selector = expectUnique(second);

		expect(selector.length).toBeLessThanOrEqual(128);
		expect(selector).toContain("button:nth-of-type(2)");
	});
});
