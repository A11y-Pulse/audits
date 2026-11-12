import type { CheckResult, NodeResult, Result } from "axe-core";

/**
 * The four result buckets axe-core reports, and the shape every A11y Pulse audit is converted
 * into.
 */
export type AuditOutput = {
	violations: Result[];
	incomplete: Result[];
	passes: Result[];
	inapplicable: Result[];
};

/** Everything about a converted audit except its nodes. */
export type AuditMetadata = Pick<
	Result,
	"id" | "help" | "description" | "helpUrl" | "impact" | "tags"
>;

/**
 * Audit-specific evidence, attached to a node as a single axe-core check. PNG bytes stay raw here;
 * `toJson` encodes them as base64.
 */
export type AuditEvidence = Pick<CheckResult, "id" | "impact" | "message" | "data">;

export type AuditNode = {
	selector: string;
	html: string;
	/** Only set on a failing node, matching axe-core, which omits it on passes. */
	failureSummary?: string;
	evidence?: AuditEvidence;
};

/** Tags an `incomplete` entry for an audit that ran but could not reach a conclusion. */
export const AUDIT_INCONCLUSIVE_TAG = "a11y-pulse.audit-inconclusive";

/**
 * Build a node's evidence check. `data` carries the audit's structured measurements under the
 * field names the audit itself uses; fields the audit left undefined are dropped.
 */
export function evidenceCheck(
	id: string,
	impact: AuditEvidence["impact"],
	message: string,
	data: Record<string, unknown>,
): AuditEvidence {
	const defined = Object.fromEntries(
		Object.entries(data).filter(([, value]) => value !== undefined),
	);

	return { id, impact, message, data: defined };
}

/**
 * Report an audit that ran but could not reach a conclusion as `incomplete`, with the reason in
 * its description, so it is never mistaken for one that ran and found nothing.
 */
export function inconclusiveOutput(metadata: AuditMetadata, reason: string): AuditOutput {
	const result: Result = {
		...metadata,
		description: `${metadata.description} This audit could not reach a conclusion on this page: ${reason}`,
		tags: [...metadata.tags, AUDIT_INCONCLUSIVE_TAG],
		nodes: [],
	};

	return { ...emptyOutput(), incomplete: [result] };
}

export function emptyOutput(): AuditOutput {
	return { violations: [], incomplete: [], passes: [], inapplicable: [] };
}

export function toNode(node: AuditNode): NodeResult {
	const result: NodeResult = {
		target: [node.selector],
		html: node.html,
		any: node.evidence ? [node.evidence] : [],
		all: [],
		none: [],
	};

	if (node.failureSummary !== undefined) {
		result.failureSummary = node.failureSummary;
	}

	return result;
}

export function toResult(metadata: AuditMetadata, nodes: readonly AuditNode[]): Result {
	return { ...metadata, nodes: nodes.map(toNode) };
}

/** An audit result whose items the audit has already sorted into buckets. */
export type SortedResult<T> = {
	failed: readonly T[];
	needsReview: readonly T[];
	passed: readonly T[];
	summary: { checked: number };
};

/**
 * Convert a sorted result into axe-core's buckets: `failed` to violations, `needsReview` to
 * incomplete and `passed` to passes, or inapplicable when nothing was checked.
 */
export function sortedResultToAxe<T>(
	metadata: AuditMetadata,
	result: SortedResult<T>,
	toAuditNode: (item: T) => AuditNode,
): AuditOutput {
	if (result.summary.checked === 0) {
		return { ...emptyOutput(), inapplicable: [toResult(metadata, [])] };
	}

	const bucket = (items: readonly T[]): Result[] =>
		items.length > 0 ? [toResult(metadata, items.map(toAuditNode))] : [];

	return {
		...emptyOutput(),
		violations: bucket(result.failed),
		incomplete: bucket(result.needsReview),
		passes: bucket(result.passed),
	};
}

/**
 * Concatenate every audit's buckets into one axe-core result set, preserving the order the audits
 * were run in.
 */
export function mergeOutputs(outputs: readonly AuditOutput[]): AuditOutput {
	return {
		violations: outputs.flatMap((output) => output.violations),
		incomplete: outputs.flatMap((output) => output.incomplete),
		passes: outputs.flatMap((output) => output.passes),
		inapplicable: outputs.flatMap((output) => output.inapplicable),
	};
}
