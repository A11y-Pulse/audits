import type {
	FilenameAltTextImage,
	FilenameAltTextResult,
} from "@a11y-pulse/filename-alt-text-audit";
import { describe, expect, it } from "vitest";
import {
	FILENAME_ALT_TEXT_AUDIT_ID,
	FILENAME_ALT_TEXT_EVIDENCE_CHECK_ID,
	filenameAltTextToAxe,
} from "./filename-alt-text";

function image(overrides: Partial<FilenameAltTextImage> = {}): FilenameAltTextImage {
	return {
		selector: "#a",
		html: "<img>",
		altText: "Packed tent",
		signal: null,
		matchedSource: null,
		...overrides,
	};
}

function result(
	failed: FilenameAltTextImage[],
	needsReview: FilenameAltTextImage[],
	passed: FilenameAltTextImage[],
): FilenameAltTextResult {
	return {
		failed,
		needsReview,
		passed,
		summary: {
			checked: failed.length + needsReview.length + passed.length,
			failed: failed.length,
			needsReview: needsReview.length,
			passed: passed.length,
			unchecked: 0,
		},
	};
}

describe("filenameAltTextToAxe", () => {
	it("routes each list to its bucket", () => {
		const output = filenameAltTextToAxe(
			result(
				[image({ selector: "#failed", signal: "filename-match" })],
				[image({ selector: "#review", signal: "placeholder" })],
				[image({ selector: "#passed" })],
			),
		);

		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#failed"]);
		expect(output.incomplete[0]?.nodes[0]?.target).toEqual(["#review"]);
		expect(output.passes[0]?.nodes[0]?.target).toEqual(["#passed"]);
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
	});

	it("names the alt text and what is wrong with it", () => {
		const output = filenameAltTextToAxe(
			result(
				[image({ altText: "IMG_4032.jpg", signal: "filename-match" })],
				[
					image({ altText: "DSC_0192", signal: "camera-name" }),
					image({ altText: "bild", signal: "placeholder" }),
				],
				[],
			),
		);

		expect(output.violations[0]?.nodes[0]?.failureSummary).toBe(
			'The alt text "IMG_4032.jpg" is the image\'s filename. Replace it with a description of what the image shows, or alt="" if the image is decorative.',
		);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain(
			'"DSC_0192" looks like a camera or screenshot file name. Check that it describes the image',
		);
		expect(output.incomplete[0]?.nodes[1]?.failureSummary).toContain(
			'"bild" looks like placeholder text.',
		);
	});

	it("tags results as 1.1.1 results", () => {
		const output = filenameAltTextToAxe(result([image({ signal: "filename-match" })], [], []));

		expect(output.violations[0]).toMatchObject({
			id: FILENAME_ALT_TEXT_AUDIT_ID,
			impact: "serious",
			tags: ["wcag2a", "wcag111", "cat.text-alternatives"],
		});
	});

	it("is inapplicable when the page has no images with alt text", () => {
		const output = filenameAltTextToAxe(result([], [], []));

		expect(output.inapplicable[0]?.id).toBe(FILENAME_ALT_TEXT_AUDIT_ID);
		expect(output.violations).toEqual([]);
		expect(output.passes).toEqual([]);
	});

	it("attaches a screenshot when the audit captured one", () => {
		const screenshot = new Uint8Array([1]);
		const output = filenameAltTextToAxe(
			result([], [image({ altText: "DSC_0192", signal: "camera-name", screenshot })], []),
		);

		expect(output.incomplete[0]?.nodes[0]?.any[0]).toMatchObject({
			id: FILENAME_ALT_TEXT_EVIDENCE_CHECK_ID,
			message: 'Image with the alt text "DSC_0192"',
			data: { screenshot },
		});
	});
});
