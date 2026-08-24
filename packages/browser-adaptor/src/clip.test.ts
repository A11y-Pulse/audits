import { describe, expect, it } from "vitest";
import { bufferedClip } from "./clip";

describe("bufferedClip", () => {
	it("pads the rect by the buffer on every side", () => {
		const rect = { x: 100, y: 100, width: 40, height: 20 };
		const clip = bufferedClip(rect, 800, 600, 10);
		expect(clip).toEqual({ x: 90, y: 90, width: 60, height: 40 });
	});

	it("shrinks the padding at the page edges", () => {
		const rect = { x: 4, y: 100, width: 40, height: 495 };
		const clip = bufferedClip(rect, 800, 600, 10);
		expect(clip.x).toBe(0);
		expect(clip.width).toBe(40 + 4 + 10);
		expect(clip.y).toBe(90);
		expect(clip.height).toBe(495 + 10 + 5);
	});

	it("clamps to zero when the element is off the top-left of the document", () => {
		const rect = { x: -30, y: -12, width: 40, height: 20 };
		const clip = bufferedClip(rect, 800, 600, 10);
		expect(clip.x).toBe(0);
		expect(clip.y).toBe(0);
	});
});
