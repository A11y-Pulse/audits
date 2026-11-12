import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	type FixtureServer,
	isPng,
	startFixtureServer,
	WEBKIT_NO_LINK_FOCUS,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { SkipLinkAuditAdaptor } from "../../src/adaptor";
import { runSkipLinkAudit, type SkipLinkOptions, type SkipLinkResult } from "../../src/index";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

const adaptors: AdaptorFactories<SkipLinkAuditAdaptor> = {
	puppeteer: (page) => new PuppeteerAdaptor(page),
	playwright: (page) => new PlaywrightAdaptor(page),
};

type PageState = {
	hash: string;
	scrollY: number;
	focused: string;
	menuHidden: boolean | null;
	/** Whether the menu takes up space, for menus shown by CSS rather than the hidden attribute. */
	menuDisplayed: boolean | null;
	/** Id of the element matching `:target`, which a rewritten URL alone does not reset. */
	targeted: string | null;
	/** Text of the focusable elements a fresh keyboard user would reach first. */
	firstTabStop: string;
	/** Markers the audit may have left in the page. */
	leftovers: number;
};

function readPageState(): PageState {
	const menu = document.getElementById("menu");

	return {
		hash: location.hash,
		scrollY: window.scrollY,
		focused: document.activeElement?.tagName ?? "",
		menuHidden: menu ? menu.hasAttribute("hidden") : null,
		menuDisplayed: menu ? menu.getClientRects().length > 0 : null,
		targeted: document.querySelector(":target")?.id ?? null,
		firstTabStop: (document.querySelector("a[href], button")?.textContent ?? "").trim(),
		leftovers: document.querySelectorAll(
			"[data-a11y-pulse-skip-link-focus-start], [data-a11y-pulse-unreachable-skip-link]",
		).length,
	};
}

function readFocusedText(): string {
	return (document.activeElement?.textContent ?? "").trim();
}

