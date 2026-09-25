import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpinner } from "./spinner";

function fakeStream(isTTY: boolean) {
	const writes: string[] = [];
	const stream = {
		isTTY,
		write: (chunk: string) => writes.push(chunk),
	} as unknown as NodeJS.WriteStream;

	return { stream, writes };
}

describe("createSpinner", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("redraws the current step on one line and clears it when stopped", () => {
		const { stream, writes } = fakeStream(true);
		const spinner = createSpinner(stream);

		spinner.update("Loading page");
		vi.advanceTimersByTime(80);
		spinner.update("Running axe-core");
		spinner.stop();
		vi.advanceTimersByTime(1000);

		expect(writes).toEqual([
			"\r\x1b[2K⠋ Loading page",
			"\r\x1b[2K⠙ Loading page",
			"\r\x1b[2K⠙ Running axe-core",
			"\r\x1b[2K",
		]);
	});

	it("writes nothing when the stream is not a terminal", () => {
		const { stream, writes } = fakeStream(false);
		const spinner = createSpinner(stream);

		spinner.update("Loading page");
		vi.advanceTimersByTime(1000);
		spinner.stop();

		expect(writes).toEqual([]);
	});
});
