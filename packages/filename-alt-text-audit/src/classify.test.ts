import { describe, expect, it } from "vitest";
import { classifyAltText } from "./classify";
import { placeholderWordsFor } from "./placeholder-words";

const ENGLISH = placeholderWordsFor("en");

const SRC = "https://example.test/images/IMG_4032.jpg";

function signalOf(alt: string, sources: readonly string[] = [], lang = "en") {
	return classifyAltText(alt, sources, placeholderWordsFor(lang))?.signal ?? null;
}

describe("classifyAltText", () => {
	describe("own filename", () => {
		it("fails alt text that is the full filename", () => {
			expect(classifyAltText("IMG_4032.jpg", [SRC], ENGLISH)).toEqual({
				signal: "filename-match",
				source: SRC,
			});
		});

		it("ignores case and surrounding whitespace", () => {
			expect(signalOf("  img_4032.JPG ", [SRC])).toBe("filename-match");
		});

		it("matches a decoded filename", () => {
			expect(signalOf("my photo.jpg", ["https://example.test/my%20photo.jpg"])).toBe(
				"filename-match",
			);
			expect(signalOf("fågel.jpg", ["https://example.test/f%C3%A5gel.jpg"])).toBe("filename-match");
		});

		it("matches across Unicode normalisation forms", () => {
			const decomposed = "https://example.test/namnlo%CC%88s.png";

			expect(signalOf("namnlös.png", [decomposed])).toBe("filename-match");
		});

		it("matches any source, such as a srcset candidate", () => {
			const sources = ["https://example.test/hashed-a91f3c.jpg", SRC];

			expect(classifyAltText("IMG_4032.jpg", sources, ENGLISH)?.source).toBe(SRC);
		});

		it("routes the filename without its extension to review", () => {
			expect(signalOf("IMG_4032", [SRC])).toBe("filename-near-match");
		});

		it("routes the filename with separators read as spaces to review", () => {
			const src = "https://example.test/sunset-over-stockholm.jpg";

			expect(signalOf("Sunset over Stockholm", [src])).toBe("filename-near-match");
			expect(signalOf("sunset over stockholm.jpg", [src])).toBe("filename-near-match");
		});

		it("never treats an extensionless route as a filename", () => {
			const resizer = "https://example.test/_next/image?url=%2Fteam.jpg&w=640";

			expect(signalOf("Our returns team", [resizer])).toBeNull();
			expect(signalOf("image", [resizer])).toBe("placeholder");
		});

		it("never matches part of the filename", () => {
			expect(signalOf("4032", [SRC])).toBe("placeholder");
			expect(signalOf("IMG_4032 at the beach", [SRC])).toBeNull();
		});

		it("ignores data URIs", () => {
			expect(signalOf("Team photo", ["data:image/png;base64,iVBORw0KGgo="])).toBeNull();
		});
	});

	describe("camera names", () => {
		it.each([
			"DSC_1234",
			"DSC01234",
			"DSCN0042",
			"IMG_20240101_123456",
			"IMG_4032.HEIC",
			"img-1234 (1)",
			"GOPR0042",
			"PXL_20230101_123456789",
			"Screenshot 2024-01-02 at 10.11.12",
			"Screen Shot 2020-01-01 at 1.23.45 PM",
			"Screenshot_20240102-101112.png",
			"WhatsApp Image 2023-05-01 at 09.12.33",
		])("flags %s", (alt) => {
			expect(signalOf(alt)).toBe("camera-name");
		});

		it.each(["IMG-2000 Pro", "DSC_1234 at sunset", "Image of a dog", "Screenshot of the app"])(
			"leaves %s alone",
			(alt) => {
				expect(signalOf(alt)).toBeNull();
			},
		);
	});

	describe("filename-like alt text", () => {
		it("flags alt text ending with an image extension that is not this image's filename", () => {
			expect(signalOf("team-photo.jpg", ["https://cdn.test/a91f3c.webp"])).toBe("filename-like");
			expect(signalOf("banner.SVG")).toBe("filename-like");
		});

		it("leaves domain names alone", () => {
			expect(signalOf("example.com")).toBeNull();
			expect(signalOf("xxl.se")).toBeNull();
		});
	});

	describe("placeholders", () => {
		it.each(["image", "Image.", "PHOTO", "picture", "alt text", "image  description", "spacer"])(
			"flags %s",
			(alt) => {
				expect(signalOf(alt)).toBe("placeholder");
			},
		);

		it.each(["picture 1", "image_02", "foto-3"])("flags the numbered placeholder %s", (alt) => {
			expect(signalOf(alt, [], "sv")).toBe("placeholder");
		});

		it.each(["300x200", "1920 × 1080", "0001", "*", "-", "..."])("flags %s", (alt) => {
			expect(signalOf(alt)).toBe("placeholder");
		});

		it("applies the page language's list as well as English", () => {
			expect(signalOf("bild", [], "sv")).toBe("placeholder");
			expect(signalOf("bild", [], "sv-SE")).toBe("placeholder");
			expect(signalOf("image", [], "sv")).toBe("placeholder");
			expect(signalOf("bild", [], "en")).toBeNull();
		});

		it("maps Norwegian language codes onto one list", () => {
			expect(signalOf("bilde", [], "no")).toBe("placeholder");
			expect(signalOf("bilde", [], "nn")).toBe("placeholder");
			expect(signalOf("bilde", [], "nb-NO")).toBe("placeholder");
		});

		it("falls back to English for a page with no language", () => {
			expect(classifyAltText("photo", [], placeholderWordsFor(null))?.signal).toBe("placeholder");
		});

		it("matches the whole alt text, never a word inside it", () => {
			expect(signalOf("Logo of Trailhead Outfitters")).toBeNull();
			expect(signalOf("Photo of the packed tent")).toBeNull();
			expect(signalOf("Windows 11")).toBeNull();
		});
	});

	it("passes descriptive alt text", () => {
		expect(signalOf("Tent folded into its carry bag beside a returns slip", [SRC])).toBeNull();
	});
});
