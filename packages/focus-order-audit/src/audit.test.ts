import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import type {
	ActiveElementInfo,
	SessionEndReason,
	TabSessionHandle,
} from "@a11y-pulse/tab-orchestrator";
import { describe, expect, it, vi } from "vitest";
import { createFocusOrderAudit } from "./audit";
import { type PageContext, pageContextScript } from "./browser-scripts";

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

function fakeAdaptor(context: PageContext | Error = CONTEXT): BrowserAdaptor {
	return {
		evaluate: (async (fn: unknown) => {
			if (fn === pageContextScript) {
				if (context instanceof Error) {
					throw context;
				}

				return context;
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
