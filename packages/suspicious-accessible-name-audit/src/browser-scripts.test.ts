// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { collectNamedElementsScript } from "./browser-scripts";

const STASH_KEY = "__testStash";

function collect(elementLimit = 50, textLimit = 300) {
	return collectNamedElementsScript(STASH_KEY, elementLimit, textLimit);
}

function only(html: string) {
	document.body.innerHTML = html;

	const { elements } = collect();

	expect(elements).toHaveLength(1);

	return elements[0]!;
}

afterEach(() => {
	delete (window as unknown as Record<string, unknown>)[STASH_KEY];
	document.body.innerHTML = "";
	document.documentElement.removeAttribute("lang");
});

describe("collectNamedElementsScript", () => {
	describe("accessible name", () => {
		it("prefers aria-labelledby, then aria-label, then the label, then content", () => {
			document.body.innerHTML = `
				<span id="a">Basket</span><span id="b">total</span>
				<button aria-labelledby="a b" aria-label="ignored">x</button>
				<button aria-label="Close">x</button>
				<label for="email">Email</label><input id="email" title="ignored">
				<button title="ignored">Send <span>now</span></button>
			`;

			expect(collect().elements.map(({ name, source }) => [name, source])).toEqual([
				["Basket total", "aria-labelledby"],
				["Close", "aria-label"],
				["Email", "label"],
				["Send now", "content"],
			]);
		});

		it("falls back to value, title and placeholder", () => {
			document.body.innerHTML = `
				<input type="submit" value="Go">
				<a href="/map" title="Map"></a>
				<input placeholder="Search terms">
			`;

			expect(collect().elements.map(({ name, source }) => [name, source])).toEqual([
				["Go", "value"],
				["Map", "title"],
				["Search terms", "placeholder"],
			]);
		});

		it("leaves aria-hidden content and hidden descendants out of the name", () => {
			const element = only(
				`<a href="/"><span aria-hidden="true">★</span> Home <span style="display: none">page</span></a>`,
			);

			expect(element.name).toBe("Home");
		});

		it("reads image alt text and nested aria-label inside content", () => {
			expect(only(`<a href="/"><img src="/logo.svg" alt="Trailhead"> home</a>`).name).toBe(
				"Trailhead home",
			);
		});

		it("includes hidden text referenced by aria-labelledby", () => {
			document.body.innerHTML = `
				<span id="hidden-label" style="display: none">Quantity</span>
				<input aria-labelledby="hidden-label">
			`;

			expect(collect().elements[0]?.name).toBe("Quantity");
		});

		it("does not name a landmark from its content", () => {
			document.body.innerHTML = `<nav><a href="/">Home</a></nav><nav aria-label="Footer"></nav>`;

			expect(collect().elements.map(({ role, name }) => [role, name])).toEqual([
				["link", "Home"],
				["navigation", "Footer"],
			]);
		});
	});

	describe("applicability", () => {
		it("computes implicit and explicit roles", () => {
			document.body.innerHTML = `
				<input type="number" aria-label="a">
				<input type="checkbox" aria-label="b">
				<select aria-label="c"></select>
				<select multiple aria-label="d"></select>
				<div role="switch" aria-label="e"></div>
				<section aria-label="f"></section>
				<dialog open aria-label="g"></dialog>
			`;

			expect(collect().elements.map(({ role }) => role)).toEqual([
				"spinbutton",
				"checkbox",
				"combobox",
				"listbox",
				"switch",
				"region",
				"dialog",
			]);
		});

		it("skips images, image inputs, unnamed elements and anchors without href", () => {
			document.body.innerHTML = `
				<img src="/a.jpg" alt="IMG_4032.jpg">
				<div role="img" aria-label="chart"></div>
				<input type="image" src="/go.png" alt="go.png">
				<button></button>
				<a>Not a link</a>
				<div role="presentation" aria-label="x"></div>
			`;

			expect(collect().total).toBe(0);
		});

		it("skips elements hidden from assistive technology", () => {
			document.body.innerHTML = `
				<div aria-hidden="true"><button>Hidden</button></div>
				<button style="display: none">Gone</button>
			`;

			expect(collect().total).toBe(0);
		});

		it("descends open shadow roots", () => {
			const host = document.createElement("div");
			host.attachShadow({ mode: "open" }).innerHTML = `<button aria-label="banner1"></button>`;
			document.body.append(host);

			expect(collect().elements[0]?.name).toBe("banner1");
		});

		it("stops collecting at the element limit but counts every element", () => {
			document.body.innerHTML = "<button>a</button><button>b</button><button>c</button>";

			const { elements, total } = collect(2);

			expect(elements).toHaveLength(2);
			expect(total).toBe(3);
		});

		it("cuts long names short and marks them", () => {
			document.body.innerHTML = `<button aria-label="${"a".repeat(20)}"></button>`;

			expect(collect(50, 10).elements[0]).toMatchObject({ name: "a".repeat(10), truncated: true });
		});
	});

	describe("element facts", () => {
		it("records the element's identifiers", () => {
			const element = only(
				`<input id="qty" class="quantity-selector field" name="quantity" data-testid="qty-input" aria-label="q">`,
			);

			expect(element.identifiers).toEqual([
				{ attribute: "id", value: "qty" },
				{ attribute: "name", value: "quantity" },
				{ attribute: "data-testid", value: "qty-input" },
				{ attribute: "class", value: "quantity-selector" },
				{ attribute: "class", value: "field" },
			]);
		});

		it("marks buttons and links with no visible letters or digits as icon-only", () => {
			document.body.innerHTML = `
				<button aria-label="Print"><svg aria-hidden="true"></svg></button>
				<button aria-label="Info">ⓘ</button>
				<button aria-label="Send">Send</button>
				<input type="checkbox" aria-label="Agree">
			`;

			expect(collect().elements.map(({ iconOnly }) => iconOnly)).toEqual([
				true,
				true,
				false,
				false,
			]);
		});

		it("records whether a link has surrounding text", () => {
			document.body.innerHTML = `
				<p><a href="/a">promo-tile-3</a></p>
				<p>Read the <a href="/b">returns-policy-page</a> first.</p>
				<a href="/c" aria-describedby="d">x</a><span id="d">About returns</span>
			`;

			expect(collect().elements.map(({ linkContext }) => linkContext)).toEqual([false, true, true]);
		});

		it("records the nearest declared language", () => {
			document.documentElement.setAttribute("lang", "en");
			document.body.innerHTML = `<button>a</button><div lang="sv"><button>b</button></div>`;

			expect(collect().elements.map(({ lang }) => lang)).toEqual(["en", "sv"]);
		});

		it("leaves the collected elements on the stash", () => {
			document.body.innerHTML = "<button>a</button>";
			collect();

			const stash = (window as unknown as Record<string, unknown>)[STASH_KEY] as Element[];

			expect(stash.map((el) => el.localName)).toEqual(["button"]);
		});
	});
});
