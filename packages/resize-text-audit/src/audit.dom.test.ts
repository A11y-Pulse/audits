// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResizeTextAuditAdaptor } from "./adaptor";
import { runResizeTextAudit } from "./audit";

/**
 * These tests run the audit with the scripts it really injects, against a DOM with no layout
 * engine. Geometry is supplied by hand: `layouts` says where each element sits at full size and at
 * 200%, and the adaptor's `setViewport` switches between them, as a resize would.
 */

type Box = { x: number; y: number; width: number; height: number };
type Layout = Record<string, Box>;

const originalGetClientRects = Range.prototype.getClientRects;

function domRect(box: Box): DOMRect {
	return {
		...box,
		left: box.x,
		top: box.y,
		right: box.x + box.width,
		bottom: box.y + box.height,
		toJSON() {
			return {};
		},
	} as DOMRect;
}

function applyLayout(layout: Layout): void {
	for (const el of Array.from(document.querySelectorAll("body, body *"))) {
		const box = layout[el.id] ?? { x: 0, y: 0, width: 1280, height: 800 };

		el.getBoundingClientRect = () => domRect(box);

		for (const [name, value] of Object.entries({
			clientLeft: 0,
			clientTop: 0,
			clientWidth: box.width,
			clientHeight: box.height,
			scrollWidth: box.width,
			scrollHeight: box.height,
		})) {
			Object.defineProperty(el, name, { configurable: true, value });
		}
	}
}

function executingAdaptor(layouts: { full: Layout; zoomed: Layout }): ResizeTextAuditAdaptor & {
	stylesAfter: Record<string, string[]>;
	clips: Box[];
} {
	const stylesAfter: Record<string, string[]> = {};
	const clips: Box[] = [];
	let viewport = { width: 1280, height: 800 };

	applyLayout(layouts.full);

	return {
		stylesAfter,
		clips,
		getViewport: async () => viewport,
		setViewport: async (next) => {
			viewport = next;
			applyLayout(next.width < 1280 ? layouts.zoomed : layouts.full);
		},
		evaluate: async <T>(
			fn: (...args: never[]) => T | Promise<T>,
			...args: unknown[]
		): Promise<T> => {
			const result = await (fn as (...fnArgs: unknown[]) => T | Promise<T>)(...args);

			stylesAfter[fn.name] = Array.from(document.querySelectorAll("style[data-a11y-pulse]")).map(
				(style) => style.getAttribute("data-a11y-pulse") ?? "",
			);

			return result;
		},
		screenshotClip: async (clip) => {
			clips.push(clip);

			return new Uint8Array([1, 2, 3]);
		},
	};
}

const FAST = { settleDelayMs: 0, minSettleMs: 0 };

beforeEach(() => {
	// The text inside an element occupies the element's box.
	Range.prototype.getClientRects = function getClientRects(this: Range) {
		const parent = this.startContainer.parentElement;

		return (parent ? [parent.getBoundingClientRect()] : []) as unknown as DOMRectList;
	};
});

afterEach(() => {
	Range.prototype.getClientRects = originalGetClientRects;
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

describe("runResizeTextAudit against a document", () => {
	it("freezes motion while it measures, never applies the spacing override, and cleans up", async () => {
		document.body.innerHTML = `<p id="copy">Hello world from a paragraph that reflows.</p>`;

		const copy = { x: 0, y: 0, width: 400, height: 24 };
		const adaptor = executingAdaptor({
			full: { copy },
			zoomed: { copy: { ...copy, width: 200, height: 48 } },
		});
		const result = await runResizeTextAudit(adaptor, FAST);

		expect(adaptor.stylesAfter).toMatchObject({
			collectBaselineScript: ["ts-freeze"],
			remeasureScript: ["ts-freeze"],
			restoreAndVerifyScript: [],
		});
		expect(result.candidateCount).toBe(1);
		expect(result.findings).toEqual([]);
		expect(result.restored).toBe(true);
	});

	it("reports text a fixed-height box cuts into once the viewport is halved", async () => {
		document.body.innerHTML = `
			<div id="card" style="overflow: hidden"><p id="copy">A paragraph that wraps at 200%.</p></div>
			<p id="free">A paragraph nothing clips.</p>`;

		const card = { x: 0, y: 0, width: 400, height: 60 };
		const adaptor = executingAdaptor({
			full: {
				card,
				copy: { x: 0, y: 0, width: 400, height: 48 },
				free: { x: 0, y: 80, width: 400, height: 24 },
			},
			zoomed: {
				card: { ...card, width: 200 },
				copy: { x: 0, y: 0, width: 200, height: 96 },
				free: { x: 0, y: 80, width: 200, height: 48 },
			},
		});
		const result = await runResizeTextAudit(adaptor, FAST);

		expect(result.findings).toEqual([
			{
				selector: "#copy",
				html: '<p id="copy">',
				kind: "clipped",
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 36 },
				rect: { x: 0, y: 0, width: 200, height: 96 },
				axis: "vertical",
				affectedCount: 1,
				clippedBy: "#card",
				clippedByHtml: '<div id="card" style="overflow: hidden">',
				clippedByRect: { x: 0, y: 0, width: 200, height: 60 },
				screenshot: new Uint8Array([1, 2, 3]),
			},
		]);
		expect(adaptor.clips).toHaveLength(1);
		expect(result.restored).toBe(true);
	});

	it("does not report text clipped by a box that truncates with an ellipsis", async () => {
		document.body.innerHTML = `
			<p id="row" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
				<span id="label">Password changed successfully</span>
			</p>`;

		const adaptor = executingAdaptor({
			full: {
				row: { x: 0, y: 0, width: 400, height: 24 },
				label: { x: 0, y: 0, width: 300, height: 24 },
			},
			zoomed: {
				row: { x: 0, y: 0, width: 200, height: 24 },
				label: { x: 0, y: 0, width: 300, height: 24 },
			},
		});

		expect((await runResizeTextAudit(adaptor, FAST)).findings).toEqual([]);
	});

	it("reads the viewport meta tag", async () => {
		document.head.innerHTML = `<meta name="viewport" content="width=device-width, maximum-scale=1">`;
		document.body.innerHTML = `<p id="copy">Text</p>`;

		const copy = { x: 0, y: 0, width: 100, height: 24 };
		const result = await runResizeTextAudit(
			executingAdaptor({ full: { copy }, zoomed: { copy } }),
			FAST,
		);

		expect(result.viewportMeta).toMatchObject({ maximumScale: 1, blocksZoom: true });
	});
});
