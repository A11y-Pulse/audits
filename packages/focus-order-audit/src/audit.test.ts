import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import type {
	ActiveElementInfo,
	SessionEndReason,
	TabSessionHandle,
} from "@a11y-pulse/tab-orchestrator";
import { describe, expect, it, vi } from "vitest";
import { createFocusOrderAudit } from "./audit";
import { type PageContext, pageContextScript, tabindexValuesScript } from "./browser-scripts";

const PAGE_URL = "https://example.test/";

const CONTEXT: PageContext = {
	viewportWidth: 1000,
	viewportHeight: 800,
	layoutWidth: 1000,
	layoutHeight: 6000,
	direction: "ltr",
	writingMode: "horizontal-tb",
	positiveTabindex: false,
	href: PAGE_URL,
};

const session: TabSessionHandle = {
	disconnect: vi.fn(),
	ensureUnfocusedPair: vi.fn(),
	screenshotClip: vi.fn(),
};

function stop(index: number, y: number, extra: Partial<ActiveElementInfo> = {}): ActiveElementInfo {
	return {
		index,
		isBody: false,
		isIframe: false,
		selector: `#s${index}`,
		html: `<a id="s${index}">`,
		styles: { element: {}, before: {}, after: {} },
		rect: { x: 0, y, width: 100, height: 20 },
		...extra,
	};
}

function fakeAdaptor(
	context: PageContext | Error = CONTEXT,
	tabindexValues: Array<number | null> | Error = new Error("no longer readable"),
): BrowserAdaptor {
	return {
		evaluate: (async (fn: unknown) => {
			if (fn === pageContextScript) {
				if (context instanceof Error) {
					throw context;
				}

				return context;
			}

			if (fn === tabindexValuesScript) {
				if (tabindexValues instanceof Error) {
					throw tabindexValues;
				}

				return tabindexValues;
			}

			return undefined;
		}) as BrowserAdaptor["evaluate"],
		evaluateHandle: async () => ({}),
		disposeRef: async () => {},
		pressTab: async () => {},
		pressEnter: async () => {},
		pressKey: async () => {},
		screenshotClip: async () => new Uint8Array(),
		ensureFocusReporting: async () => {},
	};
}

function runSession(stops: ActiveElementInfo[], reason: SessionEndReason = "completed") {
	const audit = createFocusOrderAudit();
	audit.onSessionStart?.(session);

	stops.forEach((activeElement, i) => {
		audit.onTabStop({ tabIndex: i + 1, activeElement }, session);
	});

	audit.onSessionEnd?.(reason, { revisitedIndex: null });

	return audit;
}

const SCRAMBLED = [stop(0, 3000), stop(1, 2000), stop(2, 1000), stop(3, 0)];

describe("createFocusOrderAudit", () => {
	it("reports a sequence that climbs back up the page three times", async () => {
		const result = await runSession(SCRAMBLED).analyse(fakeAdaptor(), PAGE_URL);

		expect(result.outcome).toBe("disordered");
		expect(result.transitions).toHaveLength(3);
		expect(result.transitions[0]).toEqual({
			kind: "backwards-jump",
			from: {
				selector: "#s0",
				html: '<a id="s0">',
				tabIndex: 1,
				rect: { x: 0, y: 3000, width: 100, height: 20 },
			},
			to: {
				selector: "#s1",
				html: '<a id="s1">',
				tabIndex: 2,
				rect: { x: 0, y: 2000, width: 100, height: 20 },
			},
			distance: { block: -1000, inline: 0 },
			direction: "up",
			steps: 1,
		});
	});

	it("reports one jump when the page says an element on it has a positive tabindex", async () => {
		const stops = [stop(0, 3000), stop(1, 3050), stop(2, 0), stop(3, 1500)];
		const audit = runSession(stops);
		const result = await audit.analyse(fakeAdaptor(CONTEXT, [0, 2, 0, 0]), PAGE_URL);

		expect(result.outcome).toBe("disordered");
		expect(result.positiveTabindex).toBe(true);
		expect(result.transitions).toHaveLength(1);
		expect(result.transitions[0]?.from).toMatchObject({ selector: "#s1", positiveTabindex: 2 });
		expect(result.transitions[0]?.to).not.toHaveProperty("positiveTabindex");

		const without = await runSession(stops).analyse(fakeAdaptor(CONTEXT, [0, 0, 0, 0]), PAGE_URL);

		expect(without.outcome).toBe("unremarkable");
	});

	it("reads a positive tabindex from the recorded HTML when the element has gone", async () => {
		const stops = [
			stop(0, 3000),
			stop(1, 3050, { html: '<input id="s1" data-tabindex="9" tabindex="2">' }),
			stop(2, 0, { html: '<a id="s2" tabindex="-1">' }),
			stop(3, 1500),
		];
		const result = await runSession(stops).analyse(
			fakeAdaptor(CONTEXT, [null, null, null, null]),
			PAGE_URL,
		);

		expect(result.outcome).toBe("disordered");
		expect(result.transitions[0]?.from.positiveTabindex).toBe(2);
		expect(result.transitions[0]?.to).not.toHaveProperty("positiveTabindex");
	});

	it("leaves out elements the probe saw on a fixed, sticky or dialog ancestor", async () => {
		const stops = [
			stop(0, 3000),
			stop(1, 0, { pinned: true }),
			stop(2, 3100),
			stop(3, 0, { inDialog: true }),
			stop(4, 3200),
			stop(5, 0, { pinned: true }),
			stop(6, 3300),
		];
		const result = await runSession(stops).analyse(fakeAdaptor(), PAGE_URL);

		expect(result.outcome).toBe("unremarkable");
	});

	it("is inconclusive when the session ended on a navigation", async () => {
		const result = await runSession(SCRAMBLED, "navigation").analyse(fakeAdaptor(), PAGE_URL);

		expect(result.outcome).toBe("inconclusive");
	});

	it("is inconclusive when the page is no longer the one the session started on", async () => {
		const elsewhere = { ...CONTEXT, href: "https://example.test/elsewhere" };
		const result = await runSession(SCRAMBLED).analyse(fakeAdaptor(elsewhere), PAGE_URL);

		expect(result.outcome).toBe("inconclusive");
	});

	it("is inconclusive when the page cannot be read", async () => {
		const result = await runSession(SCRAMBLED).analyse(
			fakeAdaptor(new Error("Execution context was destroyed")),
			PAGE_URL,
		);

		expect(result.outcome).toBe("inconclusive");
	});

	it("reports nothing focusable without reading the page", async () => {
		const result = await runSession([]).analyse(fakeAdaptor(new Error("not called")), PAGE_URL);

		expect(result.outcome).toBe("no-focusable");
	});
});
