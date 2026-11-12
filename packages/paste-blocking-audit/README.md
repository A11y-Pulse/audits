# @a11y-pulse/paste-blocking-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/paste-blocking-audit)](https://www.npmjs.com/package/@a11y-pulse/paste-blocking-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit for [**WCAG 2.2: 3.3.8 Accessible Authentication (Minimum)**](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum) (Level AA). Remembering a password or copying a code from one place to another is a cognitive function test, and a sign-in that depends on one must offer a way around it. For most sites that way is a password manager, or copy and paste. The audit finds the page's password, username and one-time-code fields and checks that nothing keeps a password manager or a paste out of them: an `onpaste="return false"`, a script that cancels the paste, a code split into boxes that takes one character of a pasted code, or `autocomplete` switched off.

Static analysis cannot see any of this. A paste handler added with `addEventListener` leaves no trace in the markup, so the audit pastes into each field and watches what the page does.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/paste-blocking-audit @a11y-pulse/browser-adaptor puppeteer
```

## Quickstart

```js
import { runPasteBlockingAudit } from "@a11y-pulse/paste-blocking-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://example.com/sign-in");

const result = await runPasteBlockingAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
// { checked: 2, failed: 1, needsReview: 0, passed: 1, unchecked: 0 }

console.log(result.failed);
// [
//   {
//     selector: "#password",
//     html: '<input id="password" type="password" name="password" onpaste="return false">',
//     kind: "password",
//     signals: ["paste-blocked"],
//     blocked: ["paste"],
//     detectedBy: "inline-handler",
//     autocomplete: null,
//     boxes: null
//   }
// ]

