import { styleText } from "node:util";
import type { AxeResults, ImpactValue, NodeResult, Result } from "axe-core";

type Style = Parameters<typeof styleText>[0];

const MAX_TARGETS_SHOWN = 5;

const MAX_HTML_LENGTH = 100;

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

function formatHtml(html: string): string {
	const collapsed = html.replace(/\s+/g, " ").trim();

	return collapsed.length > MAX_HTML_LENGTH
		? `${collapsed.slice(0, MAX_HTML_LENGTH - 1)}…`
		: collapsed;
}

function pluralise(count: number, singular: string): string {
	return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Render the failed audits in `results` as human-readable text.
 */
export function formatSimple(results: AxeResults, color: boolean): string {
	// `validateStream: false` so colour follows `color` alone, not whatever stdout happens to be.
	const paint = (style: Style, text: string) =>
		color ? styleText(style, text, { validateStream: false }) : text;
	const label = (text: string) => paint("dim", text.padEnd(NODE_LABEL_WIDTH));

	const { violations, url } = results;

	if (violations.length === 0) {
		return paint("green", `✔ No failed audits on ${url}`);
	}

	const header = paint(
		["bold", "red"],
		`✖ ${pluralise(violations.length, "failed audit")} on ${url}`,
	);

	const sections = violations.map((violation: Result) => {
		const impact = violation.impact ?? "minor";
		const hidden = violation.nodes.length - MAX_TARGETS_SHOWN;

		const lines = [
			`${paint("bold", violation.id)} · ${paint(IMPACT_STYLES[impact], impact)}`,
			`  ${violation.help}`,
			...violation.nodes.slice(0, MAX_TARGETS_SHOWN).flatMap((node) => {
				const html = formatHtml(node.html);
				const target = `  › ${label("selector")}  ${paint("cyan", formatTarget(node))}`;

				return html ? [target, `    ${label("html")}  ${html}`] : [target];
			}),
		];

		if (hidden > 0) {
			lines.push(paint("dim", `    … and ${hidden} more`));
		}

		if (violation.helpUrl) {
			lines.push(`  ${paint("dim", violation.helpUrl)}`);
		}

		return lines.join("\n");
	});

	return [header, ...sections].join("\n\n");
}
