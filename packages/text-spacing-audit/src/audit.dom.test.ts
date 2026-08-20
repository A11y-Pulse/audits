// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { TextSpacingAuditAdaptor } from "./adaptor";
import { runTextSpacingAudit } from "./audit";
import { removeInjectedStyles } from "./browser-scripts";

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

function executingAdaptor(): TextSpacingAuditAdaptor & {
	sawFreeze: boolean;
	sawOverride: boolean;
} {
	const record = { sawFreeze: false, sawOverride: false };

	return {
		get sawFreeze() {
			return record.sawFreeze;
		},
		get sawOverride() {
			return record.sawOverride;
		},
		evaluate: async <T>(
			fn: (...args: never[]) => T | Promise<T>,
			...args: unknown[]
		): Promise<T> => {
			const result = await (fn as (...fnArgs: unknown[]) => T | Promise<T>)(
				...args,
			);

			if (document.querySelector('[data-a11y-pulse="ts-freeze"]')) {
				record.sawFreeze = true;
			}

			if (document.querySelector('[data-a11y-pulse="ts-override"]')) {
				record.sawOverride = true;
			}

			return result;
		},
	};
}

afterEach(() => {
	document.body.innerHTML = "";
	removeInjectedStyles();
});

describe("runTextSpacingAudit freeze and restore via adaptor", () => {
	it("injects the freeze stylesheet before measuring and removes injected styles after", async () => {
		document.body.innerHTML = `<p id="copy">Hello world from a spacious paragraph.</p>`;
		giveLayoutRect(document.getElementById("copy") as Element);

		const adaptor = executingAdaptor();
		const result = await runTextSpacingAudit(adaptor, { settleMs: 0 });

		expect(adaptor.sawFreeze).toBe(true);
		expect(document.querySelectorAll("[data-a11y-pulse]")).toHaveLength(0);
		expect(result.restored).toBe(true);
	});

	it("caps candidates at candidateLimit", async () => {
		document.body.innerHTML = Array.from(
			{ length: 8 },
			(_, i) => `<p id="p${i}">Paragraph ${i}</p>`,
		).join("");

		for (const el of Array.from(document.querySelectorAll("p"))) {
			giveLayoutRect(el);
		}

		const result = await runTextSpacingAudit(executingAdaptor(), {
			candidateLimit: 3,
			settleMs: 0,
		});

		expect(result.candidateCount).toBe(3);
	});
});
