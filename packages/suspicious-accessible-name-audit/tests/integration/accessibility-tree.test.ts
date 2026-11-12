import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	type FixtureServer,
	startFixtureServer,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import { collectNamedElementsScript } from "../../src/browser-scripts";

type TreeAdaptor = {
	adaptor: BrowserAdaptor;
	/** The name the browser's accessibility tree gives the element with `id`. */
	treeName: ((id: string) => Promise<string | null>) | null;
};

const STASH_KEY = "__accessibilityTreeTest";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

const adaptors: AdaptorFactories<TreeAdaptor> = {
	puppeteer: (page) => ({
		adaptor: new PuppeteerAdaptor(page),
		treeName: async (id) => {
			const handle = await page.$(`[id="${id}"]`);

			if (!handle) {
				return null;
			}

			try {
				const node = await page.accessibility.snapshot({ root: handle, interestingOnly: false });

				return node?.name ?? null;
			} finally {
				await handle.dispose();
			}
		},
	}),
	// Only Chrome's tree is read: one engine is enough to catch the computation drifting.
	playwright: (page) => ({ adaptor: new PlaywrightAdaptor(page), treeName: null }),
};

function stashedIdsScript(stashKey: string, count: number): string[] {
	const stash = (window as unknown as Record<string, Element[]>)[stashKey] ?? [];

	return stash.slice(0, count).map((el) => el.id);
}

function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

describeEachEngine<TreeAdaptor>(
	"suspicious accessible name audit against the accessibility tree (integration)",
	{ adaptor: adaptors },
	(engine) => {
		it.skipIf(engine.driver !== "puppeteer")(
			"computes the name the browser's accessibility tree reports",
			async () => {
				const page = await engine.newPage();

				try {
					await page.goto(`${server.url}/name-corpus.html`);

					const { adaptor, treeName } = page.adaptor;
					const { elements } = await adaptor.evaluate(
						collectNamedElementsScript,
						STASH_KEY,
						100,
						300,
					);
					const ids = await adaptor.evaluate(stashedIdsScript, STASH_KEY, elements.length);

					const computed = Object.fromEntries(elements.map(({ name }, i) => [ids[i], name]));
					const fromTree: Record<string, string | null> = {};

					for (const id of ids) {
						const name = await treeName!(id);

						fromTree[id] = name === null ? null : collapse(name);
					}

					// Every control in the corpus, so an element the audit stops collecting fails here.
					expect(ids).toHaveLength(24);
					expect(computed).toEqual(fromTree);
				} finally {
					await page.close();
				}
			},
		);
	},
);
