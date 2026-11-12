// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { inspectAuthFieldsScript } from "./browser-scripts";

const STASH_KEY = "__testStash";

function inspect(fieldLimit = 10) {
	return inspectAuthFieldsScript(STASH_KEY, fieldLimit);
}

function input(id: string): HTMLInputElement {
	return document.getElementById(id) as HTMLInputElement;
}

function stash(): Element[] {
	return (window as unknown as Record<string, Element[]>)[STASH_KEY] ?? [];
}

afterEach(() => {
	delete (window as unknown as Record<string, unknown>)[STASH_KEY];
	document.body.innerHTML = "";
});

describe("inspectAuthFieldsScript: finding fields", () => {
	it("finds the password and the username beside it, and stashes them in order", async () => {
		document.body.innerHTML = `
			<form>
				<input id="email" type="email" name="email">
				<input id="password" type="password" name="password">
				<input id="remember" type="checkbox">
				<button>Sign in</button>
			</form>
		`;

		const { fields, total } = await inspect();

		expect(total).toBe(2);
		expect(fields.map(({ kind }) => kind)).toEqual(["username", "password"]);
		expect(fields[1]).toMatchObject({ signIn: true, blocked: [], handled: false, boxes: 0 });
		expect(fields[1]?.html).toBe('<input id="password" type="password" name="password">');
		expect(stash()).toEqual([input("email"), input("password")]);
	});

	it("does not take an email field for a username when its form has no password", async () => {
		document.body.innerHTML = `
			<form><input id="newsletter" type="email" name="email"><button>Subscribe</button></form>
			<form><input id="password" type="password"><button>Sign in</button></form>
		`;

		const { fields } = await inspect();

		expect(fields.map(({ kind }) => kind)).toEqual(["password"]);
	});

	it("treats two passwords in a form, or new-password outside a sign-in, as a new password", async () => {
		document.body.innerHTML = `
			<form><input type="password"><input type="password"><button>Create account</button></form>
			<form><input type="password" autocomplete="new-password"><button>Save</button></form>
			<form><input type="password" autocomplete="new-password"><button>Log in</button></form>
		`;

		const { fields } = await inspect();

		expect(fields.map(({ kind, signIn }) => [kind, signIn])).toEqual([
			["new-password", false],
			["new-password", false],
			["new-password", false],
			["password", true],
		]);
	});

	it("recognises a one-time code by its autocomplete, its wording, or a numeric code field", async () => {
		document.body.innerHTML = `
			<input id="a" autocomplete="one-time-code">
			<input id="b" name="otp_code">
			<label for="c">Verification code</label><input id="c">
			<input id="d" name="code" inputmode="numeric">
			<input id="e" placeholder="6-digit code">
		`;

		const { fields } = await inspect();

		expect(fields.map(({ kind }) => kind)).toEqual(Array(5).fill("one-time-code"));
	});

	it("leaves postcodes, promo codes, card security codes and plain code fields alone", async () => {
		document.body.innerHTML = `
			<input name="postcode" inputmode="numeric">
			<input name="zip_code" inputmode="numeric">
			<input name="promo_code" inputmode="numeric">
			<input name="csc" aria-label="Security code" inputmode="numeric" autocomplete="cc-csc">
			<input name="code" aria-label="Embed code">
			<input name="country-code" type="tel">
		`;

		expect((await inspect()).total).toBe(0);
	});

	it("reports a run of four or more one-character boxes once, at its first box", async () => {
		document.body.innerHTML = `
			<div><input id="d1" maxlength="1"></div>
			<div><input id="d2" maxlength="1"></div>
			<div><input id="d3" maxlength="1"></div>
			<div><input id="d4" maxlength="1"></div>
			<input id="initial" maxlength="1">
		`;

		const { fields, total } = await inspect();

		expect(total).toBe(1);
		expect(fields[0]).toMatchObject({ kind: "one-time-code", boxes: 5 });
		expect(stash()).toEqual([input("d1")]);
	});

	it("does not take three one-character boxes for a code", async () => {
		document.body.innerHTML = `<input maxlength="1"><input maxlength="1"><input maxlength="1">`;

		expect((await inspect()).total).toBe(0);
	});

	it("skips disabled and unrendered fields", async () => {
		document.body.innerHTML = `
			<input type="password" disabled>
			<input type="password" style="visibility: hidden">
			<div style="display: none"><input type="password"></div>
		`;

		expect((await inspect()).total).toBe(0);
	});

	it("descends open shadow roots", async () => {
		const host = document.createElement("div");
		host.attachShadow({ mode: "open" }).innerHTML = `<form><input type="password"></form>`;
		document.body.append(host);

		expect((await inspect()).fields.map(({ kind }) => kind)).toEqual(["password"]);
	});

	it("reads autocomplete from the form when the field has none", async () => {
		document.body.innerHTML = `
			<form autocomplete="OFF"><input id="a" type="password"></form>
			<form autocomplete="off"><input id="b" type="password" autocomplete="current-password"></form>
			<form><input id="c" type="password"></form>
		`;

		const { fields } = await inspect();

		expect(fields.map(({ autocomplete }) => autocomplete)).toEqual([
			"off",
			"current-password",
			null,
		]);
	});

	it("inspects up to the limit and counts every field", async () => {
		document.body.innerHTML = `
			<form><input type="password"></form>
			<form><input type="password"></form>
			<form><input type="password"></form>
		`;

		const { fields, total } = await inspect(2);

		expect(fields).toHaveLength(2);
		expect(total).toBe(3);
		expect(stash()).toHaveLength(2);
	});
});

