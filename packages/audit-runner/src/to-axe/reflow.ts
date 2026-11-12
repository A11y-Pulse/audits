import type { ReflowOffender, ReflowResult } from "@a11y-pulse/reflow-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	evidenceCheck,
	toResult,
} from "./audit-output";

export const REFLOW_AUDIT_ID = "reflow";

export const REFLOW_EVIDENCE_CHECK_ID = "reflow-evidence";

const METADATA: AuditMetadata = {
	id: REFLOW_AUDIT_ID,
	help: "Content must reflow without two-dimensional scrolling",
	description:
		"Ensures that content can be presented at a width equivalent to 320 CSS pixels without requiring two-dimensional scrolling, as required by WCAG 1.4.10 Reflow.",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/reflow-audit#readme",
	impact: "serious",
	tags: ["wcag21aa", "wcag1410", "cat.structure"],
};

function failureSummary(offender: ReflowOffender): string {
	switch (offender.reason) {
		case "fixed-width-container":
			return "Element has a fixed width that exceeds the 320px reflow viewport. Use fluid widths or max-width so content fits without requiring horizontal scrolling.";
		case "text-overflow":
			return `Text in this element runs ${offender.overflowPx}px past the viewport without wrapping. Allow it to wrap (for example with overflow-wrap) or give it its own scrolling container, so that users do not have to scroll horizontally to read it.`;
		case "media-overflow":
			return `Media is ${offender.overflowPx}px wider than the 320px reflow viewport. Check whether it needs two-dimensional layout to be understood; if not, let it scale down (for example with max-width: 100%).`;
		case "clipped-content":
			return `Element extends ${offender.overflowPx}px past the viewport where it cannot be scrolled into view. Check that no content or functionality is cut off at 320px.`;
		case "scrolling-container": {
			const overflowing = offender.overflowing ?? [];
			const culprits =
				overflowing.length > 0
					? ` Too wide inside it: ${overflowing
							.map((content) => `${content.selector} (by ${content.overflowPx}px)`)
							.join(", ")}.`
					: "";

			return `Most of the page sits in a container that scrolls horizontally by ${offender.overflowPx}px.${culprits} Check that its content can be read at 320px without scrolling in two directions.`;
		}
		default:
			return `Element is overflowing the viewport by ${offender.overflowPx}px. Ensure elements are resized and text is wrapped so that users do not have to scroll horizontally to view content.`;
	}
}

function toAuditNode(offender: ReflowOffender, result: ReflowResult): AuditNode {
	const failed = result.bucket !== "pass";
	const node: AuditNode = { selector: offender.selector, html: offender.html };

	if (failed) {
		node.failureSummary = failureSummary(offender);
	}

	node.evidence = evidenceCheck(
		REFLOW_EVIDENCE_CHECK_ID,
		"serious",
		failed
			? `Element overflows the ${result.viewport.width}px reflow viewport`
			: `Element measured at the ${result.viewport.width}px reflow viewport`,
		{
			reason: offender.reason,
			overflowPx: offender.overflowPx,
			rect: offender.rect,
			overflowing: offender.overflowing,
			viewport: result.viewport,
			documentOverflowPx: result.documentOverflowPx,
			screenshot: offender.screenshot,
		},
	);

	return node;
}

export function reflowToAxe(result: ReflowResult): AuditOutput {
	const audit = toResult(
		METADATA,
		result.offenders.map((offender) => toAuditNode(offender, result)),
	);

	switch (result.bucket) {
		case "violation":
			return { ...emptyOutput(), violations: [audit] };
		case "incomplete":
			return { ...emptyOutput(), incomplete: [audit] };
		case "pass":
			return { ...emptyOutput(), passes: [audit] };
	}
}
