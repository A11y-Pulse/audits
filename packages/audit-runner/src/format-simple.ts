import { styleText } from "node:util";
import type { AxeResults, ImpactValue, NodeResult, Result } from "axe-core";

type Style = Parameters<typeof styleText>[0];

const MAX_TARGETS_SHOWN = 5;

// Review entries are prompts for a person, and axe-core alone can list dozens of nodes under one.
const MAX_REVIEW_TARGETS_SHOWN = 3;

const MAX_HTML_LENGTH = 100;

const MAX_SUMMARY_LENGTH = 300;

const NODE_LABEL_WIDTH = "selector".length;

const IMPACT_STYLES: Record<NonNullable<ImpactValue>, Style> = {
	critical: ["bold", "red"],
	serious: "red",
	moderate: "yellow",
	minor: "dim",
};

function formatTarget(node: NodeResult): string {
	// Selectors inside iframes and shadow roots are nested arrays, outermost first.
	return node.target.flat().join(" ▸ ");
}

function truncate(text: string, length: number): string {
	const collapsed = text.replace(/\s+/g, " ").trim();

	return collapsed.length > length ? `${collapsed.slice(0, length - 1)}…` : collapsed;
}

/**
 * The first line of a node's failure summary. axe-core opens its own with a heading such as "Fix
 * any of the following:", which says nothing alone, so the line after it is joined on.
 */
function summaryLine(node: NodeResult): string {
	const lines = (node.failureSummary ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	const [first, second] = lines;

	if (first === undefined) {
		return "";
	}

	return truncate(
		first.endsWith(":") && second !== undefined ? `${first} ${second}` : first,
		MAX_SUMMARY_LENGTH,
	);
}

function pluralise(count: number, singular: string): string {
	return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Render the failed audits in `results`, then the ones that need a person to review them, as
 * human-readable text. Audits that could not run or could not reach a conclusion are listed with
 * the ones needing review, so an unchecked page never reads as a clean one.
 */
export function formatSimple(results: AxeResults, color: boolean): string {
	// `validateStream: false` so colour follows `color` alone, not whatever stdout happens to be.
	const paint = (style: Style, text: string) =>
		color ? styleText(style, text, { validateStream: false }) : text;
	const label = (text: string) => paint("dim", text.padEnd(NODE_LABEL_WIDTH));

	const { violations, url } = results;
	const incomplete = results.incomplete ?? [];

	const section = (result: Result, targetsShown: number): string => {
		const hidden = result.nodes.length - targetsShown;
		const title = result.impact
			? `${paint("bold", result.id)} · ${paint(IMPACT_STYLES[result.impact], result.impact)}`
			: paint("bold", result.id);

		const lines = [
			title,
			`  ${result.help}`,
			...result.nodes.slice(0, targetsShown).flatMap((node) => {
				const html = truncate(node.html, MAX_HTML_LENGTH);
				const summary = summaryLine(node);
				const nodeLines = [`  › ${label("selector")}  ${paint("cyan", formatTarget(node))}`];

				if (html) {
					nodeLines.push(`    ${label("html")}  ${html}`);
				}

				if (summary) {
					nodeLines.push(`    ${label("why")}  ${summary}`);
				}

				return nodeLines;
			}),
		];

		// An entry with no elements is about the page or the audit itself: one that could not run, or
		// could not reach a conclusion. Its description says why.
		if (result.nodes.length === 0 && result.description) {
			lines.push(`    ${label("why")}  ${truncate(result.description, MAX_SUMMARY_LENGTH)}`);
		}

		if (hidden > 0) {
			lines.push(paint("dim", `    … and ${hidden} more`));
		}

		if (result.helpUrl) {
			lines.push(`  ${paint("dim", result.helpUrl)}`);
		}

		return lines.join("\n");
	};

	const failed =
		violations.length === 0
			? paint("green", `✔ No failed audits on ${url}`)
			: paint(["bold", "red"], `✖ ${pluralise(violations.length, "failed audit")} on ${url}`);

	const blocks = [failed, ...violations.map((result) => section(result, MAX_TARGETS_SHOWN))];

	if (incomplete.length > 0) {
		blocks.push(
			paint(
				["bold", "yellow"],
				`⚠ ${pluralise(incomplete.length, "audit")} ${incomplete.length === 1 ? "needs" : "need"} review`,
			),
			...incomplete.map((result) => section(result, MAX_REVIEW_TARGETS_SHOWN)),
		);
	}

	return blocks.join("\n\n");
}
