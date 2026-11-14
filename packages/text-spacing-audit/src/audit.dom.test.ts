// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { TextSpacingAuditAdaptor } from "./adaptor";
import { runTextSpacingAudit } from "./audit";

function giveLayoutRect(el: Element, width = 200, height = 20): void {
	el.getBoundingClientRect = () =>
		({
			x: 0,
			y: 0,
			width,
			height,
			top: 0,
			left: 0,
			right: width,
			bottom: height,
			toJSON() {
				return {};
			},
		}) as DOMRect;
}

/** Runs each script against the test document, recording which stylesheets were present after it. */
function executingAdaptor(): TextSpacingAuditAdaptor & { stylesAfter: Record<string, string[]> } {
	const stylesAfter: Record<string, string[]> = {};

	return {
		stylesAfter,
		evaluate: async <T>(
			fn: (...args: never[]) => T | Promise<T>,
			...args: unknown[]
		): Promise<T> => {
			const result = await (fn as (...fnArgs: unknown[]) => T | Promise<T>)(...args);

			stylesAfter[fn.name] = Array.from(document.querySelectorAll("style[data-a11y-pulse]")).map(
				(style) => style.getAttribute("data-a11y-pulse") ?? "",
			);

			return result;
		},
		screenshotClip: async () => new Uint8Array([1, 2, 3]),
	};
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("runTextSpacingAudit against a document", () => {
	it("freezes motion before measuring, applies the override, and removes both afterwards", async () => {
		document.body.innerHTML = `<p id="copy">Hello world from a spacious paragraph.</p>`;
		giveLayoutRect(document.getElementById("copy") as Element);

		const adaptor = executingAdaptor();
		const result = await runTextSpacingAudit(adaptor);

		expect(adaptor.stylesAfter).toEqual({
			collectBaselineScript: ["ts-freeze"],
			applyOverrideScript: ["ts-override", "ts-freeze"],
			restoreAndVerifyScript: [],
		});
		expect(result.candidateCount).toBe(1);
		expect(result.restored).toBe(true);
	});

	it("caps candidates at candidateLimit and reports the page as truncated", async () => {
		document.body.innerHTML = Array.from(
			{ length: 8 },
			(_, i) => `<p id="p${i}">Paragraph ${i}</p>`,
		).join("");

		for (const el of Array.from(document.querySelectorAll("p"))) {
			giveLayoutRect(el);
		}

		const result = await runTextSpacingAudit(executingAdaptor(), { candidateLimit: 3 });

		expect(result.candidateCount).toBe(3);
		expect(result.truncated).toBe(true);
	});
});
