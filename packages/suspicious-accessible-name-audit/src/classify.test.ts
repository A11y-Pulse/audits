import { describe, expect, it } from "vitest";
import type { Identifier, NameSource } from "./browser-scripts";
import { classifyName } from "./classify";
import { roleWordsFor } from "./role-words";

function classify(
	name: string,
	{
		source = "aria-label",
		role = "button",
		identifiers = [],
		lang = "en",
	}: {
		source?: NameSource;
		role?: string;
		identifiers?: Identifier[];
		lang?: string;
	} = {},
) {
	return classifyName({ name, source, role, identifiers }, roleWordsFor(lang));
}

describe("classifyName", () => {
	describe("artefact", () => {
		it.each([
			"undefined",
			"null",
			"NaN",
			"[object Object]",
			"true",
			"TODO",
			"placeholder",
			"button",
			"banner",
			"Lorem ipsum dolor sit amet",
			"{{title}}",
			"Product {% name %}",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: an unrendered template literal is the input under test
			"${label}",
			"<%= title %>",
			"Go to %s",
			"__TITLE__",
			"#{name}",
			"[[label]]",
		])("flags %s from an aria-label", (name) => {
			expect(classify(name)).toEqual({ signal: "artefact", evidence: null });
		});

		it("flags a title and a placeholder", () => {
			expect(classify("{{title}}", { source: "title", role: "iframe" })?.signal).toBe("artefact");
			expect(classify("undefined", { source: "placeholder", role: "textbox" })?.signal).toBe(
				"artefact",
			);
		});

		it.each<NameSource>(["content", "label", "aria-labelledby", "value"])(
			"leaves visible text from %s alone",
			(source) => {
				expect(classify("undefined", { source })).toBeNull();
				expect(classify("Test", { source })).toBeNull();
			},
		);

		it("passes names that only contain an artefact word", () => {
			expect(classify("Test drive")).toBeNull();
			expect(classify("Null and void")).toBeNull();
		});
	});

	describe("attribute-match", () => {
		it.each<[string, Identifier]>([
			["quantity-selector", { attribute: "class", value: "quantity-selector" }],
			["Quantity-Selector", { attribute: "class", value: "quantity-selector" }],
			["qtyInput", { attribute: "id", value: "qtyInput" }],
			["field_42", { attribute: "name", value: "field_42" }],
			["add-to-cart", { attribute: "data-testid", value: "add-to-cart" }],
			["banner", { attribute: "id", value: "banner" }],
		])("flags %s matching its %o", (name, identifier) => {
			expect(
				classify(name, { source: "label", role: "textbox", identifiers: [identifier] }),
			).toEqual({ signal: "attribute-match", evidence: identifier.attribute });
		});

		it("passes a plain word that is also the id", () => {
			expect(
				classify("Search", {
					source: "aria-label",
					identifiers: [{ attribute: "id", value: "search" }],
				}),
			).toBeNull();
			expect(
				classify("Footer", {
					source: "aria-label",
					role: "navigation",
					identifiers: [{ attribute: "id", value: "footer" }],
				}),
			).toBeNull();
		});

		it("leaves a name from content alone", () => {
			expect(
				classify("sign-up", {
					source: "content",
					role: "link",
					identifiers: [{ attribute: "class", value: "sign-up" }],
				}),
			).toBeNull();
		});
	});

	describe("identifier-pattern", () => {
		it.each([
			"add-to-cart-button",
			"product-card-cta-2",
			"product_card_cta",
			"main_nav",
			"addToCartButton",
			"AddToCartButton",
			"openMenuToggle3",
		])("reviews %s", (name) => {
			expect(classify(name, { source: "content", role: "link" })).toEqual({
				signal: "identifier-pattern",
				evidence: null,
			});
		});

		it.each([
			"e-mail",
			"check-in",
			"T-shirt",
			"iPhone",
			"eBay",
			"macOS",
			"iOS",
			"PayPal",
			"YouTube",
			"PlayStation",
			"PlayStation 5",
			"NX-500",
			"A-1234",
			"X-T5",
			"B2B",
			"MP3",
			"CO2",
			"Google Play",
		])("passes %s", (name) => {
			expect(classify(name, { source: "content", role: "link" })).toBeNull();
		});
	});

	describe("placeholder-suffix", () => {
		it.each(["banner1", "image_2", "btn-3", "item 4", "Slide1"])("reviews %s", (name) => {
			expect(classify(name, { source: "content" })).toEqual({
				signal: "placeholder-suffix",
				evidence: null,
			});
		});

		it.each(["Formula 1", "Area 51", "H2", "banner 2024", "Chapter 3"])("passes %s", (name) => {
			expect(classify(name, { source: "content" })).toBeNull();
		});
	});

	describe("role-word", () => {
		it.each<[string, string, string]>([
			["Disclaimer button", "button", "button"],
			["custom checkbox", "checkbox", "checkbox"],
			["Subscribe check box", "checkbox", "check box"],
			["Email input", "textbox", "input"],
			["Quantity field", "spinbutton", "field"],
			["Settings tab", "tab", "tab"],
			["Sign in modal.", "dialog", "modal"],
		])("reviews %s on a %s", (name, role, word) => {
			expect(classify(name, { role })).toEqual({ signal: "role-word", evidence: word });
		});

		it("reviews a link named as a button", () => {
			expect(classify("Help button", { role: "link" })).toEqual({
				signal: "role-word",
				evidence: "button",
			});
		});

		it("passes role words that belong to another role", () => {
			expect(classify("Open menu", { role: "button" })).toBeNull();
			expect(classify("Copy link", { role: "button" })).toBeNull();
			expect(classify("Close dialog", { role: "button" })).toBeNull();
		});

		it("passes a role word that is not at the end", () => {
			expect(classify("Button settings", { role: "button" })).toBeNull();
		});

		it("leaves visible text alone", () => {
			expect(classify("Report a broken link", { source: "content", role: "link" })).toBeNull();
		});

		it("uses the element's language", () => {
			expect(classify("Stäng knapp", { lang: "sv" })).toEqual({
				signal: "role-word",
				evidence: "knapp",
			});
			expect(classify("Lukk knapp", { lang: "no" })?.evidence).toBe("knapp");
			expect(classify("Close button", { lang: "sv" })).toBeNull();
		});

		it("falls back to English for languages without a list", () => {
			expect(classify("Close button", { lang: "de-AT" })?.signal).toBe("role-word");
		});
	});
});
