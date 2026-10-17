import {
	describeEachEngine,
	type FixtureServer,
	type RecordedRequest,
	startFixtureServer,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuditAdaptors, type AuditRunnerResult, runAllAudits } from "../../src/run-audits";
import { toJson } from "../../src/serialise";
import { adaptors } from "../integration/helpers/adaptors";
import {
	AXE_RULE_IDS,
	bucketsFor,
	DESKTOP,
	describeAudit,
	type Expectation,
	pendingReason,
	RUNNER_AUDIT_IDS,
} from "./expectations";
import { GROUPS } from "./groups";

// Pages request this prefix from anything an audit must never trigger: destructive buttons,
// payment and consent controls, real form submissions.
const TRIPWIRE_PREFIX = "/__tripwire/";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("pages", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

function testName(expectation: Expectation): string {
	const target =
		expectation.target === undefined ? "" : ` ${[expectation.target].flat().join(" ")}`;

	return `${expectation.scenario} (${expectation.audit}${target} → ${expectation.outcome})`;
}

const PAGE_PATHS: ReadonlySet<string> = new Set(
	GROUPS.flatMap((group) => group.variants.map((variant) => `/${group.name}/${variant}`)),
);

// Set on the page before the audits run and read back after, to tell a reload from the same page.
const DOCUMENT_TOKEN = "__a11yPulseE2eDocument";

function assertExpectation(result: AuditRunnerResult, expectation: Expectation): void {
	const { audit, outcome, target } = expectation;
	const buckets = bucketsFor(result, audit, target);
	const message = describeAudit(result, audit);

	// axe-core reports every rule it ran, if only as inapplicable. A rule that is off by default
	// reports nothing, and an expectation on it would otherwise pass without anything being checked.
	if (AXE_RULE_IDS.has(audit) && !RUNNER_AUDIT_IDS.has(audit)) {
		expect(bucketsFor(result, audit), `axe-core did not run ${audit}`).not.toEqual([]);
	}

	if (outcome === "clean") {
		expect(buckets, message).not.toContain("violations");
		expect(buckets, message).not.toContain("incomplete");

		return;
	}

	expect(buckets, message).toContain(outcome);
}

describeEachEngine<AuditAdaptors>(
	"audit runner over crafted pages (e2e)",
	{
		adaptor: adaptors,
		screenshotClipScale: 2,
		viewport: { width: DESKTOP.width, height: DESKTOP.height },
		unsupported: {
			"playwright-webkit": WEBKIT_PARTIAL_TAB_LOOP,
		},
	},
	(engine) => {
		for (const group of GROUPS) {
			const viewports = group.viewports ?? [DESKTOP];

			for (const [variant, viewport] of group.variants.flatMap((variant) =>
				viewports.map((viewport) => [variant, viewport] as const),
			)) {
				const pagePath = `${group.name}/${variant}`;

				describe(viewports.length > 1 ? `${pagePath} (${viewport.name})` : pagePath, () => {
					let result: AuditRunnerResult;
					let requests: RecordedRequest[];
					let finalUrl: string;
					let sameDocument: boolean;
					let missingTargets: string[];

					const expectations = group.expectations.filter(
						(expectation) =>
							(!expectation.variants || expectation.variants.includes(variant)) &&
							(!expectation.viewports || expectation.viewports.includes(viewport.name)) &&
							(!expectation.engines || expectation.engines.includes(engine.name)),
					);
					const targets = [
						...new Set(
							expectations.flatMap((expectation) =>
								typeof expectation.target === "string" ? [expectation.target] : [],
							),
						),
					];

					beforeAll(async () => {
						const firstRequest = server.requests.length;
						const page = await engine.newPage();

						try {
							// Sized before loading, so scripts that read the viewport at load see the real size
							// rather than a resize.
							if (viewport !== DESKTOP) {
								await page.adaptor.reflow.setViewport(viewport);
							}

							await page.goto(`${server.url}/${pagePath}`);
							const token = String(Math.random());
							missingTargets = await page.adaptor.browser.evaluate(
								(selectors: string[], key: string, value: string) => {
									(window as unknown as Record<string, string>)[key] = value;

									return selectors.filter((selector) => !document.querySelector(selector));
								},
								targets,
								DOCUMENT_TOKEN,
								token,
							);
							result = JSON.parse(toJson(await runAllAudits(page.adaptor)));
							finalUrl = page.url();
							sameDocument = await page.adaptor.browser.evaluate(
								(key: string, value: string) =>
									(window as unknown as Record<string, string>)[key] === value,
								DOCUMENT_TOKEN,
								token,
							);
						} finally {
							await page.close();
						}

						// Requests made while this page ran. A request still in flight from another page is left to
						// that page, and an earlier engine's run of this page is never blamed on this one.
						requests = server.requests
							.slice(firstRequest)
							.filter(
								(request) =>
									request.referrer === `/${pagePath}` ||
									request.referrer === undefined ||
									!PAGE_PATHS.has(request.referrer),
							);
					});

					it("leaves the page on its original document", () => {
						// Activating a skip link legitimately leaves its fragment behind.
						expect(finalUrl.replace(/#.*$/, "")).toBe(`${server.url}/${pagePath}`);
						expect(sameDocument, "the page was reloaded or replaced").toBe(true);
					});

					it("has every element its expectations target", () => {
						expect(missingTargets).toEqual([]);
					});

					it("reports only known audits", () => {
						const unknown = [
							result.violations,
							result.incomplete,
							result.passes,
							result.inapplicable,
						]
							.flat()
							.map((entry) => entry.id)
							.filter((id) => !RUNNER_AUDIT_IDS.has(id) && !AXE_RULE_IDS.has(id));

						expect(unknown).toEqual([]);
					});

					it("never trips a control an audit must not activate", () => {
						const tripped = requests.filter(
							(request) => request.method !== "GET" || request.path.startsWith(TRIPWIRE_PREFIX),
						);

						expect(tripped).toEqual([]);
					});

					for (const expectation of expectations) {
						const pending = pendingReason(expectation);

						if (pending) {
							it.todo(`${testName(expectation)} [${pending}]`);

							continue;
						}

						it(testName(expectation), () => {
							assertExpectation(result, expectation);
						});
					}
				});
			}
		}
	},
);
