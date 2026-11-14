import { fakeStashAdaptor } from "@a11y-pulse/integration-harness/fake-stash-adaptor";
import { describe, expect, it } from "vitest";
import { runPasteBlockingAudit } from "./audit";
import {
	type AuthFieldInspection,
	type InspectedField,
	inspectAuthFieldsScript,
} from "./browser-scripts";

function field(overrides: Partial<InspectedField> = {}): InspectedField {
	return {
		kind: "password",
		html: '<input type="password" name="password">',
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

function fakePage(fields: InspectedField[], extra: Partial<AuthFieldInspection> = {}) {
	return fakeStashAdaptor(
		inspectAuthFieldsScript,
		{ fields, total: fields.length, ...extra },
		"field",
	);
}

describe("runPasteBlockingAudit", () => {
	it("sorts fields into failed, needs review and passed", async () => {
		const page = fakePage([
			field({ kind: "username", html: '<input type="email">' }),
			field({ blocked: ["shortcut", "paste"], inlineHandler: true, suppressed: ["request"] }),
			field({
				kind: "one-time-code",
				html: "<input>",
				boxes: 6,
				signIn: false,
				partialProbe: true,
			}),
		]);

		const result = await runPasteBlockingAudit(page.adaptor);

		expect(result.failed).toEqual([
			{
				selector: "#field-1",
				html: '<input type="password" name="password">',
				kind: "password",
				signals: ["paste-blocked"],
				blocked: ["shortcut", "paste"],
				detectedBy: "inline-handler",
				autocomplete: null,
				boxes: null,
				partialProbe: false,
				suppressed: ["request"],
			},
		]);
		expect(result.needsReview).toEqual([
			{
				selector: "#field-2",
				html: "<input>",
				kind: "one-time-code",
				signals: ["split-code-paste-unhandled"],
				blocked: [],
				detectedBy: null,
				autocomplete: null,
				boxes: 6,
				partialProbe: true,
				suppressed: [],
			},
		]);
		expect(result.passed).toMatchObject([{ selector: "#field-0", kind: "username", signals: [] }]);
		expect(result.summary).toEqual({
			checked: 3,
			failed: 1,
			needsReview: 1,
			passed: 1,
			unchecked: 0,
		});
	});

	it("traces a refusal with no onpaste attribute to an event listener", async () => {
		const page = fakePage([field({ blocked: ["paste"] })]);

		expect((await runPasteBlockingAudit(page.adaptor)).failed[0]?.detectedBy).toBe(
			"event-listener",
		);
	});

	it("does not blame an onpaste attribute that refused nothing", async () => {
		const page = fakePage([field({ inlineHandler: true, autocomplete: "off" })]);

		expect((await runPasteBlockingAudit(page.adaptor)).needsReview[0]).toMatchObject({
			signals: ["autocomplete-off"],
			detectedBy: null,
		});
	});

	it("returns nothing checked on a page with no authentication fields", async () => {
		const page = fakePage([]);

		expect(await runPasteBlockingAudit(page.adaptor)).toEqual({
			failed: [],
			needsReview: [],
			passed: [],
			summary: { checked: 0, failed: 0, needsReview: 0, passed: 0, unchecked: 0 },
		});
	});

	it("lists up to reportLimit fields per bucket and counts them all", async () => {
		const page = fakePage(
			Array.from({ length: 4 }, () => field({ blocked: ["paste"] })),
			{ total: 7 },
		);

		const result = await runPasteBlockingAudit(page.adaptor, { reportLimit: 2 });

		expect(result.failed.map(({ selector }) => selector)).toEqual(["#field-0", "#field-1"]);
		expect(result.summary).toEqual({
			checked: 4,
			failed: 4,
			needsReview: 0,
			passed: 0,
			unchecked: 3,
		});
	});

	it("passes the field limit to the page and asks it to report focus first", async () => {
		const calls: unknown[][] = [];
		const page = fakePage([]);
		const evaluate = page.adaptor.evaluate.bind(page.adaptor);
		let focusReportingBeforeInspect = false;
		let inspected = false;

		page.adaptor.evaluate = ((fn: unknown, ...args: unknown[]) => {
			if (fn === inspectAuthFieldsScript) {
				inspected = true;
				calls.push(args);
			}

			return evaluate(fn as never, ...args);
		}) as typeof page.adaptor.evaluate;
		page.adaptor.ensureFocusReporting = async () => {
			focusReportingBeforeInspect = !inspected;
		};

		await runPasteBlockingAudit(page.adaptor, { fieldLimit: 5 });

		expect(calls).toEqual([["__a11yPulsePasteBlocking", 5]]);
		expect(focusReportingBeforeInspect).toBe(true);
	});

	it("releases the stash even when resolving a selector throws", async () => {
		const page = fakePage([field({ blocked: ["paste"] })]);

		page.adaptor.evaluateHandle = async () => {
			throw new Error("detached");
		};

		await expect(runPasteBlockingAudit(page.adaptor)).rejects.toThrow("detached");
		expect(page.released()).toBe(true);
	});

	it("keeps a typed value out of the reported html", async () => {
		const page = fakePage([
			field({ html: '<input type="password" value="hunter2" onpaste="return false">' }),
		]);

		const [passed] = (await runPasteBlockingAudit(page.adaptor)).passed;

		expect(passed?.html).not.toContain("hunter2");
		expect(passed?.html).toContain("onpaste");
	});
});
