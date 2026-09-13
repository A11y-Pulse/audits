import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { runAxeCore } from "./axe-core";

function fakeAdaptor(results: unknown) {
	const evaluate = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(results);

	return { evaluate } as unknown as BrowserAdaptor & { evaluate: typeof evaluate };
}

describe("runAxeCore", () => {
	it("injects axe-core's source before running it", async () => {
		const adaptor = fakeAdaptor({ violations: [] });

		await runAxeCore(adaptor);

		expect(adaptor.evaluate.mock.calls[0]?.[1]).toBe(axe.source);
		expect(adaptor.evaluate).toHaveBeenCalledTimes(2);
	});

	it("passes the run options through to axe.run", async () => {
		const adaptor = fakeAdaptor({ violations: [] });
		const options = { runOnly: ["wcag2a"] };

		await runAxeCore(adaptor, options);

		expect(adaptor.evaluate.mock.calls[1]?.[1]).toBe(options);
	});
});
