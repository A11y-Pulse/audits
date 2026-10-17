import type { PageGroup } from "../expectations";

const HOME = "home.html";

const ABOUT = "about.html";

const CONTACT = "contact.html";

// Site-level audits compare these pages with each other. Each finding is pinned to the page it
// should be reported against.
export const site: PageGroup = {
	name: "site",
	variants: [HOME, ABOUT, CONTACT],
	expectations: [
		{
			scenario: "tab loop reaches the last focusable element",
			audit: "focus-appearance",
			target: "#footer-sitemap",
			outcome: "passes",
		},
		{
			scenario: "skip link moves focus to main",
			audit: "skip-link-activation",
			target: "#skip-link",
			outcome: "passes",
		},
		{
			scenario: "home link marked as the current page",
			audit: "nav-aria-current",
			target: "#nav-home",
			outcome: "passes",
			variants: [HOME],
		},
		{
			scenario: "current page link lacks aria-current",
			audit: "nav-aria-current",
			target: "#nav-about",
			outcome: "violations",
			variants: [ABOUT],
		},
		{
			scenario: "aria-current left on a link to another page",
			audit: "nav-aria-current",
			target: "#nav-about",
			outcome: "violations",
			variants: [CONTACT],
		},
		{
			scenario: "every page shares the home page's title",
			audit: "unique-page-titles",
			outcome: "violations",
			variants: [ABOUT, CONTACT],
		},
		{
			scenario: "main nav links reordered on one page",
			audit: "consistent-navigation",
			target: "#main-nav",
			outcome: "incomplete",
			variants: [CONTACT],
		},
		{
			scenario: "main nav in the site's usual order",
			audit: "consistent-navigation",
			target: "#main-nav",
			outcome: "clean",
			variants: [HOME, ABOUT],
		},
		{
			scenario: "basket icon renamed 'Cart' on one page",
			audit: "consistent-identification",
			target: "#basket-link",
			outcome: "incomplete",
			variants: [CONTACT],
		},
		{
			scenario: "phone number moved above the main content",
			audit: "consistent-help",
			target: "#help-phone",
			outcome: "incomplete",
			variants: [CONTACT],
		},
		{
			scenario: "content page with nav and sitemap but no search",
			audit: "multiple-ways",
			outcome: "passes",
			variants: [ABOUT],
		},
	],
};
