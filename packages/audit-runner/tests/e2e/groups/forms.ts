import type { PageGroup } from "../expectations";

const SIGN_IN = "sign-in.html";

const CHECKOUT = "checkout.html";

export const forms: PageGroup = {
	name: "forms",
	variants: [SIGN_IN, CHECKOUT],
	expectations: [
		{
			scenario: "tab loop reaches the last focusable element",
			audit: "focus-appearance",
			target: "#forgot-password",
			outcome: "passes",
			variants: [SIGN_IN],
		},
		{
			scenario: "tab loop reaches the last focusable element",
			audit: "focus-appearance",
			target: "#pay-now",
			outcome: "passes",
			variants: [CHECKOUT],
		},
		{
			scenario: "field with only a title and a placeholder",
			audit: "label-title-only",
			target: "#phone",
			outcome: "violations",
			variants: [CHECKOUT],
		},
		{
			scenario: "plain fields do not change context on focus",
			audit: "context-change-on-focus",
			target: "#email",
			outcome: "passes",
		},
		{
			scenario: "password field that blocks paste and has no autocomplete",
			audit: "accessible-authentication",
			target: "#password",
			outcome: "incomplete",
			variants: [SIGN_IN],
		},
		{
			scenario: "one-time code entry with no autofill hint",
			audit: "accessible-authentication",
			target: "#otp",
			outcome: "incomplete",
			variants: [SIGN_IN],
		},
		{
			scenario: "page with no sign-in",
			audit: "accessible-authentication",
			outcome: "inapplicable",
			variants: [CHECKOUT],
		},
		{
			scenario: "code field labelled only by its placeholder",
			audit: "placeholder-only-label",
			target: "#otp",
			outcome: "violations",
			variants: [SIGN_IN],
		},
		{
			scenario: "visibly labelled email field",
			audit: "placeholder-only-label",
			target: "#email",
			outcome: "clean",
		},
		{
			scenario: "visually hidden label plus placeholder",
			audit: "placeholder-only-label",
			target: "#city",
			outcome: "violations",
			variants: [CHECKOUT],
		},
		{
			scenario: "unassociated text beside a placeholder",
			audit: "placeholder-only-label",
			target: "#postcode",
			outcome: "incomplete",
			variants: [CHECKOUT],
		},
		{
			scenario: "title and placeholder are left to axe",
			audit: "placeholder-only-label",
			target: "#phone",
			outcome: "clean",
			variants: [CHECKOUT],
		},
		{
			scenario: "single field named by its fieldset legend",
			audit: "placeholder-only-label",
			target: "#promo-code",
			outcome: "passes",
			variants: [CHECKOUT],
		},
		{
			scenario: "validation error inserted without a live region",
			audit: "status-messages",
			target: "#email-error",
			outcome: "incomplete",
			variants: [SIGN_IN],
		},
		{
			scenario: "promo confirmation in a status region",
			audit: "status-messages",
			target: "#promo-status",
			outcome: "passes",
			variants: [CHECKOUT],
		},
		{
			scenario: "segmented control built from native radios",
			audit: "unexposed-selected-state",
			target: "#speed-standard",
			outcome: "clean",
			variants: [CHECKOUT],
		},
		{
			scenario: "radio lookalikes drawn with CSS and no roles",
			audit: "unexposed-selected-state",
			target: "#gift-wrap-options",
			outcome: "incomplete",
			variants: [CHECKOUT],
		},
		{
			scenario: "checkbox inside a password form is never changed",
			audit: "context-change-on-input",
			target: "#remember-me",
			outcome: "clean",
			variants: [SIGN_IN],
		},
		{
			scenario: "checkout country select is never changed",
			audit: "context-change-on-input",
			target: "#country",
			outcome: "clean",
			variants: [CHECKOUT],
		},
	],
};
