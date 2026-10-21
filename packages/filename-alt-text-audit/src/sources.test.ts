import { describe, expect, it } from "vitest";
import { filenameOf, parseSrcset } from "./sources";

describe("parseSrcset", () => {
	it("drops width and density descriptors", () => {
		expect(parseSrcset("small.jpg 480w, large.jpg 1080w")).toEqual(["small.jpg", "large.jpg"]);
		expect(parseSrcset("photo.jpg, photo@2x.jpg 2x")).toEqual(["photo.jpg", "photo@2x.jpg"]);
	});

	it("keeps commas inside a URL", () => {
		expect(parseSrcset("https://cdn.test/w_300,h_200/photo.jpg 300w, b.jpg 600w")).toEqual([
			"https://cdn.test/w_300,h_200/photo.jpg",
			"b.jpg",
		]);
	});

	it("strips a trailing comma from a URL with no descriptor", () => {
		expect(parseSrcset("a.jpg,b.jpg 2x")).toEqual(["a.jpg,b.jpg"]);
		expect(parseSrcset("a.jpg, b.jpg")).toEqual(["a.jpg", "b.jpg"]);
	});

	it("handles stray whitespace and empty candidates", () => {
		expect(parseSrcset("  a.jpg 1x ,, b.jpg 2x  ")).toEqual(["a.jpg", "b.jpg"]);
		expect(parseSrcset("")).toEqual([]);
	});
});

describe("filenameOf", () => {
	it("returns the last path segment without query or fragment", () => {
		expect(filenameOf("https://example.test/images/IMG_4032.jpg?w=640#top")).toBe("IMG_4032.jpg");
	});

	it("resolves a relative URL against a base", () => {
		expect(filenameOf("../a/photo.png", "https://example.test/x/y/")).toBe("photo.png");
	});

	it("decodes percent-encoded and non-latin filenames", () => {
		expect(filenameOf("https://example.test/my%20photo.jpg")).toBe("my photo.jpg");
		expect(filenameOf("https://example.test/f%C3%A5gel.jpg")).toBe("fågel.jpg");
		expect(filenameOf("https://example.test/写真.jpg")).toBe("写真.jpg");
	});

	it("keeps a segment that is not valid percent-encoding", () => {
		expect(filenameOf("https://example.test/100%25%zz.jpg")).toBe("100%25%zz.jpg");
	});

	it("returns null for data and blob URLs, directories and unparseable URLs", () => {
		expect(filenameOf("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
		expect(filenameOf("blob:https://example.test/5f3c")).toBeNull();
		expect(filenameOf("https://example.test/images/")).toBeNull();
		expect(filenameOf("not a url")).toBeNull();
	});
});
