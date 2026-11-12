import type {
	NameSignal,
	SuspiciousNameElement,
	SuspiciousNameResult,
	WcagCriterion,
} from "@a11y-pulse/suspicious-accessible-name-audit";
import type { Result } from "axe-core";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	evidenceCheck,
	toResult,
} from "./audit-output";

export const SUSPICIOUS_ACCESSIBLE_NAME_AUDIT_ID = "suspicious-accessible-name";

export const SUSPICIOUS_ACCESSIBLE_NAME_EVIDENCE_CHECK_ID = "suspicious-accessible-name-evidence";

const METADATA: Omit<AuditMetadata, "impact" | "tags"> = {
	id: SUSPICIOUS_ACCESSIBLE_NAME_AUDIT_ID,
	help: "Accessible names must not be code or placeholder text",
	description:
		"Ensures that the accessible names of controls, links, landmarks and iframes are not a code identifier, an unrendered template token or placeholder text (WCAG 1.1.1 Non-text Content for icon-only controls and iframes, 2.4.4 Link Purpose for links, 2.4.6 Headings and Labels otherwise).",
	helpUrl:
		"https://github.com/A11y-Pulse/audits/tree/main/packages/suspicious-accessible-name-audit#readme",
};

// Null is a role word, which is best practice rather than a WCAG failure. The order keeps tags
// stable whatever order the elements came in.
const CRITERION_TAGS: ReadonlyMap<WcagCriterion | null, readonly string[]> = new Map([
	["1.1.1", ["wcag2a", "wcag111"]],
	["2.4.4", ["wcag2a", "wcag244"]],
	["2.4.6", ["wcag2aa", "wcag246"]],
	[null, ["best-practice"]],
]);

const CATEGORY_TAG = "cat.name-role-value";

const REPLACEMENT = "a name that says what the element is or does";

const FINDINGS: Record<NameSignal, string> = {
	artefact: "is a leftover script value, template token or placeholder",
	"attribute-match": "is also the element's",
	"identifier-pattern": "looks like a code identifier",
	"placeholder-suffix": "looks like a numbered placeholder",
	"role-word": "ends with the role word",
};

function failureSummary(element: SuspiciousNameElement, signal: NameSignal): string {
	const name = `The accessible name "${element.name}"`;

	switch (signal) {
		case "artefact":
			return `${name} ${FINDINGS[signal]}. Replace it with ${REPLACEMENT}.`;
		case "attribute-match":
			return `${name} ${FINDINGS[signal]} \`${element.evidence}\`. Replace it with ${REPLACEMENT}.`;
		case "role-word":
			return `${name} ${FINDINGS[signal]} "${element.evidence}". Screen readers announce the element's role, so remove the word, or give the element the role it names.`;
		default:
			return `${name} ${FINDINGS[signal]}. Check that it is a name a person would use; if it is not, replace it with ${REPLACEMENT}.`;
	}
}

function toAuditNode(element: SuspiciousNameElement): AuditNode {
	const node: AuditNode = { selector: element.selector, html: element.html };

	if (element.signal) {
		node.failureSummary = failureSummary(element, element.signal);
	}

	node.evidence = evidenceCheck(
		SUSPICIOUS_ACCESSIBLE_NAME_EVIDENCE_CHECK_ID,
		element.criterion === null ? "minor" : "serious",
		`Accessible name "${element.name}", taken from ${element.nameSource}`,
		{
			name: element.name,
			nameSource: element.nameSource,
			role: element.role,
			reason: element.signal ?? undefined,
			matched: element.evidence ?? undefined,
			labelSelector: element.labelSelector ?? undefined,
			criterion: element.criterion,
		},
	);

	return node;
}

function metadataFor(criteria: ReadonlySet<WcagCriterion | null>): AuditMetadata {
	const tags = [...CRITERION_TAGS].flatMap(([criterion, criterionTags]) =>
		criteria.has(criterion) ? criterionTags : [],
	);

	return {
		...METADATA,
		// Role words alone are minor, matching axe-core's `image-redundant-alt`.
		impact: criteria.size === 1 && criteria.has(null) ? "minor" : "serious",
		tags: [...new Set(tags), CATEGORY_TAG],
	};
}

function toBucket(elements: readonly SuspiciousNameElement[]): Result[] {
	if (elements.length === 0) {
		return [];
	}

	const criteria = new Set(elements.map(({ criterion }) => criterion));

	return [toResult(metadataFor(criteria), elements.map(toAuditNode))];
}

/**
 * Convert the audit into axe-core's buckets. Each bucket is tagged with every criterion its listed
 * elements fall under, since axe-core tags a result rather than a node.
 */
export function suspiciousAccessibleNameToAxe(result: SuspiciousNameResult): AuditOutput {
	if (result.summary.checked === 0) {
		const everyCriterion = new Set(CRITERION_TAGS.keys());

		return { ...emptyOutput(), inapplicable: [toResult(metadataFor(everyCriterion), [])] };
	}

	return {
		...emptyOutput(),
		violations: toBucket(result.failed),
		incomplete: toBucket(result.needsReview),
		passes: toBucket(result.passed),
	};
}
