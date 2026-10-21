// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { collectImagesScript } from "./browser-scripts";

const STASH_KEY = "__testStash";

function collect(imageLimit = 10, altTextLimit = 300) {
	return collectImagesScript(STASH_KEY, imageLimit, altTextLimit);
}

afterEach(() => {
	delete (window as unknown as Record<string, unknown>)[STASH_KEY];
	document.body.innerHTML = "";
});

describe("collectImagesScript", () => {
	it("collects images and image inputs with alt text", () => {
		document.body.innerHTML = `
			<img src="/a.jpg" alt="IMG_4032.jpg">
			<input type="image" src="/go.png" alt="go.png">
			<input type="text" alt="ignored">
		`;

		const { images, total } = collect();

		expect(total).toBe(2);
		expect(images.map((image) => image.altText)).toEqual(["IMG_4032.jpg", "go.png"]);
		expect(images[0]?.urls).toEqual([new URL("/a.jpg", document.baseURI).href]);
		expect(images[0]?.html).toBe('<img src="/a.jpg" alt="IMG_4032.jpg">');
	});

	it("skips images with no alt text, whitespace-only alt or alt=''", () => {
		document.body.innerHTML = `<img src="/a.jpg"><img src="/b.jpg" alt=""><img src="/c.jpg" alt="  ">`;

		expect(collect().total).toBe(0);
	});

	it("prefers aria-label over alt", () => {
		document.body.innerHTML = `<img src="/a.jpg" alt="IMG_4032.jpg" aria-label="Packed tent">`;

		expect(collect().images[0]?.altText).toBe("Packed tent");
	});

	it("skips images named by aria-labelledby or hidden from assistive technology", () => {
		document.body.innerHTML = `
			<span id="caption">Packed tent</span>
			<img src="/a.jpg" alt="a.jpg" aria-labelledby="caption">
			<div aria-hidden="true"><img src="/b.jpg" alt="b.jpg"></div>
		`;

		expect(collect().total).toBe(0);
	});

	it("gathers srcset values from the image and its picture sources", () => {
		document.body.innerHTML = `
			<picture>
				<source srcset="/wide.webp 1200w" media="(min-width: 800px)">
				<img src="/fallback.jpg" srcset="/small.jpg 480w" alt="Tent">
			</picture>
		`;

		expect(collect().images[0]?.srcsets).toEqual(["/small.jpg 480w", "/wide.webp 1200w"]);
	});

	it("descends open shadow roots", () => {
		const host = document.createElement("div");
		host.attachShadow({ mode: "open" }).innerHTML = `<img src="/a.jpg" alt="shadow.jpg">`;
		document.body.append(host);

		expect(collect().images[0]?.altText).toBe("shadow.jpg");
	});

	it("stops collecting at the image limit but counts every image", () => {
		document.body.innerHTML = `<img src="/a.jpg" alt="a"><img src="/b.jpg" alt="b"><img src="/c.jpg" alt="c">`;

		const { images, total } = collect(2);

		expect(images).toHaveLength(2);
		expect(total).toBe(3);
	});

	it("truncates long alt text", () => {
		document.body.innerHTML = `<img src="/a.jpg" alt="${"x".repeat(20)}">`;

		expect(collect(10, 5).images[0]).toMatchObject({
			altText: "xxxxx",
			truncated: true,
		});
	});

	it("reads the document language", () => {
		document.documentElement.setAttribute("lang", "sv");

		try {
			expect(collect().lang).toBe("sv");
		} finally {
			document.documentElement.removeAttribute("lang");
		}
	});

	it("leaves the collected elements on the stash key in collection order", () => {
		document.body.innerHTML = `<img id="a" src="/a.jpg" alt="a"><img id="b" src="/b.jpg" alt="b">`;
		collect();

		const stash = (window as unknown as Record<string, Element[]>)[STASH_KEY];

		expect(stash?.map((element) => element.id)).toEqual(["a", "b"]);
	});
});
