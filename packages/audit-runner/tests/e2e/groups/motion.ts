import { LISTENER_INSPECTION_ENGINES, type PageGroup } from "../expectations";

export const motion: PageGroup = {
	name: "motion",
	variants: ["promotions.html"],
	expectations: [
		{
			scenario: "tab loop reaches the last focusable element",
			audit: "focus-appearance",
			target: "#sort-toggle",
			outcome: "passes",
		},
		{
			scenario: "carousel that changes slide on a timer with nothing to stop it",
			audit: "moving-content",
			target: "#hero-carousel",
			outcome: "violations",
		},
		{
			scenario: "endless ticker with a pause button beside it",
			audit: "moving-content",
			target: "#ticker-window",
			outcome: "passes",
		},
		{
			scenario: "loading spinner in a status region",
			audit: "moving-content",
			target: "#stock-spinner",
			outcome: "clean",
		},
		{
			scenario: "fixed-height offer card cuts its text off at 200% zoom",
			audit: "resize-text",
			target: "#offer-fixed-text",
			outcome: "violations",
		},
		{
			scenario: "min-height offer card grows with its text at 200% zoom",
			audit: "resize-text",
			target: "#offer-grows-text",
			outcome: "clean",
		},
		{
			scenario: "focusable div that handles clicks and keys with no role",
			audit: "control-without-role",
			target: "#gift-tile",
			outcome: "violations",
			engines: LISTENER_INSPECTION_ENGINES,
		},
		{
			scenario: "focusable div with the button role",
			audit: "control-without-role",
			target: "#gift-button",
			outcome: "clean",
		},
		{
			scenario: "every control on the page takes focus",
			audit: "keyboard-reachability",
			outcome: "clean",
		},
		{
			scenario: "disclosure a mouse can open and the keyboard cannot",
			audit: "disclosure-operability",
			target: "#filters-toggle",
			outcome: "violations",
		},
		{
			scenario: "button disclosure that opens from the keyboard and says so",
			audit: "disclosure-operability",
			target: "#sort-toggle",
			outcome: "passes",
		},
		{
			scenario: "page with no sign-in",
			audit: "accessible-authentication",
			outcome: "inapplicable",
		},
	],
};
