import { describe, expect, it } from "vitest";
import { AUDIT_IDS } from "../run-audits";
import { AUDIT_METADATA } from "./audit-metadata";

describe("AUDIT_METADATA", () => {
	it("describes every audit the runner converts, and nothing else", () => {
		const converted = AUDIT_IDS.filter((id) => id !== "axe-core");

		expect(Object.keys(AUDIT_METADATA).sort()).toEqual([...converted].sort());
	});

	it("links each audit with a docs page there, and the rest to their README", () => {
		expect(AUDIT_METADATA["skip-link-activation"]?.helpUrl).toBe(
			"https://www.a11ypulse.com/docs/skip-link-audit",
		);
		expect(AUDIT_METADATA["keyboard-trap"]?.helpUrl).toBe(
			"https://github.com/A11y-Pulse/audits/tree/main/packages/keyboard-trap-audit#readme",
		);
	});

	it("carries only what an audit says about itself whatever it finds", () => {
		expect(AUDIT_METADATA["focus-appearance"]).toStrictEqual({
			id: "focus-appearance",
			help: "Interactive elements must have a visible focus indicator",
			description:
				"Ensures that elements which receive keyboard focus show a visible focus indicator, as required by WCAG 2.4.7 Focus Visible.",
			helpUrl: "https://www.a11ypulse.com/docs/focus-appearance-audit",
		});
	});
});