describe("inspectAuthFieldsScript: pasting", () => {
	function passwordField(attributes = ""): HTMLInputElement {
		document.body.innerHTML = `<form><input id="password" type="password" ${attributes}></form>`;

		return input("password");
	}

	it("offers the page the pasted text through the event's clipboard data", async () => {
		const field = passwordField();
		let pasted = "";

		field.addEventListener("paste", (event) => {
			pasted = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
		});

		const { fields } = await inspect();

		expect(pasted.length).toBeGreaterThan(8);
		expect(fields[0]).toMatchObject({ blocked: [], handled: false });
		expect(field.value).toBe("");
	});

	it("records a cancelled paste event that leaves the field unchanged", async () => {
		const field = passwordField('value="typed"');
		field.addEventListener("paste", (event) => event.preventDefault());

		const { fields } = await inspect();

		expect(fields[0]).toMatchObject({ blocked: ["paste"], handled: false, inlineHandler: false });
		expect(field.value).toBe("typed");
	});

	it("notes an onpaste attribute on the field or an ancestor", async () => {
		const field = passwordField();
		field.form?.setAttribute("onpaste", "return false");

		expect((await inspect()).fields[0]?.inlineHandler).toBe(true);
	});

	it("treats a cancelled paste as handled when the page writes the text itself, then restores the value", async () => {
		const field = passwordField('value="typed"');
		const inputs: string[] = [];

		field.addEventListener("paste", (event) => {
			event.preventDefault();
			field.value = "pasted by the page";
		});
		field.addEventListener("input", () => inputs.push(field.value));

		const { fields } = await inspect();

		expect(fields[0]).toMatchObject({ blocked: [], handled: true });
		expect(field.value).toBe("typed");
		// The restore is announced, so a framework holding the value in state follows it.
		expect(inputs).toEqual(["typed"]);
	});

	it("waits for a page that writes the pasted text in a moment later", async () => {
		const field = passwordField();

		field.addEventListener("paste", (event) => {
			event.preventDefault();
			setTimeout(() => {
				field.value = "late";
			}, 10);
		});

		const { fields } = await inspect();

		expect(fields[0]).toMatchObject({ blocked: [], handled: true });
		expect(field.value).toBe("");
	});

	it("records a cancelled beforeinput for a paste, and nothing for other input types", async () => {
		const field = passwordField();
		const seen: string[] = [];

		field.addEventListener("beforeinput", (event) => {
			const { inputType } = event as InputEvent;
			seen.push(inputType);

			if (inputType === "insertFromPaste") {
				event.preventDefault();
			}
		});

		const { fields } = await inspect();

		expect(fields[0]?.blocked).toEqual(["beforeinput"]);
		expect(new Set(seen)).toEqual(new Set(["insertFromPaste"]));
	});

	it("records a cancelled Ctrl+V or Cmd+V key press once", async () => {
		const field = passwordField();

		field.addEventListener("keydown", (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "v") {
				event.preventDefault();
			}
		});

		expect((await inspect()).fields[0]?.blocked).toEqual(["shortcut"]);
	});

	it("drops a cancelled key press when the paste itself is handled", async () => {
		const field = passwordField();

		field.addEventListener("keydown", (event) => event.preventDefault());
		field.addEventListener("paste", (event) => {
			event.preventDefault();
			field.value = "x";
		});

		expect((await inspect()).fields[0]).toMatchObject({ blocked: [], handled: true });
	});

	it("focuses a field only to re-check a refusal, and blurs it afterwards", async () => {
		document.body.innerHTML = `
			<form>
				<input id="email" type="email">
				<input id="password" type="password">
			</form>
		`;
		const focused: string[] = [];

		for (const id of ["email", "password"]) {
			input(id).addEventListener("focus", () => focused.push(id));
		}

		input("password").addEventListener("paste", (event) => event.preventDefault());

		await inspect();

		expect(focused).toEqual(["password"]);
		expect(document.activeElement).toBe(document.body);
	});

	it("pastes a split code one digit short of its boxes, and sees it spread across them", async () => {
		document.body.innerHTML = `
			<input id="d1" maxlength="1"><input id="d2" maxlength="1">
			<input id="d3" maxlength="1"><input id="d4" maxlength="1">
		`;
		const boxes = ["d1", "d2", "d3", "d4"].map(input);
		let pasted = "";

		boxes[0]?.addEventListener("paste", (event) => {
			event.preventDefault();
			pasted = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
			boxes.forEach((box, i) => {
				box.value = pasted[i] ?? "";
			});
		});

		const { fields } = await inspect();

		// Never a whole code: a page that verifies once every box is filled has nothing to send.
		expect(pasted).toBe("123");
		expect(fields[0]).toMatchObject({ boxes: 4, handled: true, blocked: [], partialProbe: true });
		expect(boxes.map((box) => box.value)).toEqual(["", "", "", ""]);
	});

	it("pastes a code a digit short of the length the field's markup gives", async () => {
		document.body.innerHTML = `
			<input id="max" autocomplete="one-time-code" maxlength="8">
			<input id="pattern" autocomplete="one-time-code" pattern="[0-9]{6}">
			<label for="said">5-digit code</label><input id="said" autocomplete="one-time-code">
			<input id="unknown" autocomplete="one-time-code">
		`;
		const pasted: Record<string, string> = {};

		for (const id of ["max", "pattern", "said", "unknown"]) {
			input(id).addEventListener("paste", (event) => {
				pasted[id] = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
			});
		}

		const { fields } = await inspect();

		// With no length to go by, three digits is short of any code a page would accept.
		expect(pasted).toEqual({ max: "1234567", pattern: "12345", said: "1234", unknown: "123" });
		expect(fields.every(({ partialProbe }) => partialProbe)).toBe(true);
	});

	it("shapes the pasted text to a numeric or length-limited field", async () => {
		document.body.innerHTML = `
			<form>
				<input id="phone" type="tel" name="phone" maxlength="6">
				<input id="email" type="email" name="email" maxlength="9">
				<input id="password" type="password" maxlength="5">
				<button>Sign in</button>
			</form>
			<form><input id="pin" type="password" inputmode="numeric" maxlength="4"><button>Unlock</button></form>
		`;
		const pasted: Record<string, string> = {};

		for (const id of ["phone", "email", "password", "pin"]) {
			input(id).addEventListener("paste", (event) => {
				pasted[id] = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
			});
		}

		const { fields } = await inspect();

		expect(pasted).toEqual({ phone: "555010", email: "probe@exa", password: "Probe", pin: "123" });
		expect(fields.map(({ partialProbe }) => partialProbe)).toEqual([false, false, false, true]);
	});

	it("does not take a field the page empties for one it wrote the paste into", async () => {
		const field = passwordField('value="typed"');

		field.addEventListener("paste", (event) => {
			event.preventDefault();
			field.value = "";
		});

		const { fields } = await inspect();

		expect(fields[0]).toMatchObject({ blocked: ["paste"], handled: false });
		expect(field.value).toBe("typed");
	});

	it("puts back a value the page writes after the paste was judged, and no longer calls it refused", async () => {
		const field = passwordField('value="typed"');

		field.addEventListener("paste", (event) => {
			event.preventDefault();
			setTimeout(() => {
				field.value = "written late";
			}, 250);
		});

		const { fields } = await inspect();

		expect(fields[0]).toMatchObject({ blocked: [], handled: true });
		expect(field.value).toBe("typed");

		// Nothing the page still has queued changes the field once the inspection is over.
		await new Promise((resolve) => setTimeout(resolve, 400));

		expect(field.value).toBe("typed");
	});

	it("sees a split code that is spread across its boxes without cancelling the paste", async () => {
		document.body.innerHTML = `
			<input id="d1" maxlength="1"><input id="d2" maxlength="1">
			<input id="d3" maxlength="1"><input id="d4" maxlength="1">
		`;
		const boxes = ["d1", "d2", "d3", "d4"].map(input);

		boxes[0]?.addEventListener("paste", (event) => {
			const code = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";

			setTimeout(() => {
				boxes.forEach((box, i) => {
					box.value = code[i] ?? "";
				});
			}, 0);
		});

		const { fields } = await inspect();

		expect(fields[0]).toMatchObject({ boxes: 4, handled: true, blocked: [] });
		expect(boxes.map((box) => box.value)).toEqual(["", "", "", ""]);
	});
});

