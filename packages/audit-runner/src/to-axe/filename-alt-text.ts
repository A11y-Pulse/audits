import type {
	AltTextSignal,
	AltTextSource,
	FilenameAltTextImage,
	FilenameAltTextResult,
} from "@a11y-pulse/filename-alt-text-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	evidenceCheck,
	sortedResultToAxe,
} from "./audit-output";

export const FILENAME_ALT_TEXT_AUDIT_ID = "filename-alt-text";

export const FILENAME_ALT_TEXT_EVIDENCE_CHECK_ID = "filename-alt-text-evidence";

export const METADATA: AuditMetadata = {
	id: FILENAME_ALT_TEXT_AUDIT_ID,
	help: "Alt text must not be a filename or placeholder text",
	description:
		"Ensures that image alt text is not the image's filename, a camera file name or placeholder text, which are not text alternatives (WCAG 1.1.1 Non-text Content, failure F30).",
	helpUrl: "https://www.a11ypulse.com/docs/filename-alt-text-audit",
	impact: "serious",
	tags: ["wcag2a", "wcag111", "cat.text-alternatives"],
};

const SOURCE_NAMES: Record<AltTextSource, string> = {
	alt: "alt text",
	"aria-label": "aria-label",
	title: "SVG title",
};

// Decorative images are hidden differently depending on what names them.
const REPLACEMENTS: Record<AltTextSource, string> = {
	alt: 'a description of what the image shows, or alt="" if the image is decorative',
	"aria-label":
		'a description of what the image shows, or remove the aria-label and use alt="" if the image is decorative',
	title:
		'a description of what the image shows, or remove the title and add aria-hidden="true" if the image is decorative',
};

const FINDINGS: Record<AltTextSignal, string> = {
	"filename-match": "is the image's filename",
	artefact: "is a leftover script value or template token",
	"filename-near-match": "matches the image's filename",
	"camera-name": "looks like a camera or screenshot file name",
	"filename-like": "looks like a filename",
	placeholder: "looks like placeholder text",
};

function failureSummary(image: FilenameAltTextImage, signal: AltTextSignal): string {
	const finding = `The ${SOURCE_NAMES[image.altTextSource]} "${image.altText}" ${FINDINGS[signal]}.`;
	const replacement = REPLACEMENTS[image.altTextSource];

	if (signal === "filename-match" || signal === "artefact") {
		return `${finding} Replace it with ${replacement}.`;
	}

	return `${finding} Check that it describes the image; if it does not, replace it with ${replacement}.`;
}

function toAuditNode(image: FilenameAltTextImage): AuditNode {
	const node: AuditNode = { selector: image.selector, html: image.html };

	if (image.signal) {
		node.failureSummary = failureSummary(image, image.signal);
	}

	node.evidence = evidenceCheck(
		FILENAME_ALT_TEXT_EVIDENCE_CHECK_ID,
		"serious",
		`Image with the ${SOURCE_NAMES[image.altTextSource]} "${image.altText}"`,
		{
			altText: image.altText,
			altTextSource: image.altTextSource,
			reason: image.signal ?? undefined,
			matchedSource: image.matchedSource ?? undefined,
			screenshot: image.screenshot,
		},
	);

	return node;
}

export function filenameAltTextToAxe(result: FilenameAltTextResult): AuditOutput {
	return sortedResultToAxe(METADATA, result, toAuditNode);
}
