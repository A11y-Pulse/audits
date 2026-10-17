import type { EngineName } from "@a11y-pulse/integration-harness";
import axe, { type NodeResult, type Result } from "axe-core";
import * as runner from "../../src/index";
import type { AuditRunnerResult } from "../../src/run-audits";

/** Every audit the runner reports beside axe-core, from the id constants it exports. */
export const RUNNER_AUDIT_IDS: ReadonlySet<string> = new Set(
	Object.entries(runner)
		.filter(([name]) => name.endsWith("_AUDIT_ID"))
		.map(([, id]) => id as string),
);

// Rules axe-core knows. Experimental ones never run in the runner's unconfigured `axe.run()`; a few
// others are off by default too, which `assertExpectation` catches by requiring the rule to report.
export const AXE_RULE_IDS: ReadonlySet<string> = new Set(
	axe
		.getRules()
		.filter((rule) => !rule.tags.includes("experimental"))
		.map((rule) => rule.ruleId),
);

type Bucket = "violations" | "incomplete" | "passes" | "inapplicable";

/**
 * Where an audit should place a node. `clean` asserts the node is in neither `violations` nor
 * `incomplete`, for planted false-positive guards an audit may pass or simply not report.
 */
export type Outcome = Bucket | "clean";

export type Expectation = {
	/** What is planted on the page, in a few words. Becomes the test name. */
	scenario: string;
	/** The result id: an A11y Pulse audit id or an axe-core rule id. */
	audit: string;
	outcome: Outcome;
	/**
	 * The node's axe-core target: a selector, or a frame path for content inside an iframe. Without
	 * one the outcome applies to the audit as a whole.
	 */
	target?: string | readonly string[];
	/** Page variants this applies to. Every variant in the group when omitted. */
	variants?: readonly string[];
	/** Viewport names this applies to. Every viewport the group runs at when omitted. */
	viewports?: readonly string[];
	/** Engines this applies to, for behaviour that differs between browsers. Every engine when omitted. */
	engines?: readonly EngineName[];
	/**
	 * Why this cannot run yet although the audit that reports it exists: a capability the runner
	 * lacks. Registers the expectation as a todo.
	 */
	todo?: string;
};

export type Viewport = {
	name: string;
	width: number;
	height: number;
};

export const DESKTOP: Viewport = { name: "desktop", width: 1280, height: 800 };

export const MOBILE: Viewport = { name: "mobile", width: 390, height: 844 };

export type PageGroup = {
	name: string;
	variants: readonly string[];
	/** Every variant runs once per viewport. Desktop only when omitted. */
	viewports?: readonly Viewport[];
	expectations: readonly Expectation[];
};

const BUCKETS: readonly Bucket[] = ["violations", "incomplete", "passes", "inapplicable"];

/**
 * Why an expectation cannot run against the runner today, or `undefined` when it can.
 */
export function pendingReason(expectation: Expectation): string | undefined {
	if (expectation.todo) {
		return expectation.todo;
	}

	const reported = RUNNER_AUDIT_IDS.has(expectation.audit) || AXE_RULE_IDS.has(expectation.audit);

	return reported ? undefined : `${expectation.audit} is not implemented`;
}

// axe-core reports a main-frame node as a one-selector path, so a bare selector names the same node.
function targetKey(target: string | readonly string[] | NodeResult["target"]): string {
	const path = typeof target === "string" ? [target] : target;

	return path.length === 1 ? String(path[0]) : JSON.stringify(path);
}

/**
 * Every bucket holding a result for `audit`, narrowed to the ones containing `target` when given.
 */
export function bucketsFor(
	result: AuditRunnerResult,
	audit: string,
	target?: string | readonly string[],
): Bucket[] {
	const wanted = target === undefined ? undefined : targetKey(target);

	return BUCKETS.filter((bucket) =>
		result[bucket].some(
			(entry: Result) =>
				entry.id === audit &&
				(wanted === undefined || entry.nodes.some((node) => targetKey(node.target) === wanted)),
		),
	);
}

/**
 * Each bucket's node targets for `audit`, for failure messages that show where nodes did land.
 */
export function describeAudit(result: AuditRunnerResult, audit: string): string {
	const lines = BUCKETS.map((bucket) => {
		const targets = result[bucket]
			.filter((entry: Result) => entry.id === audit)
			.flatMap((entry) => entry.nodes.map((node) => targetKey(node.target)));
		const reported = result[bucket].some((entry: Result) => entry.id === audit);

		return `  ${bucket}: ${reported ? targets.join(", ") || "(no nodes)" : "-"}`;
	});

	return `${audit} reported:\n${lines.join("\n")}`;
}
