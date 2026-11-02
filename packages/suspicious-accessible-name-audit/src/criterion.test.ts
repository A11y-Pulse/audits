import { describe, expect, it } from "vitest";
import { wcagCriterion } from "./criterion";

const TEXT_BUTTON = { role: "button", iconOnly: false, linkContext: false };

describe("wcagCriterion", () => {
	it("maps icon-only controls and iframes to 1.1.1", () => {
		expect(wcagCriterion({ ...TEXT_BUTTON, iconOnly: true }, "artefact")).toBe("1.1.1");
		expect(wcagCriterion({ ...TEXT_BUTTON, role: "link", iconOnly: true }, "artefact")).toBe(
			"1.1.1",
		);
		expect(wcagCriterion({ ...TEXT_BUTTON, role: "iframe" }, "artefact")).toBe("1.1.1");
	});

	it("maps a link to 2.4.4 only when nothing around it gives its purpose", () => {
		expect(wcagCriterion({ ...TEXT_BUTTON, role: "link" }, "identifier-pattern")).toBe("2.4.4");
		expect(
			wcagCriterion({ ...TEXT_BUTTON, role: "link", linkContext: true }, "identifier-pattern"),
		).toBe("2.4.6");
	});

	it("maps fields, text buttons and landmarks to 2.4.6", () => {
		expect(wcagCriterion(TEXT_BUTTON, "attribute-match")).toBe("2.4.6");
		expect(wcagCriterion({ ...TEXT_BUTTON, role: "spinbutton" }, "attribute-match")).toBe("2.4.6");
		expect(wcagCriterion({ ...TEXT_BUTTON, role: "navigation" }, null)).toBe("2.4.6");
	});

	it("maps a role word to best practice whatever the element", () => {
		expect(wcagCriterion({ ...TEXT_BUTTON, iconOnly: true }, "role-word")).toBeNull();
		expect(wcagCriterion({ ...TEXT_BUTTON, role: "link" }, "role-word")).toBeNull();
	});
});
