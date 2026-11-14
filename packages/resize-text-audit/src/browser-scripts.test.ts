// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { readLayoutFingerprintScript, readViewportMetaScript } from "./browser-scripts";

afterEach(() => {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

function viewport(content: string): void {
	document.head.innerHTML = `<meta name="viewport" content="${content}">`;
}

describe("readViewportMetaScript", () => {
	it("returns null when the page has no viewport meta tag", () => {
		document.head.innerHTML = `<meta name="description" content="user-scalable=no">`;

		expect(readViewportMetaScript()).toBeNull();
	});

	it("reports an ordinary responsive tag as not blocking zoom", () => {
		viewport("width=device-width, initial-scale=1");

		expect(readViewportMetaScript()).toEqual({
			content: "width=device-width, initial-scale=1",
			html: '<meta name="viewport" content="width=device-width, initial-scale=1">',
			userScalable: true,
			maximumScale: null,
			blocksZoom: false,
		});
	});

	it.each([
		["user-scalable=no"],
		["user-scalable=0"],
		["USER-SCALABLE = NO"],
		["width=device-width;user-scalable=no"],
		["user-scalable=0.5"],
	])("treats %s as zoom switched off", (content) => {
		viewport(content);

		expect(readViewportMetaScript()).toMatchObject({ userScalable: false, blocksZoom: true });
	});

	it.each([["user-scalable=yes"], ["user-scalable=1"], ["user-scalable=5"]])(
		"treats %s as zoom left on",
		(content) => {
			viewport(content);

			expect(readViewportMetaScript()).toMatchObject({ userScalable: true, blocksZoom: false });
		},
	);

	it.each([
		["maximum-scale=1", 1, true],
		["maximum-scale=1.5", 1.5, true],
		["maximum-scale=2", 2, false],
		["maximum-scale=5.0", 5, false],
	])("reads %s as a limit of %d (blocks zoom: %s)", (content, maximumScale, blocksZoom) => {
		viewport(`width=device-width, ${content}`);

		expect(readViewportMetaScript()).toMatchObject({
			userScalable: true,
			maximumScale,
			blocksZoom,
		});
	});

	it("ignores a maximum-scale that is not a number", () => {
		viewport("maximum-scale=device-width");

		expect(readViewportMetaScript()).toMatchObject({ maximumScale: null, blocksZoom: false });
	});

	it("reads the last viewport tag, as browsers do", () => {
		document.head.innerHTML = `
			<meta name="viewport" content="user-scalable=no">
			<meta name="viewport" content="width=device-width">`;

		expect(readViewportMetaScript()).toMatchObject({
			content: "width=device-width",
			blocksZoom: false,
		});
	});
});

describe("readLayoutFingerprintScript", () => {
	it("changes when the page gains content", () => {
		document.body.innerHTML = "<p>One</p>";

		const before = readLayoutFingerprintScript();

		document.body.insertAdjacentHTML("beforeend", "<p>Two</p>");

		expect(before.childCount).toBe(1);
		expect(readLayoutFingerprintScript().childCount).toBe(2);
		expect(readLayoutFingerprintScript().innerWidth).toBe(window.innerWidth);
	});
});
