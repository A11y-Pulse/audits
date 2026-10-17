import type { PageGroup } from "../expectations";

const NATIVE = "native.html";

const CUSTOM = "custom.html";

const LOAD_MODAL = "load-modal.html";

export const dialogs: PageGroup = {
	name: "dialogs",
	variants: [NATIVE, CUSTOM, LOAD_MODAL],
	expectations: [
		{
			scenario: "tab loop reaches the last focusable element",
			audit: "focus-appearance",
			target: "#delete-account",
			outcome: "passes",
			variants: [NATIVE],
		},
		{
			scenario: "modal open at load keeps Tab inside it but closes on Escape",
			audit: "keyboard-trap",
			target: "#newsletter",
			outcome: "passes",
			variants: [LOAD_MODAL],
		},
		{
			scenario: "skip link is not the first stop while the load-time modal holds focus",
			audit: "skip-link-activation",
			outcome: "inapplicable",
			variants: [LOAD_MODAL],
		},
		{
			scenario: "load-time modal's own fields are reached by the tab loop",
			audit: "focus-appearance",
			target: "#newsletter-close",
			outcome: "passes",
			variants: [LOAD_MODAL],
		},
		{
			scenario: "focus held inside a modal is not disorder",
			audit: "focus-order",
			outcome: "clean",
			variants: [LOAD_MODAL],
		},
		{
			scenario: "dialog triggers do not change context on focus",
			audit: "context-change-on-focus",
			target: "#open-good",
			outcome: "passes",
			variants: [NATIVE],
		},
		{
			scenario: "modal triggers do not change context on focus",
			audit: "context-change-on-focus",
			target: "#open-trap",
			outcome: "passes",
			variants: [CUSTOM],
		},
		{
			scenario: "text area that swallows Tab is the last stop and still measured",
			audit: "focus-appearance",
			target: "#code-editor",
			outcome: "passes",
			variants: [CUSTOM],
		},
		{
			scenario: "no keyboard trap anywhere on the page",
			audit: "keyboard-trap",
			outcome: "passes",
			variants: [NATIVE],
		},
		{
			scenario: "text area that swallows Tab with no other keyboard exit",
			audit: "keyboard-trap",
			target: "#code-editor",
			outcome: "incomplete",
			variants: [CUSTOM],
		},
		{
			scenario: "native modal dialog",
			audit: "dialog-focus-management",
			target: "#good-dialog",
			outcome: "passes",
			variants: [NATIVE],
		},
		{
			scenario: "native modal whose cancel handler blocks Escape",
			audit: "dialog-focus-management",
			target: "#broken-dialog",
			outcome: "violations",
			variants: [NATIVE],
		},
		{
			scenario: "non-modal date picker that does not trap focus",
			audit: "dialog-focus-management",
			target: "#datepicker",
			outcome: "clean",
			variants: [NATIVE],
		},
		{
			scenario: "custom modal following the APG pattern",
			audit: "dialog-focus-management",
			target: "#apg-modal",
			outcome: "passes",
			variants: [CUSTOM],
		},
		{
			scenario: "custom modal that leaves focus on its trigger",
			audit: "dialog-focus-management",
			target: "#no-focus-modal",
			outcome: "violations",
			variants: [CUSTOM],
		},
		{
			scenario: "custom modal that contains Tab with no way out",
			audit: "dialog-focus-management",
			target: "#trap-modal",
			outcome: "violations",
			variants: [CUSTOM],
		},
		{
			scenario: "custom modal that drops focus to the body on close",
			audit: "dialog-focus-management",
			target: "#no-return-modal",
			outcome: "incomplete",
			variants: [CUSTOM],
		},
		{
			scenario: "custom modal that lets Tab escape to the page",
			audit: "dialog-focus-management",
			target: "#leaky-modal",
			outcome: "incomplete",
			variants: [CUSTOM],
		},
		{
			scenario: "low-contrast answer inside a closed details element",
			audit: "color-contrast",
			target: "#faq-low-contrast",
			outcome: "violations",
			variants: [NATIVE],
			todo: "states opened by activation are not explored",
		},
		{
			scenario: "image with no alt inside an unselected tab panel",
			audit: "image-alt",
			target: "#trip-photo",
			outcome: "violations",
			variants: [NATIVE],
			todo: "states opened by activation are not explored",
		},
		{
			scenario: "button revealing its aria-controls region with no expanded state",
			audit: "disclosure-state-not-exposed",
			target: "#faq-toggle",
			outcome: "violations",
			variants: [NATIVE],
			todo: "states opened by activation are not explored",
		},
	],
};
