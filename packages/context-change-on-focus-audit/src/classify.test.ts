import type { ContextChangeSignals } from "@a11y-pulse/tab-orchestrator";
import { describe, expect, it } from "vitest";
import { classifyContextSignals } from "./classify";

function signals(partial: Partial<ContextChangeSignals> = {}): ContextChangeSignals {
	return {
		openedWindow: false,
		submittedForm: false,
		focusRemoved: false,
		redirect: null,
		softUrlChange: false,
		navigation: false,
		...partial,
	};
}

describe("classifyContextSignals", () => {
	it("flags new-window as a violation", () => {
		expect(classifyContextSignals(signals({ openedWindow: true }))).toEqual([
			{ kind: "new-window", bucket: "violation" },
		]);
	});

	it("flags auto-submit as a violation", () => {
		expect(classifyContextSignals(signals({ submittedForm: true }))).toEqual([
			{ kind: "auto-submit", bucket: "violation" },
		]);
	});

	it("flags focus-removed as a violation", () => {
		expect(classifyContextSignals(signals({ focusRemoved: true }))).toEqual([
			{ kind: "focus-removed", bucket: "violation" },
		]);
	});

	it("flags redirect outside the subtree as a violation", () => {
		expect(classifyContextSignals(signals({ redirect: "outside" }))).toEqual([
			{ kind: "focus-redirected-outside", bucket: "violation" },
		]);
	});

	it("flags same-subtree redirect as incomplete", () => {
		expect(classifyContextSignals(signals({ redirect: "same-subtree" }))).toEqual([
			{ kind: "focus-redirected-same-subtree", bucket: "incomplete" },
		]);
	});

	it("flags soft URL change as incomplete", () => {
		expect(classifyContextSignals(signals({ softUrlChange: true }))).toEqual([
			{ kind: "url-changed", bucket: "incomplete" },
		]);
	});

	it("flags full navigation as a violation", () => {
		expect(classifyContextSignals(signals({ navigation: true }))).toEqual([
			{ kind: "navigation", bucket: "violation" },
		]);
	});

	it("returns nothing for a clean tab stop", () => {
		expect(classifyContextSignals(signals())).toEqual([]);
	});

	it("prefers navigation over soft URL change when both are set", () => {
		expect(classifyContextSignals(signals({ navigation: true, softUrlChange: true }))).toEqual([
			{ kind: "navigation", bucket: "violation" },
		]);
	});

	it("flags a native dialog as a violation", () => {
		expect(classifyContextSignals(signals({ openedDialog: true }))).toEqual([
			{ kind: "dialog", bucket: "violation" },
		]);
	});

	it("flags a cancelled navigation like one that went ahead, with where it was going", () => {
		expect(
			classifyContextSignals(signals({ navigationPrevented: true }), {
				navigationUrl: "http://x/away",
			}),
		).toEqual([{ kind: "navigation", bucket: "violation", url: "http://x/away" }]);
	});

	it("reports nothing for a focus guard passing focus on", () => {
		expect(classifyContextSignals(signals({ focusGuard: true }))).toEqual([]);
	});

	it("reports a URL change beside a cancelled navigation, but not beside a real one", () => {
		const urlChange = { from: "http://x/", to: "http://x/#a" };

		expect(
			classifyContextSignals(signals({ navigationPrevented: true, softUrlChange: true }), {
				urlChange,
			}).map((finding) => finding.kind),
		).toEqual(["navigation", "url-changed"]);
		expect(
			classifyContextSignals(signals({ navigation: true, softUrlChange: true }), {
				urlChange,
			}).map((finding) => finding.kind),
		).toEqual(["navigation"]);
	});

	it("carries the details it is given onto the findings", () => {
		const form = { selector: "#f", html: "<form>", action: "http://x/submit" };

		expect(
			classifyContextSignals(
				signals({ openedWindow: true, submittedForm: true, softUrlChange: true }),
				{
					openedWindowUrl: "",
					submittedForm: form,
					urlChange: { from: "http://x/", to: "http://x/#a" },
				},
			),
		).toEqual([
			{ kind: "new-window", bucket: "violation", url: "" },
			{ kind: "auto-submit", bucket: "violation", form },
			{ kind: "url-changed", bucket: "incomplete", from: "http://x/", to: "http://x/#a" },
		]);
	});
});