await browser.close();
```

A page with no authentication fields returns `summary.checked: 0`, which is inapplicable.

## How it decides

### Which fields are checked

Every rendered, enabled text-entry `<input>`, including those in open shadow roots, is considered in one call into the page:

| Kind | When |
| --- | --- |
| `password` | An `<input type="password">` |
| `new-password` | A password field in a form with two or more of them, or one with `autocomplete="new-password"` outside a sign-in form |
| `username` | A text, email or telephone field in the same form as a password field, when it is `type="email"`, has an `autocomplete` of `username`, `email` or `tel`, or its name, id, label or placeholder mentions a user name, email, login, account or phone |
| `one-time-code` | A field with `autocomplete="one-time-code"`; a field whose name, id, label or placeholder says OTP, one-time, verification code, passcode, 2FA, MFA, authentication code or "6-digit code"; a numeric field (`inputmode="numeric"`, `type="number"` or `"tel"`, or a digit `pattern`) that says "code"; or a run of four or more consecutive one-character boxes (`maxlength="1"`), reported at its first box |

Postcodes, promo, voucher and country codes, card security codes (`autocomplete="cc-…"`) and the like are not one-time codes. A field with no `<form>` is grouped by its nearest `fieldset`, dialog, `section` or `main`. A sign-in form is one whose only password field sits beside a button reading "Sign in" or "Log in".

### How a paste is tried

For each field the audit dispatches, in order, a Ctrl+V and a Cmd+V `keydown`, a `beforeinput` event with `inputType: "insertFromPaste"`, and a `paste` event carrying text in its `clipboardData`. These are synthetic events: the browser inserts nothing for them, and the system clipboard is never read or written.

- An event the page cancels, with nothing written into the field in the next 150ms, is a refusal. It is recorded in `blocked` as `shortcut`, `beforeinput` or `paste`.
- An event the page cancels and then writes the text in itself, as a handler that trims whitespace or spreads a code across boxes does, is not a refusal. The audit puts the previous value back and announces it with an `input` event, so a framework holding the value in state follows. A page that only empties the field has not taken the paste, and is still a refusal.
- The fields are looked at once more 300ms after the last paste. A value that has turned up by then is put back, and the field is no longer counted as refusing: the page took the paste, only slowly.
- A refusal is tried once more with the field focused before it is believed, since a handler that inserts through the selection (`document.execCommand("insertText")`) only reaches the focused field. No other field is focused, so blur validation is not set off on fields that behave.
- A `readonly` field is focused to see whether a handler unlocks it. One that unlocks is pasted into and locked again; one that stays read-only is left alone.

`detectedBy` is `inline-handler` when the field or an ancestor has an `onpaste` attribute, and `event-listener` otherwise.

### What is pasted

The text is shaped to the field, so that a field is not blamed for turning away text of the wrong kind:

| Field | Text pasted |
| --- | --- |
| Password | `Probe-4f9a-Paste`, cut to the field's `maxlength` |
| Username | `probe@example.com`, or `5550100` in a telephone or numeric field, cut to `maxlength` |
| One-time code, or a numeric password such as a PIN | Digits, **one fewer than the field takes**. The length comes from the number of boxes, `maxlength`, a `pattern` such as `\d{6}`, or wording such as "6-digit code"; with none of those, three digits are pasted |

A code is never pasted whole, because a page may verify a code the moment the field is full, and a wrong code sent to the server uses up an attempt or locks the account. `partialProbe` is true on these fields. The cost is that a page which cancels the paste of anything but a whole code looks the same as one that cancels every paste, so a cancelled paste on such a field is the review signal `partial-paste-refused` rather than `paste-blocked`.

### Nothing is submitted or sent

A page that reacts to a paste by submitting or verifying would otherwise act on the audit's text. From the first paste until every value is back in place, the audit therefore:

- cancels every `submit` event before the page's own handlers see it, and replaces `HTMLFormElement.prototype.submit` and `requestSubmit` with functions that do nothing;
- replaces `fetch` with a function that rejects with an `AbortError`, `XMLHttpRequest.prototype.send` with one that fires `error`, and `navigator.sendBeacon` with one that sends nothing.

All of these are put back when the audit finishes, including when it throws. Whatever the page tried and was stopped from doing in response to a field's paste is listed in that field's `suppressed`, as `submit` or `request`. Focus, and the selection in the focused field, are returned to where they were.

### Signals

| Signal | Bucket | When |
| --- | --- | --- |
| `paste-blocked` | `failed` | The page cancels the `paste` event and the field stays unchanged |
| `partial-paste-refused` | `needsReview` | The same, on a one-time code or numeric PIN, which is pasted a digit short. The page may only be turning away a code of the wrong length |
| `paste-may-be-blocked` | `needsReview` | The page cancels the paste key press or the `beforeinput` event, but not the `paste` event. A digits-only key filter that forgets modifier keys does this: Ctrl+V does nothing, while the context menu and a password manager still work |
| `split-code-paste-unhandled` | `needsReview` | A code split into one-character boxes neither cancels the paste nor fills its boxes, so a pasted code is cut to its first character |
| `readonly-until-focus` | `needsReview` | The field is `readonly` until focused, a trick for keeping autofill out |
| `autocomplete-off` | `needsReview` | `autocomplete="off"` on the field, or on its form when the field has none. Browsers ignore it for sign-in fields, but some password managers honour it, and it is sometimes legitimate |
| `new-password-on-sign-in` | `needsReview` | The password field of a sign-in form has `autocomplete="new-password"`, so a password manager suggests a new password instead of filling the saved one |
| `no-autofill-hint` | `needsReview` | A one-time-code field in a single box has no `autocomplete="one-time-code"`, so the browser does not offer the code from a text message |

`signals` lists every signal that applies, most serious first, and the first decides the bucket. A missing show-password button is not reported: it helps, but the criterion does not ask for it.

### `failed` is not always a WCAG failure

A field that blocks pasting fails 3.3.8 only when the page offers no other way to sign in that needs nothing remembered or transcribed, such as a passkey, an emailed link or a third-party sign-in. The audit cannot see those, particularly when they sit on a later step. `failed` therefore means "nothing can be pasted into this field", which is a failure on the usual password-only sign-in. The A11y Pulse audit runner reports both `failed` and `needsReview` in `incomplete` for this reason, with blocked fields listed first.

## Browser support

| Adaptor | Browser | Supported |
| --- | --- | --- |
| Puppeteer | Chrome | Yes |
| Playwright | Chromium | Yes |
| Playwright | WebKit | Yes |
| Playwright | Firefox | Yes |

## Adaptor requirements

The audit uses `evaluate`, `evaluateHandle` and `disposeRef` to inspect the page and build selectors, and calls `ensureFocusReporting` first, so that focusing a field fires its handlers when the page is not in the foreground. It presses no keys and takes no screenshots.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `fieldLimit` | `number` | `50` | Max authentication fields to inspect. Fields past the limit are counted in `summary.unchecked`. |
| `reportLimit` | `number` | `10` | Max fields to list in each of `failed`, `needsReview` and `passed`. The summary still counts every field. |

## Result shape

```ts
type PasteBlockingField = {
  /** For a split code, its first box. */
  selector: string;
  /** Truncated opening tag, with any typed value redacted. */
  html: string;
  kind: "password" | "new-password" | "username" | "one-time-code";
  /** Every signal that applies, most serious first. Empty when the field passes. */
  signals: (
    | "paste-blocked"
    | "partial-paste-refused"
    | "paste-may-be-blocked"
    | "split-code-paste-unhandled"
    | "readonly-until-focus"
    | "autocomplete-off"
    | "new-password-on-sign-in"
    | "no-autofill-hint"
  )[];
  /** What the page cancelled while leaving the field unchanged. */
  blocked: ("paste" | "beforeinput" | "shortcut")[];
  /** Where the refusal came from, or null when nothing was refused. */
  detectedBy: "inline-handler" | "event-listener" | null;
  /** The field's `autocomplete`, or its form's. Null if unset. */
  autocomplete: string | null;
  /** How many one-character boxes a split code has, or null. */
  boxes: number | null;
  /** The text pasted was a digit short of what the field takes, as for a code or PIN. */
  partialProbe: boolean;
  /** What the page tried to do in response to the paste and was stopped from doing. */
  suppressed: ("submit" | "request")[];
};

