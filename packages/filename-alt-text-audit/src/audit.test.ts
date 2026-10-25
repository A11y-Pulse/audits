import { fakeStashAdaptor } from "@a11y-pulse/integration-harness/fake-stash-adaptor";
import { describe, expect, it } from "vitest";
import { runFilenameAltTextAudit } from "./audit";
import { type CollectedImage, collectImagesScript, type ImageCollection } from "./browser-scripts";

const BASE_URL = "https://example.test/products/";

function image(altText: string, src: string, extra: Partial<CollectedImage> = {}): CollectedImage {
	return {
		altText,
		truncated: false,
		urls: [new URL(src, BASE_URL).href],
		srcsets: [],
		html: `<img src="${src}" alt="${altText}">`,
		...extra,
	};
}

function fakePage(collection: ImageCollection) {
	return fakeStashAdaptor(collectImagesScript, collection, "image");
}

function collection(images: CollectedImage[], extra: Partial<ImageCollection> = {}) {
	return { lang: "en", baseUrl: BASE_URL, images, total: images.length, ...extra };
}

describe("runFilenameAltTextAudit", () => {
	it("sorts images into failed, needs review and passed", async () => {
		const page = fakePage(
			collection([
				image("IMG_4032.jpg", "IMG_4032.jpg"),
				image("DSC_0192", "a91f3c.jpg"),
				image("Packed tent beside a returns slip", "tent.jpg"),
			]),
		);

		const result = await runFilenameAltTextAudit(page.adaptor);

		expect(result.failed).toEqual([
			{
				selector: "#image-0",
				html: '<img src="IMG_4032.jpg" alt="IMG_4032.jpg">',
				altText: "IMG_4032.jpg",
				signal: "filename-match",
				matchedSource: `${BASE_URL}IMG_4032.jpg`,
				screenshot: new Uint8Array([1]),
			},
		]);
		expect(result.needsReview).toMatchObject([
			{ selector: "#image-1", signal: "camera-name", matchedSource: null },
		]);
		expect(result.passed).toMatchObject([{ selector: "#image-2", signal: null }]);
		expect(result.summary).toEqual({
			checked: 3,
			failed: 1,
			needsReview: 1,
			passed: 1,
			unchecked: 0,
		});
	});

	it("matches a srcset candidate resolved against the page", async () => {
		const page = fakePage(
			collection([
				image("IMG_4032.jpg", "a91f3c.jpg", {
					srcsets: ["../media/IMG_4032.jpg 2x, ../media/other.jpg 3x"],
				}),
			]),
		);

		const result = await runFilenameAltTextAudit(page.adaptor);

		expect(result.failed[0]?.matchedSource).toBe("https://example.test/media/IMG_4032.jpg");
	});

	it("uses the page language for placeholder words", async () => {
		const page = fakePage(collection([image("bild", "tent.jpg")], { lang: "sv" }));

		const result = await runFilenameAltTextAudit(page.adaptor);

		expect(result.needsReview[0]?.signal).toBe("placeholder");
	});

	it("passes truncated alt text without classifying it", async () => {
		const page = fakePage(collection([image("photo", "tent.jpg", { truncated: true })]));

		const result = await runFilenameAltTextAudit(page.adaptor);

		expect(result.summary.passed).toBe(1);
	});

	it("reports up to the report limit but counts everything", async () => {
		const images = Array.from({ length: 5 }, (_, i) => image("image", `${i}.jpg`));
		const page = fakePage(collection(images, { total: 7 }));

		const result = await runFilenameAltTextAudit(page.adaptor, { reportLimit: 2 });

		expect(result.needsReview.map((entry) => entry.selector)).toEqual(["#image-0", "#image-1"]);
		expect(result.summary).toMatchObject({ checked: 5, needsReview: 5, unchecked: 2 });
	});

	it("releases the collected images from the page", async () => {
		const page = fakePage(collection([image("image", "a.jpg")]));

		await runFilenameAltTextAudit(page.adaptor);

		expect(page.released()).toBe(true);
	});

	it("screenshots failed and needs-review images but not passed ones", async () => {
		const page = fakePage(
			collection([
				image("IMG_4032.jpg", "IMG_4032.jpg"),
				image("DSC_0192", "a91f3c.jpg"),
				image("Packed tent beside a returns slip", "tent.jpg"),
			]),
		);

		const result = await runFilenameAltTextAudit(page.adaptor);

		expect(result.needsReview[0]?.screenshot).toEqual(new Uint8Array([1]));
		expect(result.passed[0]).not.toHaveProperty("screenshot");
		expect(page.screenshotted()).toEqual([0, 1]);
	});

	it("spends the screenshot limit on failed images first", async () => {
		const page = fakePage(
			collection([
				image("DSC_0192", "a91f3c.jpg"),
				image("IMG_1.jpg", "IMG_1.jpg"),
				image("IMG_2.jpg", "IMG_2.jpg"),
			]),
		);

		const result = await runFilenameAltTextAudit(page.adaptor, { screenshotLimit: 2 });

		expect(result.failed.every((entry) => entry.screenshot)).toBe(true);
		expect(result.needsReview[0]).not.toHaveProperty("screenshot");
		expect(page.screenshotted()).toEqual([1, 2]);
	});
});
