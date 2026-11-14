import { describe, expect, it } from "vitest";
import { type CdpSession, inspectStashedElements } from "./cdp";

type Call = { method: string; params: Record<string, unknown> };

/** A DevTools session over a stash of elements described by their listeners and role. */
function fakeSession(
	elements: Array<{ listeners?: string[]; role?: string; ignored?: boolean; fails?: boolean }>,
	calls: Call[] = [],
): CdpSession {
	return {
		async send(method: string, params: Record<string, unknown> = {}) {
			calls.push({ method, params });

			const element = elements[Number(String(params.objectId).replace("element-", ""))];

			switch (method) {
				case "Runtime.evaluate":
					return { result: { objectId: "stash" } };
				case "Runtime.getProperties":
					return {
						result: [
							...elements.map((_, index) => ({
								name: String(index),
								value: { objectId: `element-${index}` },
							})),
							{ name: "length", value: {} },
						],
					};
				case "DOMDebugger.getEventListeners":
					if (element?.fails) {
						throw new Error("node is gone");
					}

					return { listeners: (element?.listeners ?? []).map((type) => ({ type })) };
				case "Accessibility.getPartialAXTree":
					return {
						nodes: [{ ignored: element?.ignored ?? false, role: { value: element?.role } }],
					};
				default:
					return {};
			}
		},
		async detach() {},
	};
}

describe("inspectStashedElements", () => {
	it("returns each element's listener types once, in stash order", async () => {
		const inspections = await inspectStashedElements(
			fakeSession([{ listeners: ["click", "click", "keydown"] }, {}, { listeners: ["mousedown"] }]),
			"__stash",
			3,
			[],
		);

		expect(inspections).toEqual([
			{ listeners: ["click", "keydown"], role: null },
			{ listeners: [], role: null },
			{ listeners: ["mousedown"], role: null },
		]);
	});

	it("reads the stash by its key", async () => {
		const calls: Call[] = [];

		await inspectStashedElements(fakeSession([{}], calls), '__sta"sh', 1, []);

		expect(calls[0]).toMatchObject({
			method: "Runtime.evaluate",
			params: { expression: 'window["__sta\\"sh"]' },
		});
	});

	it("asks for the role of the listed elements only", async () => {
		const calls: Call[] = [];
		const inspections = await inspectStashedElements(
			fakeSession(
				[{ role: "generic" }, { role: "button" }, { role: "generic", ignored: true }],
				calls,
			),
			"__stash",
			3,
			[1, 2],
		);

		expect(inspections.map((inspection) => inspection.role)).toEqual([null, "button", "none"]);
		expect(calls.filter((call) => call.method === "Accessibility.getPartialAXTree")).toHaveLength(
			2,
		);
	});

	it("leaves an element the browser cannot answer for with nothing", async () => {
		const inspections = await inspectStashedElements(
			fakeSession([{ fails: true }, { listeners: ["click"] }]),
			"__stash",
			2,
			[],
		);

		expect(inspections).toEqual([
			{ listeners: [], role: null },
			{ listeners: ["click"], role: null },
		]);
	});

	it("releases what it took hold of, even when the stash is missing", async () => {
		const calls: Call[] = [];
		const session = fakeSession([], calls);
		const send = session.send.bind(session);

		session.send = async (method: string, params?: Record<string, unknown>) =>
			method === "Runtime.evaluate" ? { result: {} } : send(method, params);

		expect(await inspectStashedElements(session, "__stash", 2, [])).toEqual([
			{ listeners: [], role: null },
			{ listeners: [], role: null },
		]);
		expect(calls.at(-1)?.method).toBe("Runtime.releaseObjectGroup");
	});
});
