import type {
	AltTextSignal,
	FilenameAltTextImage,
	FilenameAltTextResult,
} from "@a11y-pulse/filename-alt-text-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	sortedResultToAxe,
} from "./audit-output";

export const FILENAME_ALT_TEXT_AUDIT_ID = "filename-alt-text";

const METADATA: AuditMetadata = {
	id: FILENAME_ALT_TEXT_AUDIT_ID,
	help: "Alt text must not be a filename or placeholder text",
	description:
		"Ensures that image alt text is not the image's filename, a camera file name or placeholder text, which are not text alternatives (WCAG 1.1.1 Non-text Content, failure F30).",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/filename-alt-text-audit#readme",
	impact: "serious",
	tags: ["wcag2a", "wcag111", "cat.text-alternatives"],
};

const REPLACEMENT = 'a description of what the image shows, or alt="" if the image is decorative';

const FINDINGS: Record<AltTextSignal, string> = {
	"filename-match": "is the image's filename",
	"filename-near-match": "matches the image's filename",
	"camera-name": "looks like a camera or screenshot file name",
	"filename-like": "looks like a filename",
	placeholder: "looks like placeholder text",
};

function failureSummary(image: FilenameAltTextImage, signal: AltTextSignal): string {
	const finding = `The alt text "${image.altText}" ${FINDINGS[signal]}.`;

	if (signal === "filename-match") {
		return `${finding} Replace it with ${REPLACEMENT}.`;
	}

	return `${finding} Check that it describes the image; if it does not, replace it with ${REPLACEMENT}.`;
}

function toAuditNode(image: FilenameAltTextImage): AuditNode {
	const node: AuditNode = { selector: image.selector, html: image.html };

	if (image.signal) {
		node.failureSummary = failureSummary(image, image.signal);
	}

	return node;
}

export function filenameAltTextToAxe(result: FilenameAltTextResult): AuditOutput {
	return sortedResultToAxe(METADATA, result, toAuditNode);
}
