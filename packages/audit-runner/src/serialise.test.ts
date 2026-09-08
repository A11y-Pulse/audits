import { describe, expect, it } from "vitest";
import { toJson } from "./serialise";

const PNG_MAGIC = [137, 80, 78, 71];

describe("toJson", () => {
	it("encodes Uint8Array screenshot bytes as base64", () => {
		const json = toJson({
			elements: [{ selector: "button", screenshot: new Uint8Array(PNG_MAGIC) }],
		});

		expect(JSON.parse(json)).toEqual({
			elements: [{ selector: "button", screenshot: "iVBORw==" }],
		});
	});

	it("encodes a Node Buffer, which JSON.stringify would otherwise expand via its own toJSON", () => {
		const json = toJson({ screenshot: Buffer.from(PNG_MAGIC) });

		expect(JSON.parse(json)).toEqual({ screenshot: "iVBORw==" });
		expect(json).not.toContain("data");
	});

	it("encodes bytes held in an array", () => {
		const json = toJson([Buffer.from(PNG_MAGIC), new Uint8Array(PNG_MAGIC)]);

		expect(JSON.parse(json)).toEqual(["iVBORw==", "iVBORw=="]);
	});

	it("leaves other values untouched", () => {
		const json = toJson({
			selector: "button",
			tabIndex: 3,
			failureReason: null,
			metrics: { beforeOverflowPx: 0, afterOverflowPx: 12 },
		});

		expect(JSON.parse(json)).toEqual({
			selector: "button",
			tabIndex: 3,
			failureReason: null,
			metrics: { beforeOverflowPx: 0, afterOverflowPx: 12 },
		});
	});

	it("pretty-prints", () => {
		expect(toJson({ url: "https://example.com" })).toBe('{\n  "url": "https://example.com"\n}');
	});
});