describeEachEngine<SkipLinkAuditAdaptor>(
	"skip link audit (integration)",
	{
		adaptor: adaptors,
		unsupported: {
			"playwright-webkit": WEBKIT_NO_LINK_FOCUS,
		},
	},
	(engine) => {
		async function runFixtureWithState(
			name: string,
			options?: SkipLinkOptions,
		): Promise<{ result: SkipLinkResult; state: PageState; nextTab: string }> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				const result = await runSkipLinkAudit(page.adaptor, options);

				const state = await page.adaptor.evaluate(readPageState);

				// Where a keyboard user, or the next audit, lands on their first Tab press.
				await page.adaptor.pressTab();

				return { result, state, nextTab: await page.adaptor.evaluate(readFocusedText) };
			} finally {
				await page.close();
			}
		}

		async function runFixture(name: string, options?: SkipLinkOptions): Promise<SkipLinkResult> {
			return (await runFixtureWithState(name, options)).result;
		}

		it("passes a skip link whose target is programmatically focused", async () => {
			const result = await runFixture("working.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				fragment: "#main",
				tabIndex: 1,
				passed: true,
				failureReason: null,
				linkText: "Skip to content",
				target: { selector: "#main", html: '<main id="main" tabindex="-1">', rendered: true },
				focusAfterEnter: { position: "inside-target", selector: "#main" },
				focusAfterTab: null,
			});
			expect(result.skipLinks[0]?.screenshot).toBeUndefined();
		});

		it("flags a skip link whose fragment target is missing", async () => {
			const result = await runFixture("target-missing.html");

			expect(result.skipLinks).toHaveLength(1);
			expect(result.skipLinks[0]).toMatchObject({
				fragment: "#main",
				passed: false,
				failureReason: "target-missing",
				target: null,
				focusAfterTab: null,
			});
			expect(isPng(result.skipLinks[0]?.screenshot)).toBe(true);
			expect(result.summary).toEqual({ found: 1, passed: 0, failed: 1, unreachable: 0 });
		});

		it("passes when the target is not focusable but the next Tab lands inside it", async () => {
			const result = await runFixture("target-not-focusable.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				failureReason: null,
				focusAfterTab: { position: "inside-target", selector: 'a[href="/inside"]' },
			});
		});

		it("passes a skip link to a heading, where the next Tab lands after the target", async () => {
			const result = await runFixture("heading-target.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				selector: "a.skip-link",
				fragment: "#title",
				passed: true,
				failureReason: null,
				target: { selector: "#title", html: '<h1 id="title">' },
				focusAfterTab: { position: "after-target", selector: 'a[href="/report.pdf"]' },
			});
		});

		it("passes a skip link to an empty anchor placed before the content", async () => {
			const result = await runFixture("empty-anchor-target.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				fragment: "#content",
				passed: true,
				target: { selector: "#content" },
				focusAfterTab: { position: "after-target", selector: 'a[href="/visit"]' },
			});
		});

		it("passes a skip link to a legacy named anchor", async () => {
			const result = await runFixture("named-anchor-target.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				target: { selector: 'a[name="content"]' },
				focusAfterTab: { position: "after-target", selector: 'a[href="/2019"]' },
			});
		});

		it("does not resolve a fragment to a form control with a matching name", async () => {
			const result = await runFixture("name-not-anchor.html");

			expect(result.summary).toEqual({ found: 1, passed: 0, failed: 1, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				fragment: "#search",
				failureReason: "target-missing",
				target: null,
			});
		});

		it("flags a skip link whose click handler preventDefault does nothing", async () => {
			const result = await runFixture("activation-no-effect.html");

			expect(result.summary).toEqual({ found: 1, passed: 0, failed: 1, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				passed: false,
				failureReason: "activation-no-effect",
				focusAfterEnter: { position: "skip-link", selector: "#skip" },
				focusAfterTab: { position: "elsewhere", selector: 'a[href="/about"]' },
			});
			expect(isPng(result.skipLinks[0]?.screenshot)).toBe(true);
		});

		it("flags a cancelled skip link even when the next tab stop happens to follow its target", async () => {
			const result = await runFixture("prevented-adjacent-target.html");

			expect(result.summary).toEqual({ found: 1, passed: 0, failed: 1, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				failureReason: "activation-no-effect",
				focusAfterEnter: { position: "skip-link" },
				focusAfterTab: { position: "after-target", selector: 'a[href="/inside"]' },
			});
		});

		it("flags a skip link whose target sits inside a display:none container", async () => {
			const result = await runFixture("target-hidden.html");

			expect(result.summary).toEqual({ found: 1, passed: 0, failed: 1, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				fragment: "#main",
				failureReason: "target-hidden",
				target: { selector: "#main", rendered: false },
				focusAfterTab: null,
			});
			expect(isPng(result.skipLinks[0]?.screenshot)).toBe(true);
		});

		it("passes a script-driven skip link whose fragment matches nothing", async () => {
			const result = await runFixture("js-skip-link.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				selector: "#skip-link",
				fragment: "#skip",
				passed: true,
				failureReason: null,
				target: null,
				focusAfterEnter: { position: "after-link", selector: "main" },
			});
		});

		it("recognises same-document skip links written as a path or an absolute URL", async () => {
			const result = await runFixture("path-href.html");

			expect(result.summary).toEqual({ found: 2, passed: 2, failed: 0, unreachable: 0 });
			expect(result.skipLinks.map((link) => link.fragment)).toEqual(["#main", "#main"]);
			expect(result.skipLinks.map((link) => link.linkText)).toEqual([
				"Skip to content",
				"Skip to content (absolute)",
			]);
		});

		it("ignores a fragment link that points at another page", async () => {
			const { result, state } = await runFixtureWithState("other-page-fragment.html");

			expect(result.skipLinks).toEqual([]);
			expect(state.hash).toBe("");
		});

		it("does not treat a menu toggle as a skip link, and leaves it unactivated", async () => {
			const { result, state } = await runFixtureWithState("menu-toggle.html");

			expect(result.skipLinks).toEqual([]);
			expect(result.unreachable).toEqual([]);
			expect(state.menuHidden).toBe(true);
			expect(state.hash).toBe("");
		});

		it("ignores disclosure triggers, tabs and link-shaped buttons even with skip-like text", async () => {
			const result = await runFixture("disclosure-and-tabs.html");

			expect(result.skipLinks).toEqual([]);
			expect(result.unreachable).toEqual([]);
		});

		it("passes a visually hidden skip link that is revealed on focus", async () => {
			const result = await runFixture("reveal-on-focus.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]?.selector).toBe("a.skip-link");
		});

		it("reports a display:none skip link that can never be focused", async () => {
			const result = await runFixture("skip-link-display-none.html");

			expect(result.skipLinks).toEqual([]);
			expect(result.summary).toEqual({ found: 0, passed: 0, failed: 0, unreachable: 1 });
			expect(result.unreachable).toEqual([
				{
					selector: "a.skip-link",
					html: '<a class="skip-link" href="#main">',
					fragment: "#main",
					linkText: "Skip to content",
					reason: "not-rendered",
				},
			]);
		});

		it("restores the URL, :target, scroll position and tab order after activating a skip link", async () => {
			const { result, state, nextTab } = await runFixtureWithState("long-page.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(state).toMatchObject({
				hash: "",
				scrollY: 0,
				focused: "BODY",
				targeted: null,
				leftovers: 0,
			});
			// Not "Products" or the page's end: tabbing starts from the top again.
			expect(nextTab).toBe("Skip to content");
		});

		it("restores the page after a skip link to a target that cannot take focus", async () => {
			const { result, state, nextTab } = await runFixtureWithState("heading-target.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(state).toMatchObject({ hash: "", focused: "BODY", targeted: null, leftovers: 0 });
			expect(nextTab).toBe(state.firstTabStop);
		});

		it("starts the tab order again at a positive tabindex, where that page's order begins", async () => {
			const { result, state, nextTab } = await runFixtureWithState("positive-tabindex.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(state).toMatchObject({ hash: "", focused: "BODY", targeted: null });
			expect(nextTab).toBe("Skip to content");
		});

		it("starts the tab order from the top again when no skip link was found", async () => {
			const { result, state, nextTab } = await runFixtureWithState("landmark-only.html");

			expect(result.skipLinks).toEqual([]);
			expect(state).toMatchObject({ focused: "BODY", leftovers: 0 });
			expect(nextTab).toBe(state.firstTabStop);
		});

		it("does not follow a menu link whose menu is revealed by :target elsewhere in the page", async () => {
			const { result, state, nextTab } = await runFixtureWithState("target-menu.html");

			expect(result.skipLinks).toEqual([]);
			expect(result.unreachable).toEqual([]);
			expect(state).toMatchObject({ hash: "", targeted: null, menuDisplayed: false });
			expect(nextTab).toBe("Menu");
		});

		it("does not report collapsed in-page links whose words merely contain skip wording", async () => {
			const result = await runFixture("collapsed-list.html");

			expect(result.skipLinks).toEqual([]);
			expect(result.unreachable).toEqual([]);
		});

		it("finds a skip link at the 2nd tab stop", async () => {
			const result = await runFixture("skip-link-not-first.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]?.tabIndex).toBe(2);
		});

		it("finds a skip link at the 3rd tab stop", async () => {
			const result = await runFixture("skip-link-at-stop-3.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]?.tabIndex).toBe(3);
		});

		it("stays silent on a landmark-only page with no skip link", async () => {
			const result = await runFixture("landmark-only.html");

			expect(result.skipLinks).toEqual([]);
			expect(result.unreachable).toEqual([]);
			expect(result.summary).toEqual({ found: 0, passed: 0, failed: 0, unreachable: 0 });
		});

		it("records multiple skip links", async () => {
			const result = await runFixture("multiple-skip-links.html");

			expect(result.skipLinks).toHaveLength(2);
			expect(result.skipLinks.map((link) => link.fragment)).toEqual(["#main", "#nav"]);
			expect(result.summary).toEqual({ found: 2, passed: 2, failed: 0, unreachable: 0 });
		});

		it("ignores hash-router nav and still checks a real skip link", async () => {
			const result = await runFixture("hash-router.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]).toMatchObject({
				fragment: "#main",
				tabIndex: 2,
				passed: true,
				failureReason: null,
			});
		});

		it("passes when the target is focused asynchronously within 250ms", async () => {
			const result = await runFixture("async-focus.html");

			expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0, unreachable: 0 });
			expect(result.skipLinks[0]?.passed).toBe(true);
		});
	},
);
