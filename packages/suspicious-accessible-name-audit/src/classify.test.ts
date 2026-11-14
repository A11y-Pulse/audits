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
		hrefHost = null,
	}: {
		source?: NameSource;
		role?: string;
		identifiers?: Identifier[];
		lang?: string;
		hrefHost?: string | null;
	} = {},
) {
	return classifyName({ name, source, role, identifiers, hrefHost }, roleWordsFor(lang));
}

const VISIBLE_SOURCES: NameSource[] = ["content", "label", "aria-labelledby", "value"];

describe("classifyName", () => {
	describe("artefact", () => {
		it.each([
			"undefined",
			"null",
			"NaN",
			"TODO",
			"placeholder",
			"button",
			"Lorem ipsum dolor sit amet",
		])("fails %s from an aria-label", (name) => {
			expect(classify(name)).toEqual({ signal: "artefact", evidence: null, verdict: "failed" });
		});

		// A script writes these in exactly one spelling; in any other they are a name or a word.
		it.each(["Nan", "NAN", "nan", "Null", "NULL", "Undefined"])(
			"passes %s, which no script writes",
			(name) => {
				expect(classify(name)).toBeNull();
			},
		);

		it.each([
			"{{title}}",
			"{{ item.title }}",
			"{% name %}",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: an unrendered template literal is the input under test
			"${label}",
			"<%= title %>",
			"#{name}",
			"[[label]]",
		])("fails a name that is only the template token %s, wherever it comes from", (name) => {
			for (const source of ["aria-label", ...VISIBLE_SOURCES] as NameSource[]) {
				expect(classify(name, { source })).toEqual({
					signal: "artefact",
					evidence: name,
					verdict: "failed",
				});
			}
		});

		it.each(["__TITLE__", "%s"])(
			"fails %s in a hidden attribute and reviews it in visible text",
			(name) => {
				expect(classify(name)?.verdict).toBe("failed");
				expect(classify(name, { source: "content", role: "link" })).toEqual({
					signal: "artefact",
					evidence: name,
					verdict: "review",
				});
			},
		);

		it.each<[string, string]>([
			["Copy {{ name }} snippet", "{{ name }}"],
			["Product {% name %}", "{% name %}"],
			["Go to %s", "%s"],
			["Hello {{ user.name }}!", "{{ user.name }}"],
		])("reviews %s, a token among other words", (name, token) => {
			for (const source of ["aria-label", "content"] as NameSource[]) {
				expect(classify(name, { source })).toEqual({
					signal: "artefact",
					evidence: token,
					verdict: "review",
				});
			}
		});

		it("fails [object Object] from any source, and reviews visible text that mentions it", () => {
			for (const source of ["aria-label", ...VISIBLE_SOURCES] as NameSource[]) {
				expect(classify("[object Object]", { source })).toEqual({
					signal: "artefact",
					evidence: "[object Object]",
					verdict: "failed",
				});
			}

			expect(classify("Open [object Object]")?.verdict).toBe("failed");
			expect(
				classify("Why does my page show [object Object]?", { source: "content", role: "link" })
					?.verdict,
			).toBe("review");
		});

		it.each(["True", "false", "Test", "Label", "Module", "Banner", "Element"])(
			"reviews the ordinary word %s rather than failing it",
			(name) => {
				expect(classify(name)).toEqual({ signal: "artefact", evidence: null, verdict: "review" });
			},
		);

		it("flags a title and a placeholder", () => {
			expect(classify("{{title}}", { source: "title", role: "iframe" })?.signal).toBe("artefact");
			expect(classify("undefined", { source: "placeholder", role: "textbox" })?.signal).toBe(
				"artefact",
			);
		});

		it.each(VISIBLE_SOURCES)("leaves visible words from %s alone", (source) => {
			expect(classify("undefined", { source })).toBeNull();
			expect(classify("null", { source })).toBeNull();
			expect(classify("Test", { source })).toBeNull();
		});

		it("passes names that only contain an artefact word", () => {
			expect(classify("Test drive")).toBeNull();
			expect(classify("Null and void")).toBeNull();
			expect(classify("True or false?")).toBeNull();
		});

		it("passes percentages and prices that are not format tokens", () => {
			expect(classify("Save 50% today")).toBeNull();
			expect(classify("100%")).toBeNull();
			expect(classify("{ }")).toBeNull();
		});
	});

	describe("attribute-match", () => {
		it.each<[string, Identifier]>([
			["quantity-selector", { attribute: "class", value: "quantity-selector" }],
			["Quantity-Selector", { attribute: "class", value: "quantity-selector" }],
			["qtyInput", { attribute: "id", value: "qtyInput" }],
			["field_42", { attribute: "name", value: "field_42" }],
			["add-to-cart", { attribute: "data-testid", value: "add-to-cart" }],
			["add-to-cart", { attribute: "data-cy", value: "add-to-cart" }],
		])("fails %s matching its %o in a hidden attribute", (name, identifier) => {
			expect(
				classify(name, { source: "aria-label", role: "textbox", identifiers: [identifier] }),
			).toEqual({ signal: "attribute-match", evidence: identifier.attribute, verdict: "failed" });
		});

		it.each<NameSource>(["label", "aria-labelledby", "value"])(
			"reviews a separated identifier that is also the visible %s",
			(source) => {
				expect(
					classify("field_42", {
						source,
						role: "textbox",
						identifiers: [{ attribute: "name", value: "field_42" }],
					}),
				).toEqual({ signal: "attribute-match", evidence: "name", verdict: "review" });
			},
		);

		it.each<[string, string]>([
			["2023", "2023"],
			["iPhone", "iPhone"],
			["MP3", "mp3"],
			["Brand", "brand"],
		])("passes the visible label %s generated from the same data as its id", (name, id) => {
			expect(
				classify(name, {
					source: "label",
					role: "checkbox",
					identifiers: [{ attribute: "id", value: id }],
				}),
			).toBeNull();
		});

		it("reviews a visible two-part label that matches the id", () => {
			expect(
				classify("Wi-Fi", {
					source: "label",
					role: "checkbox",
					identifiers: [{ attribute: "id", value: "wi-fi" }],
				}),
			).toEqual({ signal: "attribute-match", evidence: "id", verdict: "review" });
		});

		it("ignores data attributes that hold content rather than a test hook", () => {
			expect(
				classify("Coca-Cola", {
					identifiers: [{ attribute: "data-brand", value: "Coca-Cola" }],
				}),
			).toBeNull();
			expect(
				classify("size-10", {
					identifiers: [{ attribute: "data-value", value: "size-10" }],
				}),
			).toBeNull();
		});

		// The field's own word is its name: `<input name="name" placeholder="Name">`,
		// `<input id="title" aria-label="Title">`, `<iframe class="video" title="Video">`.
		it.each<[string, NameSource, string, Identifier]>([
			["Name", "placeholder", "textbox", { attribute: "name", value: "name" }],
			["Name", "label", "textbox", { attribute: "id", value: "name" }],
			["Title", "aria-label", "textbox", { attribute: "id", value: "title" }],
			["Video", "title", "iframe", { attribute: "class", value: "video" }],
			["Text", "aria-label", "textbox", { attribute: "name", value: "text" }],
			["New", "aria-label", "button", { attribute: "class", value: "new" }],
			["Default", "label", "radio", { attribute: "id", value: "default" }],
			["Item", "aria-label", "option", { attribute: "class", value: "item" }],
			["Image", "title", "img", { attribute: "class", value: "image" }],
		])(
			"passes %s from a %s on a %s whose %o is the same word",
			(name, source, role, identifier) => {
				expect(classify(name, { source, role, identifiers: [identifier] })).toBeNull();
			},
		);

		it("only reviews a review word that is also the id", () => {
			expect(
				classify("banner", {
					source: "aria-label",
					role: "textbox",
					identifiers: [{ attribute: "id", value: "banner" }],
				}),
			).toEqual({ signal: "artefact", evidence: null, verdict: "review" });
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
			"nav.homeTitle",
			"common:buttons.submit",
			"checkout.form.emailLabel",
			"checkout.payment_method.label",
			"errors:validation.required",
		])("reviews %s", (name) => {
			expect(classify(name, { source: "content", role: "link" })).toEqual({
				signal: "identifier-pattern",
				evidence: null,
				verdict: "review",
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
			"example.com",
			"www.example.com",
			"docs.example.co.nz",
			"shop.example.io",
			"node.js",
			"e.g.",
			"v1.2.3",
			"10:30",
			"Note: see below.",
			// Hosts, packages and functions are dotted lower-case words too.
			"servicos.gov.br",
			"sklep.allegro.pl",
			"example.co.za",
			"java.util.concurrent",
			"os.path.join",
			"a.k.a",
			"nav.home.title",
			"my_shop.example.com",
			"app_config.json",
		])("passes %s", (name) => {
			expect(classify(name, { source: "content", role: "link" })).toBeNull();
		});

		it("passes a link named after the host it goes to", () => {
			const link = { source: "content", role: "link" } as const;

			expect(classify("my_shop.example.store", link)?.signal).toBe("identifier-pattern");
			expect(
				classify("my_shop.example.store", { ...link, hrefHost: "my_shop.example.store" }),
			).toBeNull();
			expect(
				classify("my_shop.example.store", { ...link, hrefHost: "www.my_shop.example.store" }),
			).toBeNull();
			expect(
				classify("my_shop.example.store", { ...link, hrefHost: "other.example.store" })?.signal,
			).toBe("identifier-pattern");
		});
	});

	describe("placeholder-suffix", () => {
		it.each(["banner1", "image_2", "btn-3", "item 4", "Slide1"])("reviews %s", (name) => {
			expect(classify(name, { source: "content" })).toEqual({
				signal: "placeholder-suffix",
				evidence: null,
				verdict: "review",
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
			expect(classify(name, { role })).toEqual({
				signal: "role-word",
				evidence: word,
				verdict: "review",
			});
		});

		it("reviews a link named as a button", () => {
			expect(classify("Help button", { role: "link" })).toEqual({
				signal: "role-word",
				evidence: "button",
				verdict: "review",
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

		it("passes an instruction that ends in a verb", () => {
			expect(classify("Please select", { role: "combobox" })).toBeNull();
			expect(classify("Country select", { role: "combobox" })?.signal).toBe("role-word");
		});

		it("leaves visible text alone", () => {
			expect(classify("Report a broken link", { source: "content", role: "link" })).toBeNull();
		});

		it("uses the element's language", () => {
			expect(classify("Stäng knapp", { lang: "sv" })).toEqual({
				signal: "role-word",
				evidence: "knapp",
				verdict: "review",
			});
			expect(classify("Lukk knapp", { lang: "no" })?.evidence).toBe("knapp");
			expect(classify("Close button", { lang: "sv" })).toBeNull();
		});

		it("falls back to English for languages without a list", () => {
			expect(classify("Close button", { lang: "de-AT" })?.signal).toBe("role-word");
		});
	});
});