type PasteBlockingResult = {
  failed: PasteBlockingField[];
  needsReview: PasteBlockingField[];
  passed: PasteBlockingField[];
  summary: {
    checked: number;
    failed: number;
    needsReview: number;
    passed: number;
    unchecked: number;
  };
};
```

`classifyField(field)`, the pure classifier behind the audit, returns the `signals` and a `verdict` of `"failed"`, `"review"` or null for an inspected field.

## Limitations

- **Synthetic events only.** The pasted events are not trusted, so a handler that checks `event.isTrusted` before cancelling is missed, and nothing confirms the result with a real paste: the adaptor has no paste primitive that leaves the system clipboard alone.
- **Clearing the field after the paste is missed.** A page that lets the paste through and then empties the field on `input` or `change` passes, because a synthetic paste inserts nothing for it to clear.
- **Password managers are not run.** `readonly-until-focus`, `autocomplete-off` and the other autofill signals are known ways of keeping one out, not an observation of one failing, which is why they are only reviewed.
- **Other ways to sign in are not looked for.** See [`failed` is not always a WCAG failure](#failed-is-not-always-a-wcag-failure).
- **`<input>` only.** Contenteditable fields and custom controls that draw their own text entry are not inspected, nor is a split code built without `maxlength="1"`.
- **English wording.** One-time-code and username fields are recognised by English words in their name, id, label or placeholder, and sign-in forms by an English button. `autocomplete` values and `type="password"` work in any language.
- **Dropping text is not tried.** Sites that block paste often block drop as well, but pages also cancel `drop` for unrelated reasons, so it says little.
- **Main document only.** Fields inside iframes, which is where many embedded sign-in widgets live, and closed shadow roots are not reached.
- **A whole code is never tried.** Because a code is pasted a digit short, a field that refuses every paste and one that refuses only an incomplete code both land in `needsReview` as `partial-paste-refused`.
- **Only the usual ways of sending are stopped.** Form submission, `fetch`, `XMLHttpRequest` and `sendBeacon` are held back while fields are pasted into. A page that sends pasted text some other way, over a WebSocket, by setting an image's `src` or by assigning `location`, is not stopped, though it would be sending an incomplete code. A page whose request was stopped sees it fail and may show its own error message.
- **A value written very late is missed.** A page that writes the pasted text in more than about 300ms after the last field was pasted into, as one waiting on a slow network call might, is past the final check: its field is reported as refusing and is left holding the audit's text.
- **The page is touched lightly.** A field is focused, and then blurred, only when it is `readonly` or refused a paste, and focus is then returned to where it was. A value the page wrote in response to a paste is put back and announced with an `input` event, which the page's own validation may react to.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in.

In the A11y Pulse audit runner, both `failed` and `needsReview` are reported in `incomplete`.

- **A site with a passkey or emailed-link sign-in** (`failed`). Blocking paste on the password field is then poor practice rather than a 3.3.8 failure.
- **A paste handler that writes the text in very late, or not from the event** (`failed`). A handler that cancels the paste and inserts the text after a slow network call, later than the final check, or reads `navigator.clipboard` instead of the event, looks like a refusal.
- **A code field that takes only a whole code** (`needsReview`). A handler that cancels the paste of anything but a complete code refuses the audit's shortened one, and is reported as `partial-paste-refused`.
- **A numeric "security code" that is a card's** (`needsReview`). Without `autocomplete="cc-csc"` or a mention of the card, a numeric field labelled "Security code" is taken for a one-time code and reported for its missing autofill hint.
- **One-character boxes that are not a code** (`needsReview`). Four or more consecutive `maxlength="1"` fields, such as the squares of a word game or a date split into digits, are taken for a split code.
- **Deliberate `autocomplete="off"`** (`needsReview`). A one-time recovery code or a field on a shared kiosk may be right to switch autofill off.
- **A key filter with its own paste shortcut handling** (`needsReview`). A field that cancels every key press and reads Ctrl+V from the clipboard API itself is a `paste-may-be-blocked`.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
