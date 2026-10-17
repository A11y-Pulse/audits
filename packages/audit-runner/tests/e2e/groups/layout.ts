import type { PageGroup } from "../expectations";

const FIXED = "fixed-width.html";

const RESPONSIVE = "responsive.html";

const LANDSCAPE = "landscape-only.html";

export const layout: PageGroup = {
	name: "layout",
	variants: [FIXED, RESPONSIVE, LANDSCAPE],
	expectations: [
		{
			scenario: "tab loop reaches the last focusable element",
			audit: "focus-appearance",
			target: "#report-link",
			outcome: "passes",
			variants: [FIXED],
		},
		{
			scenario: "tab loop reaches the last focusable element",
			audit: "focus-appearance",
			target: "#gear-beanie",
			outcome: "passes",
			variants: [RESPONSIVE],
		},
		{
			scenario: "tab loop reaches the last focusable element",
			audit: "focus-appearance",
			target: "#download-gpx",
			outcome: "passes",
			variants: [LANDSCAPE],
		},
		{
			scenario: "nav that script collapses on resize keeps its focus indicator",
			audit: "focus-appearance",
			target: "#nav-huts",
			outcome: "passes",
			variants: [RESPONSIVE],
		},
		{
			scenario: "980px page container",
			audit: "reflow",
			outcome: "violations",
			variants: [FIXED],
		},
		{
			scenario: "fluid layout with a scrolling data table and carousel",
			audit: "reflow",
			outcome: "passes",
			variants: [RESPONSIVE],
		},
		{
			scenario: "fixed-height promo card clips under extra spacing",
			audit: "text-spacing",
			target: "#promo-text",
			outcome: "violations",
			variants: [FIXED],
		},
		{
			scenario: "text already truncated with an ellipsis needs review, never a violation",
			audit: "text-spacing",
			target: "#ellipsis-name",
			outcome: "incomplete",
			variants: [RESPONSIVE],
		},
		{
			scenario: "min-height promo card grows under extra spacing",
			audit: "text-spacing",
			target: "#promo-text",
			outcome: "clean",
			variants: [RESPONSIVE],
		},
		{
			scenario: "white text over a pale photo needs a human",
			audit: "color-contrast",
			target: "#hero-title",
			outcome: "incomplete",
			variants: [FIXED, RESPONSIVE],
		},
		{
			scenario: "white text over a pale photo",
			audit: "text-over-image-contrast",
			target: "#hero-title",
			outcome: "violations",
			variants: [FIXED],
		},
		{
			scenario: "white text over a photo behind a dark scrim",
			audit: "text-over-image-contrast",
			target: "#hero-title",
			outcome: "passes",
			variants: [RESPONSIVE],
		},
		{
			scenario: "unstyled alt text renders near-black on a dark header",
			audit: "alt-text-contrast",
			target: "#header-logo",
			outcome: "violations",
			variants: [FIXED],
		},
		{
			scenario: "header images styled with a light alt text colour",
			audit: "alt-text-contrast",
			target: "#header-logo",
			outcome: "passes",
			variants: [RESPONSIVE],
		},
		{
			scenario: "light grey icon-only dismiss button",
			audit: "non-text-contrast",
			target: "#close-promo",
			outcome: "violations",
			variants: [FIXED],
		},
		{
			scenario: "mid grey icon-only dismiss button",
			audit: "non-text-contrast",
			target: "#close-promo",
			outcome: "passes",
			variants: [RESPONSIVE],
		},
		{
			scenario: "white switch thumb on a pale green track",
			audit: "non-text-contrast",
			target: "#alerts-switch",
			outcome: "violations",
			variants: [RESPONSIVE],
		},
		{
			scenario: "custom checkbox with a light grey border",
			audit: "non-text-contrast",
			target: "#terms-check",
			outcome: "incomplete",
			variants: [RESPONSIVE],
		},
		{
			scenario: "aria-hidden text far below the fold",
			audit: "visible-aria-hidden",
			target: "#shipping-note",
			outcome: "violations",
			variants: [RESPONSIVE],
		},
		{
			scenario: "page rotated in portrait with the rotate property",
			audit: "orientation-lock",
			outcome: "violations",
			variants: [LANDSCAPE],
		},
		{
			scenario: "content available in both orientations",
			audit: "orientation-lock",
			outcome: "passes",
			variants: [RESPONSIVE],
		},
	],
};
