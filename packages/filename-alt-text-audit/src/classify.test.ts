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
			expect(signalOf("4032", [SRC])).toBeNull();
			expect(signalOf("IMG_4032 at the beach", [SRC])).toBeNull();
		});

		it("ignores data URIs", () => {
			expect(signalOf("Team photo", ["data:image/png;base64,iVBORw0KGgo="])).toBeNull();
		});
	});

	describe("generated filenames", () => {
		it.each([
			["team-photo.jpg", "team-photo-300x200.jpg"],
			["team-photo.jpg", "team-photo-scaled.jpg"],
			["team-photo.jpg", "team-photo@2x.jpg"],
			["team-photo.jpg", "team-photo.a91f3c2b.jpg"],
			["team-photo.jpg", "team-photo-scaled-1024x683.jpg"],
			["IMG_4032.jpg", "IMG_4032-e1700000000000-150x150.jpg"],
		])("fails %s against the generated %s", (alt, file) => {
			expect(signalOf(alt, [`https://example.test/wp-content/uploads/${file}`])).toBe(
				"filename-match",
			);
		});

		it.each([
			["team-photo", "team-photo-300x200.jpg"],
			["Team photo", "team-photo-scaled.jpg"],
			["hero banner final", "hero-banner-final.a91f3c2b.webp"],
		])("reviews %s against the generated %s", (alt, file) => {
			expect(signalOf(alt, [`https://example.test/uploads/${file}`])).toBe("filename-near-match");
		});

		it("keeps a word that only looks like a hash", () => {
			expect(signalOf("sunset", ["https://example.test/sunset-facade.jpg"])).toBeNull();
			expect(signalOf("Sunset facade", ["https://example.test/sunset-facade.jpg"])).toBe(
				"filename-near-match",
			);
		});
	});

	describe("single-word filenames", () => {
		it.each([
			["GitHub", "github.svg"],
			["Sunset", "sunset.jpg"],
			["Trailhead", "Trailhead.png"],
		])("passes %s on %s, where the word is the subject", (alt, file) => {
			expect(signalOf(alt, [`https://example.test/${file}`])).toBeNull();
		});
	});

	describe("script artefacts", () => {
		it.each([
			"undefined",
			"null",
			"NaN",
			"[object Object]",
			"Photo of [object Object]",
			"{{ image.alt }}",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: an unrendered template literal is the input under test
			"${alt}",
			"<%= alt %>",
			"%s",
			"  undefined\n",
			"{{\n\timage.alt\n}}",
			"<%=\n  image.alt\n%>",
		])("fails %j", (alt) => {
			expect(classifyAltText(alt, [SRC], ENGLISH)).toEqual({ signal: "artefact", source: null });
		});

		it.each(["Null Island on a map", "An undefined shape", "Not a number"])(
			"leaves %s alone",
			(alt) => {
				expect(signalOf(alt)).toBeNull();
			},
		);

		// A script writes these in exactly one spelling; in any other they are a name or a word.
		it.each(["Nan", "NAN", "Null", "NULL", "Undefined", "nan"])(
			"leaves %s alone, which no script writes",
			(alt) => {
				expect(signalOf(alt)).toBeNull();
			},
		);

		it("reviews a multi-line template token among other words", () => {
			expect(signalOf("Photo of {{\n  person.name\n}}")).toBe("placeholder");
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
			"IMG 4032",
			"pano_360",
			"PXL_20230101_123456789",
			"Screenshot 2024-01-02 at 10.11.12",
			"Screen Shot 2020-01-01 at 1.23.45 PM",
			"Screenshot_20240102-101112.png",
			"WhatsApp Image 2023-05-01 at 09.12.33",
		])("flags %s", (alt) => {
			expect(signalOf(alt)).toBe("camera-name");
		});

		it.each([
			"IMG-2000 Pro",
			"DSC_1234 at sunset",
			"Image of a dog",
			"Screenshot of the app",
			"Pano 360",
			"WP 6",
			"Sam 2",
		])("leaves %s alone", (alt) => {
			expect(signalOf(alt)).toBeNull();
		});
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

		it.each([
			"300x200",
			"1920 × 1080",
			"0001",
			"20240102",
			"*",
			"-",
			"...",
			"Photo of {{ product.name }}",
		])("flags %s", (alt) => {
			expect(signalOf(alt)).toBe("placeholder");
		});

		it.each(["1", "5", "2024", "Step 2", "50% off"])(
			"leaves %s, which can be what the image shows",
			(alt) => {
				expect(signalOf(alt)).toBeNull();
			},
		);

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