describe("inspectAuthFieldsScript: keeping the page from sending", () => {
	function codeForm(): { form: HTMLFormElement; code: HTMLInputElement } {
		document.body.innerHTML = `
			<form id="verify"><input id="code" autocomplete="one-time-code" maxlength="6"><button>Verify</button></form>
		`;

		return { form: document.getElementById("verify") as HTMLFormElement, code: input("code") };
	}

	it("stops a form the page submits on paste, by event or by method, and records it", async () => {
		const { form, code } = codeForm();
		const submitEvents: Event[] = [];
		const nativeSubmit = HTMLFormElement.prototype.submit;
		const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;

		form.addEventListener("submit", (event) => {
			submitEvents.push(event);
			event.preventDefault();
		});
		code.addEventListener("paste", () => {
			form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
			form.requestSubmit();
			form.submit();
		});

		const { fields } = await inspect();

		// The page's own submit handler never ran, so it sent nothing either.
		expect(submitEvents).toEqual([]);
		expect(fields[0]?.suppressed).toEqual(["submit"]);

		// Afterwards the form submits as it did before.
		expect(HTMLFormElement.prototype.submit).toBe(nativeSubmit);
		expect(HTMLFormElement.prototype.requestSubmit).toBe(nativeRequestSubmit);
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		expect(submitEvents).toHaveLength(1);
	});

	it("stops fetch, XMLHttpRequest and sendBeacon requests made on paste, then gives them back", async () => {
		const { code } = codeForm();
		const sent: string[] = [];
		const pageFetch = (() => {
			sent.push("fetch");

			return Promise.resolve(new Response(""));
		}) as typeof fetch;
		const pageSend = function (this: XMLHttpRequest): void {
			sent.push("xhr");
		};
		const pageBeacon = (): boolean => {
			sent.push("beacon");

			return true;
		};
		const nativeFetch = window.fetch;
		const nativeSend = XMLHttpRequest.prototype.send;

		window.fetch = pageFetch;
		XMLHttpRequest.prototype.send = pageSend;
		Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: pageBeacon });

		const outcomes: string[] = [];

		code.addEventListener("paste", () => {
			fetch("/verify").catch((error: Error) => outcomes.push(`fetch ${error.name}`));

			const xhr = new XMLHttpRequest();
			xhr.addEventListener("error", () => outcomes.push("xhr error"));
			xhr.open("POST", "/verify");
			xhr.send("123");

			outcomes.push(`beacon ${navigator.sendBeacon("/verify")}`);
		});

		try {
			const { fields } = await inspect();

			expect(sent).toEqual([]);
			expect(fields[0]?.suppressed).toEqual(["request"]);
			// The page is told its requests failed, so it does not wait on them for ever.
			expect(outcomes.sort()).toEqual(["beacon true", "fetch AbortError", "xhr error"]);

			expect(window.fetch).toBe(pageFetch);
			expect(XMLHttpRequest.prototype.send).toBe(pageSend);
			expect(navigator.sendBeacon).toBe(pageBeacon);
		} finally {
			window.fetch = nativeFetch;
			XMLHttpRequest.prototype.send = nativeSend;
			delete (navigator as unknown as Record<string, unknown>).sendBeacon;
		}
	});

	it("does not count what putting a value back sets off", async () => {
		const { form, code } = codeForm();
		code.value = "246810";

		// Verifies whenever the field holds six digits, which it does again once it is restored.
		code.addEventListener("input", () => {
			if (code.value.length === 6) {
				form.requestSubmit();
			}
		});
		code.addEventListener("paste", (event) => {
			event.preventDefault();
			code.value = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
		});

		const { fields } = await inspect();

		expect(fields[0]).toMatchObject({ handled: true, suppressed: [] });
		expect(code.value).toBe("246810");
	});

	it("returns focus to where it was when the page moves it while handling the paste", async () => {
		document.body.innerHTML = `
			<button id="resend">Send again</button>
			<input id="d1" maxlength="1"><input id="d2" maxlength="1">
			<input id="d3" maxlength="1"><input id="d4" maxlength="1">
		`;
		const boxes = ["d1", "d2", "d3", "d4"].map(input);
		const resend = document.getElementById("resend") as HTMLButtonElement;

		boxes[0]?.addEventListener("paste", (event) => {
			event.preventDefault();
			boxes.forEach((box, i) => {
				box.value = String(i);
			});
			boxes[3]?.focus();
		});

		resend.focus();
		await inspect();

		expect(document.activeElement).toBe(resend);
	});
});

