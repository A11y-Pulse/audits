import { DESKTOP, MOBILE, type PageGroup } from "../expectations";

const FLEX = "flex-order.html";

const GRID = "grid-areas.html";

export const reordering: PageGroup = {
	name: "reordering",
	variants: [FLEX, GRID],
	viewports: [DESKTOP, MOBILE],
	expectations: [
		{
			scenario: "tab loop reaches the last focusable element",
			audit: "focus-appearance",
			target: "#related-2",
			outcome: "passes",
			variants: [FLEX],
		},
		{
			scenario: "tab loop reaches the last focusable element",
			audit: "focus-appearance",
			target: "#footer-social",
			outcome: "passes",
			variants: [GRID],
		},
		{
			scenario: "skip link moves focus to the content",
			audit: "skip-link-activation",
			target: "#skip-link",
			outcome: "passes",
		},
		{
			scenario: "layout reflows at 320px",
			audit: "reflow",
			outcome: "passes",
		},
		{
			scenario: "CSS reordering within one screen is left to the CSS audit",
			audit: "focus-order",
			outcome: "clean",
		},
		{
			scenario: "related products moved to a left sidebar with order",
			audit: "css-reordered-focus-order",
			target: "#product-layout",
			outcome: "incomplete",
			variants: [FLEX],
			viewports: [DESKTOP.name],
		},
		{
			scenario: "buy box moved above the gallery with order",
			audit: "css-reordered-focus-order",
			target: "#product-layout",
			outcome: "incomplete",
			variants: [FLEX],
			viewports: [MOBILE.name],
		},
		{
			scenario: "share links reversed with row-reverse",
			audit: "css-reordered-focus-order",
			target: "#share-toolbar",
			outcome: "incomplete",
			variants: [FLEX],
			viewports: [DESKTOP.name],
		},
		{
			scenario: "share links in source order",
			audit: "css-reordered-focus-order",
			target: "#share-toolbar",
			outcome: "clean",
			variants: [FLEX],
			viewports: [MOBILE.name],
		},
		{
			scenario: "section navigation placed in the left column by grid area",
			audit: "css-reordered-focus-order",
			target: "#page-grid",
			outcome: "incomplete",
			variants: [GRID],
			viewports: [DESKTOP.name],
		},
		{
			scenario: "table of contents placed above the article by grid area",
			audit: "css-reordered-focus-order",
			target: "#page-grid",
			outcome: "incomplete",
			variants: [GRID],
			viewports: [MOBILE.name],
		},
		{
			scenario: "footer grid areas that follow the source order",
			audit: "css-reordered-focus-order",
			target: "#footer-grid",
			outcome: "passes",
			variants: [GRID],
		},
	],
};
