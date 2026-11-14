import { describe, expect, it } from "vitest";
import type { InspectedField } from "./browser-scripts";
import { classifyField } from "./classify";

function field(overrides: Partial<InspectedField> = {}): InspectedField {
	return {
		kind: "password",
		html: '<input type="password">',
		autocomplete: null,
		blocked: [],
		inlineHandler: false,
		handled: false,
		readonlyUntilFocus: false,
		boxes: 0,
		signIn: true,
		partialProbe: false,
		suppressed: [],
		...overrides,
	};
}

describe("classifyField", () => {
	it("passes a field nothing gets in the way of", () => {
		expect(classifyField(field())).toEqual({ signals: [], verdict: null });
		expect(classifyField(field({ autocomplete: "current-password" })).verdict).toBeNull();
		expect(classifyField(field({ handled: true })).verdict).toBeNull();
	});

	it("fails a cancelled paste event, whatever else was cancelled with it", () => {
		expect(classifyField(field({ blocked: ["paste"] }))).toEqual({
			signals: ["paste-blocked"],
			verdict: "failed",
		});
		expect(classifyField(field({ blocked: ["shortcut", "beforeinput", "paste"] })).signals).toEqual(
			["paste-blocked"],
		);
	});

	it("reviews a cancelled key press or beforeinput when the paste event itself went through", () => {
		for (const blocked of [["shortcut"], ["beforeinput"], ["shortcut", "beforeinput"]] as const) {
			expect(classifyField(field({ blocked: [...blocked] }))).toEqual({
				signals: ["paste-may-be-blocked"],
				verdict: "review",
			});
		}
	});

	it("reviews a split code that did nothing with the paste, and passes one that handled it", () => {
		const split = field({ kind: "one-time-code", boxes: 6 });

		expect(classifyField(split)).toEqual({
			signals: ["split-code-paste-unhandled"],
			verdict: "review",
		});
		expect(classifyField({ ...split, handled: true })).toEqual({ signals: [], verdict: null });
	});

	it("fails a split code that cancels the paste", () => {
		const split = field({ kind: "one-time-code", boxes: 6, blocked: ["paste"] });

		expect(classifyField(split).signals).toEqual(["paste-blocked"]);
	});

	it("only reviews a cancelled paste when the text pasted was deliberately incomplete", () => {
		const code = field({
			kind: "one-time-code",
			autocomplete: "one-time-code",
			blocked: ["paste"],
			partialProbe: true,
		});

		// The page may only have turned away a code of the wrong length.
		expect(classifyField(code)).toEqual({ signals: ["partial-paste-refused"], verdict: "review" });
		expect(classifyField({ ...code, partialProbe: false }).verdict).toBe("failed");
	});

	it("reviews a field that is read-only until focus", () => {
		expect(classifyField(field({ readonlyUntilFocus: true }))).toEqual({
			signals: ["readonly-until-focus"],
			verdict: "review",
		});
	});

	it("reviews autocomplete off on any kind of field", () => {
		for (const kind of ["password", "new-password", "username", "one-time-code"] as const) {
			expect(classifyField(field({ kind, autocomplete: "off" }))).toEqual({
				signals: ["autocomplete-off"],
				verdict: "review",
			});
		}
	});

	it("reviews new-password only on the password of a sign-in form", () => {
		const password = field({ autocomplete: "new-password" });

		expect(classifyField(password).signals).toEqual(["new-password-on-sign-in"]);
		expect(classifyField({ ...password, signIn: false }).signals).toEqual([]);
		expect(classifyField({ ...password, kind: "new-password" }).signals).toEqual([]);
	});

	it("reviews a one-time-code field with no autofill hint, but not a split one", () => {
		const code = field({ kind: "one-time-code", signIn: false });

		expect(classifyField(code).signals).toEqual(["no-autofill-hint"]);
		expect(classifyField({ ...code, autocomplete: "one-time-code" }).signals).toEqual([]);
		expect(classifyField({ ...code, boxes: 6, handled: true }).signals).toEqual([]);
	});

	it("lists every signal, most serious first, and takes the verdict from the first", () => {
		expect(
			classifyField(field({ blocked: ["paste"], readonlyUntilFocus: true, autocomplete: "off" })),
		).toEqual({
			signals: ["paste-blocked", "readonly-until-focus", "autocomplete-off"],
			verdict: "failed",
		});
		expect(
			classifyField(field({ kind: "one-time-code", blocked: ["shortcut"], signIn: false })),
		).toEqual({ signals: ["paste-may-be-blocked", "no-autofill-hint"], verdict: "review" });
	});
});