describe("inspectAuthFieldsScript: read-only fields", () => {
	it("notes a field that a focus handler unlocks, and locks it again", async () => {
		document.body.innerHTML = `<form><input id="password" type="password" readonly></form>`;
		const field = input("password");

		field.addEventListener("focus", () => {
			field.readOnly = false;
		});

		const { fields } = await inspect();

		expect(fields[0]).toMatchObject({ readonlyUntilFocus: true, blocked: [] });
		expect(field.readOnly).toBe(true);
		expect(document.activeElement).toBe(document.body);
	});

	it("still checks pasting into a field once it has unlocked", async () => {
		document.body.innerHTML = `<form><input id="password" type="password" readonly></form>`;
		const field = input("password");

		field.addEventListener("focus", () => {
			field.readOnly = false;
		});
		field.addEventListener("paste", (event) => event.preventDefault());

		expect((await inspect()).fields[0]).toMatchObject({
			readonlyUntilFocus: true,
			blocked: ["paste"],
		});
	});

	it("does not paste into a field that stays read-only", async () => {
		document.body.innerHTML = `<form><input id="password" type="password" readonly></form>`;
		let pastes = 0;

		input("password").addEventListener("paste", () => pastes++);

		const { fields } = await inspect();

		expect(fields[0]).toMatchObject({ readonlyUntilFocus: false, blocked: [], handled: false });
		expect(pastes).toBe(0);
	});
});
