// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { awaitImagesScript, collectImagesScript } from "./browser-scripts";

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

describe("collectImagesScript sources and kinds", () => {
	it("reads lazy-loading attributes as sources", () => {
		document.body.innerHTML = `
			<picture>
				<source data-srcset="/media/wide.webp 1200w">
				<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/media/IMG_4032.jpg"
					data-srcset="/media/small.jpg 480w" data-lazy-srcset="/media/lazy.jpg 2x" alt="IMG_4032.jpg">
			</picture>
			<img data-lazy-src="/media/hero.jpg" data-original="/media/original.jpg" alt="hero">
		`;

		const { images } = collect();

		expect(images[0]?.urls).toContain(new URL("/media/IMG_4032.jpg", document.baseURI).href);
		expect(images[0]?.srcsets).toEqual([
			"/media/small.jpg 480w",
			"/media/lazy.jpg 2x",
			"/media/wide.webp 1200w",
		]);
		expect(images[1]?.urls).toEqual([
			new URL("/media/hero.jpg", document.baseURI).href,
			new URL("/media/original.jpg", document.baseURI).href,
		]);
	});

	it("records where the text alternative came from", () => {
		document.body.innerHTML = `
			<img src="/a.jpg" alt="a">
			<img src="/b.jpg" alt="b" aria-label="label">
			<svg role="img"><title>IMG_4032</title><rect/></svg>
		`;

		expect(collect().images.map((image) => [image.altText, image.altTextSource])).toEqual([
			["a", "alt"],
			["label", "aria-label"],
			["IMG_4032", "title"],
		]);
	});

	it("collects role=img elements, titled SVGs and image map areas", () => {
		document.body.innerHTML = `
			<div role="img" aria-label="IMG_4032.jpg"></div>
			<svg role="img"><title>logo.svg</title><rect/></svg>
			<svg><title>not an image role</title></svg>
			<svg role="img"><rect/></svg>
			<div role="img"></div>
			<map name="m"><area href="/north" alt="north.png"><area alt="no link"></map>
		`;

		expect(collect().images.map((image) => image.altText)).toEqual([
			"IMG_4032.jpg",
			"logo.svg",
			"north.png",
		]);
	});

	it("skips an image made presentational, whose alt is never announced", () => {
		document.body.innerHTML = `
			<img src="/a.jpg" role="presentation" alt="IMG_4032.jpg">
			<img src="/b.jpg" role="none" alt="b.jpg">
		`;

		expect(collect().total).toBe(0);
	});
});

describe("awaitImagesScript", () => {
	function pendingImage(): HTMLImageElement {
		const img = document.createElement("img");
		Object.defineProperty(img, "complete", { value: false });

		return img;
	}

	function stash(elements: Element[]): void {
		(window as unknown as Record<string, unknown>)[STASH_KEY] = elements;
	}

	it("returns at once when nothing is still loading", async () => {
		stash([document.createElement("div"), document.createElement("img")]);

		await expect(awaitImagesScript(STASH_KEY, [0, 1], 10_000)).resolves.toBeUndefined();
	});

	it("loads lazy images eagerly, waits for them, then restores their loading attribute", async () => {
		const img = pendingImage();
		img.loading = "lazy";
		stash([img]);

		const waiting = awaitImagesScript(STASH_KEY, [0], 10_000);
		const loadingWhileWaiting = img.loading;
		img.dispatchEvent(new Event("load"));
		await waiting;

		expect(loadingWhileWaiting).toBe("eager");
		expect(img.loading).toBe("lazy");
	});

	it("stops waiting for an image whose load fails", async () => {
		const img = pendingImage();
		stash([img]);

		const waiting = awaitImagesScript(STASH_KEY, [0], 10_000);
		img.dispatchEvent(new Event("error"));

		await expect(waiting).resolves.toBeUndefined();
	});

	it("spends one timeout on every stalled image together", async () => {
		stash(Array.from({ length: 10 }, pendingImage));

		const started = Date.now();
		await awaitImagesScript(STASH_KEY, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 50);

		expect(Date.now() - started).toBeLessThan(400);
	});

	it("only waits for the images asked for", async () => {
		stash([pendingImage(), document.createElement("img")]);

		await expect(awaitImagesScript(STASH_KEY, [1], 10_000)).resolves.toBeUndefined();
	});
});
