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
import { type PasteBlockingResult, runPasteBlockingAudit } from "../../src/index";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

const adaptors: AdaptorFactories<BrowserAdaptor> = {
	puppeteer: (page) => new PuppeteerAdaptor(page),
	playwright: (page) => new PlaywrightAdaptor(page),
};

type FieldState = { value: string; readOnly: boolean };

function fieldStatesScript(): Record<string, FieldState> {
	const states: Record<string, FieldState> = {};

	for (const input of document.querySelectorAll("input")) {
		states[input.id] = { value: input.value, readOnly: input.readOnly };
	}

	return states;
}

function selectors(fields: readonly { selector: string }[]): string[] {
	return fields.map(({ selector }) => selector);
}

describeEachEngine<BrowserAdaptor>(
	"paste blocking audit (integration)",
	{ adaptor: adaptors },
	(engine) => {
		async function runFixture(
			name: string,
		): Promise<{ result: PasteBlockingResult; after: Record<string, FieldState> }> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				const before = await page.adaptor.evaluate(fieldStatesScript);
				const result = await runPasteBlockingAudit(page.adaptor);
				const after = await page.adaptor.evaluate(fieldStatesScript);

				// Whatever the outcome, every field is left as it was found.
				expect(after).toEqual(before);

				return { result, after };
			} finally {
				await page.close();
			}
		}

		it("passes an ordinary sign-in form", async () => {
			const { result } = await runFixture("login.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(result.passed).toMatchObject([
				{ selector: "#email", kind: "username", signals: [], blocked: [], detectedBy: null },
				{
					selector: "#password",
					kind: "password",
					signals: [],
					blocked: [],
					detectedBy: null,
					autocomplete: "current-password",
					boxes: null,
				},
			]);
			expect(result.summary).toEqual({
				checked: 2,
				failed: 0,
				needsReview: 0,
				passed: 2,
				unchecked: 0,
			});
		});

		it('fails a password field with onpaste="return false"', async () => {
			const { result, after } = await runFixture("onpaste-attribute.html");

			expect(result.failed).toEqual([
				{
					selector: "#password",
					// The value a visitor typed is kept out of the report.
					html: expect.not.stringContaining("hunter2"),
					kind: "password",
					signals: ["paste-blocked"],
					blocked: ["paste"],
					detectedBy: "inline-handler",
					autocomplete: null,
					boxes: null,
					partialProbe: false,
					suppressed: [],
				},
			]);
			expect(result.failed[0]?.html).toContain('onpaste="return false"');
			expect(selectors(result.passed)).toEqual(["#email"]);
			expect(result.needsReview).toEqual([]);
			expect(after.password?.value).toBe("hunter2");
		});

		it("fails a confirm-password field whose paste listener cancels the event", async () => {
			const { result } = await runFixture("confirm-listener.html");

			expect(result.failed).toMatchObject([
				{
					selector: "#confirm-password",
					kind: "new-password",
					signals: ["paste-blocked"],
					blocked: ["paste"],
					detectedBy: "event-listener",
				},
			]);
			expect(result.failed).toHaveLength(1);
			expect(result.passed).toMatchObject([
				{ selector: "#email", kind: "username" },
				{ selector: "#new-password", kind: "new-password" },
			]);
			expect(result.summary).toMatchObject({ checked: 3, failed: 1, needsReview: 0, passed: 2 });
		});

		it("passes a paste handler that cancels the event and writes the text in itself", async () => {
			const { result, after } = await runFixture("sanitise.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(selectors(result.passed)).toEqual(["#username", "#password"]);
			expect(after.username?.value).toBe("");
			expect(after.password?.value).toBe("kept");
		});

		it("passes a split code entry that spreads a pasted code across its boxes", async () => {
			const { result, after } = await runFixture("otp-split-handled.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(result.passed).toMatchObject([
				{ selector: "#d1", kind: "one-time-code", signals: [], boxes: 6 },
			]);
			expect(result.summary.checked).toBe(1);
			expect(Object.values(after).map(({ value }) => value)).toEqual(["", "", "", "", "", ""]);
		});

		it("reviews a split code entry that does nothing with a pasted code", async () => {
			const { result } = await runFixture("otp-split-unhandled.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toMatchObject([
				{
					selector: "#d1",
					kind: "one-time-code",
					signals: ["split-code-paste-unhandled"],
					blocked: [],
					detectedBy: null,
					boxes: 6,
				},
			]);
			expect(result.summary).toMatchObject({ checked: 1, needsReview: 1, passed: 0 });
		});

		it("reviews autocomplete that is switched off or set for a new password on a sign-in form", async () => {
			const { result } = await runFixture("autocomplete.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toMatchObject([
				{ selector: "#email", kind: "username", signals: ["autocomplete-off"] },
				{ selector: "#password", kind: "password", signals: ["autocomplete-off"] },
				{
					selector: "#member-password",
					kind: "password",
					signals: ["new-password-on-sign-in"],
					autocomplete: "new-password",
				},
			]);
			expect(result.needsReview).toHaveLength(3);
			expect(selectors(result.passed)).toEqual(["#member"]);
		});

		it("is inapplicable on a page with search, checkout and card fields but no sign-in", async () => {
			const { result } = await runFixture("no-auth-fields.html");

			expect(result).toEqual({
				failed: [],
				needsReview: [],
				passed: [],
				summary: { checked: 0, failed: 0, needsReview: 0, passed: 0, unchecked: 0 },
			});
		});

		it("reviews a code field with no autofill hint and one whose key filter swallows the paste shortcut", async () => {
			const { result } = await runFixture("one-time-codes.html");

			expect(result.failed).toEqual([]);
			expect(selectors(result.passed)).toEqual(["#code"]);
			expect(result.needsReview).toMatchObject([
				{ selector: "#otp", kind: "one-time-code", signals: ["no-autofill-hint"], blocked: [] },
				{
					selector: "#totp",
					kind: "one-time-code",
					signals: ["paste-may-be-blocked"],
					blocked: ["shortcut"],
					detectedBy: "event-listener",
				},
			]);
			expect(result.needsReview).toHaveLength(2);
		});

		it("reviews fields kept read-only until focus, and passes one that is always read-only", async () => {
			const { result, after } = await runFixture("readonly-until-focus.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toMatchObject([
				{ selector: "#email", kind: "username", signals: ["readonly-until-focus"] },
				{ selector: "#password", kind: "password", signals: ["readonly-until-focus"] },
			]);
			expect(result.needsReview).toHaveLength(2);
			expect(selectors(result.passed)).toEqual(["#saved-email", "#saved-password"]);
			expect(after.email?.readOnly).toBe(true);
			expect(after.password?.readOnly).toBe(true);
		});

		it("reaches fields in a shadow root, and focuses a field before trusting a refusal", async () => {
			const { result } = await runFixture("shadow-dom.html");

			expect(result.failed).toMatchObject([
				{
					selector: "login-form >>> #pass",
					kind: "password",
					signals: ["paste-blocked"],
					detectedBy: "event-listener",
				},
			]);
			expect(result.failed).toHaveLength(1);
			expect(result.needsReview).toEqual([]);
			expect(selectors(result.passed)).toEqual(["login-form >>> #user"]);
		});

		/** Requests the fixture's own scripts or forms made, leaving out the page load itself. */
		function sentBy(name: string, since: number): string[] {
			// Firefox asks for the favicon whenever it gets round to it, with the page as referrer.
			return server.requests
				.slice(since)
				.filter(({ referrer, path }) => referrer === `/${name}` && path !== "/favicon.ico")
				.map(({ method, path }) => `${method} ${path}`);
		}

		const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

		it("never pastes a whole code into a field that verifies as soon as it is complete", async () => {
			const since = server.requests.length;
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/otp-auto-submit.html`);

				const result = await runPasteBlockingAudit(page.adaptor);

				// Long enough for a background request or a form submission to reach the server.
				await pause(300);

				expect(sentBy("otp-auto-submit.html", since)).toEqual([]);
				expect(await page.adaptor.evaluate(() => location.pathname)).toBe("/otp-auto-submit.html");
				expect(await page.adaptor.evaluate(fieldStatesScript)).toMatchObject({
					code: { value: "" },
					b1: { value: "" },
					b6: { value: "" },
				});
				expect(
					await page.adaptor.evaluate(() => document.getElementById("status")?.textContent),
				).toBe("");

				// The page took the paste, so there is nothing to report, and nothing had to be stopped.
				expect(result.failed).toEqual([]);
				expect(result.needsReview).toEqual([]);
				expect(result.passed).toMatchObject([
					{ selector: "#b1", kind: "one-time-code", boxes: 6, partialProbe: true, suppressed: [] },
					{ selector: "#code", kind: "one-time-code", partialProbe: true, suppressed: [] },
				]);
				expect(result.passed).toHaveLength(2);
			} finally {
				await page.close();
			}
		});

		it("stops a page that sends whatever is pasted, and records what it stopped", async () => {
			const since = server.requests.length;
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/otp-eager-send.html`);

				const result = await runPasteBlockingAudit(page.adaptor);

				await pause(300);

				expect(sentBy("otp-eager-send.html", since)).toEqual([]);
				expect(await page.adaptor.evaluate(() => location.pathname)).toBe("/otp-eager-send.html");
				expect(result.passed).toMatchObject([
					{ selector: "#otp", suppressed: ["request"] },
					{ selector: "#pin", suppressed: ["submit"] },
				]);
				expect(result.failed).toEqual([]);
				expect(result.needsReview).toEqual([]);
				expect(await page.adaptor.evaluate(fieldStatesScript)).toMatchObject({
					otp: { value: "" },
					pin: { value: "" },
				});

				// Everything that was held back works again once the audit has finished.
				const restored = await page.adaptor.evaluate(async () => {
					const native = (fn: unknown): boolean => String(fn).includes("[native code]");
					const response = await fetch("/after-audit", { method: "POST" });

					return {
						fetched: response.status,
						fetch: native(window.fetch),
						submit: native(HTMLFormElement.prototype.submit),
						requestSubmit: native(HTMLFormElement.prototype.requestSubmit),
						send: native(XMLHttpRequest.prototype.send),
						beacon: native(navigator.sendBeacon) && !Object.hasOwn(navigator, "sendBeacon"),
					};
				});

				expect(restored).toEqual({
					fetched: 404,
					fetch: true,
					submit: true,
					requestSubmit: true,
					send: true,
					beacon: true,
				});
				expect(sentBy("otp-eager-send.html", since)).toEqual(["POST /after-audit"]);

				// A form can be submitted again too.
				await page.adaptor.evaluate(() => {
					(document.getElementById("verify") as HTMLFormElement).requestSubmit();
				});
				await pause(300);

				expect(sentBy("otp-eager-send.html", since)).toContain("POST /eager-form");
			} finally {
				await page.close();
			}
		});

		it("passes fields whose page writes the pasted text in late, and puts their values back", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/late-write.html`);
				await page.adaptor.evaluate(() => {
					const username = document.getElementById("username") as HTMLInputElement;
					username.focus();
					username.setSelectionRange(1, 3);
				});

				const result = await runPasteBlockingAudit(page.adaptor);

				// Past the slowest of the page's own timers, so a value written after the audit shows.
				await pause(700);

				expect(result.failed).toEqual([]);
				expect(result.needsReview).toEqual([]);
				expect(result.passed).toMatchObject([
					{ selector: "#username", signals: [], blocked: [], detectedBy: null },
					{ selector: "#password", signals: [], blocked: [], detectedBy: null },
				]);
				expect(await page.adaptor.evaluate(fieldStatesScript)).toMatchObject({
					username: { value: "jane" },
					password: { value: "hunter2" },
				});

				// Focus and the selection are back where the visitor left them.
				expect(
					await page.adaptor.evaluate(() => {
						const active = document.activeElement as HTMLInputElement;

						return [active.id, active.selectionStart, active.selectionEnd];
					}),
				).toEqual(["username", 1, 3]);
			} finally {
				await page.close();
			}
		});

		it("passes a split code that spreads the paste a tick later, and returns focus", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/otp-split-late.html`);
				await page.adaptor.evaluate(() => document.getElementById("resend")?.focus());

				const result = await runPasteBlockingAudit(page.adaptor);

				await pause(300);

				expect(result.failed).toEqual([]);
				expect(result.needsReview).toEqual([]);
				expect(result.passed).toMatchObject([
					{ selector: "#d1", kind: "one-time-code", signals: [], boxes: 6 },
				]);

				const after = await page.adaptor.evaluate(fieldStatesScript);

				expect(Object.values(after).map(({ value }) => value)).toEqual(["", "", "", "", "", ""]);
				expect(await page.adaptor.evaluate(() => document.activeElement?.id)).toBe("resend");
			} finally {
				await page.close();
			}
		});

		it("pastes text of the kind and length each field takes", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/shaped-fields.html`);

				const result = await runPasteBlockingAudit(page.adaptor);

				expect(
					await page.adaptor.evaluate(
						() => (window as unknown as { pasted: Record<string, string> }).pasted,
					),
				).toEqual({
					phone: "5550100",
					// Cut to the field's maxlength of 12.
					password: "Probe-4f9a-P",
					// A PIN and a code are pasted a digit short, so that neither is ever complete.
					pin: "123",
					backup: "1234567",
				});

				// Digits-only and length-limited fields are not blamed for turning away the wrong text.
				expect(result.failed).toEqual([]);
				expect(selectors(result.passed)).toEqual(["#phone", "#password", "#pin"]);

				// A field that only takes a whole code cannot be told from one that takes none.
				expect(result.needsReview).toMatchObject([
					{
						selector: "#backup",
						kind: "one-time-code",
						signals: ["partial-paste-refused"],
						blocked: ["paste"],
						detectedBy: "event-listener",
						partialProbe: true,
					},
				]);
				expect(result.needsReview).toHaveLength(1);
				expect(await page.adaptor.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
			} finally {
				await page.close();
			}
		});

		it("stops at the field limit and counts the rest", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/confirm-listener.html`);

				const result = await runPasteBlockingAudit(page.adaptor, { fieldLimit: 2 });

				expect(result.failed).toEqual([]);
				expect(selectors(result.passed)).toEqual(["#email", "#new-password"]);
				expect(result.summary).toEqual({
					checked: 2,
					failed: 0,
					needsReview: 0,
					passed: 2,
					unchecked: 1,
				});
			} finally {
				await page.close();
			}
		});
	},
);
