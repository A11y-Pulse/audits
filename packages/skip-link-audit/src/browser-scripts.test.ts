// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
	inspectSkipLinkScript,
	restorePageStateScript,
	type SkipLinkInspection,
	takeUnreachableSkipLinkScript,
	UNREACHABLE_MARKER,
} from "./browser-scripts";

const NAV = `<nav><a href="/about">About</a><a href="/blog">Blog</a></nav>`;

function classify(html: string, selector = "a"): SkipLinkInspection {
	document.body.innerHTML = html;

	const { link } = inspectSkipLinkScript(document.querySelector(selector), "classify");

	if (!link) {
		throw new Error("classify mode always describes the element");
	}

	return link;
}

function focusPosition(focus: string, link = "#skip") {
	(document.querySelector(focus) as HTMLElement).focus();

	return inspectSkipLinkScript(document.querySelector(link), "focus").link?.focus.position;
}

beforeEach(() => {
	document.body.innerHTML = "";
	history.replaceState(null, "", location.pathname);
});

describe("inspectSkipLinkScript: which links point into this document", () => {
	it("reads the fragment of an in-page hash link", () => {
		expect(classify(`<a href="#main">Skip to content</a><main id="main"></main>`).fragment).toBe(
			"#main",
		);
	});

	it("reads the fragment of a same-document link written as a full URL", () => {
		const here = location.href.split("#")[0];

		expect(
			classify(`<a href="${here}#main">Skip to content</a><main id="main"></main>`).fragment,
		).toBe("#main");
	});

	it("ignores a fragment on another page or another origin", () => {
		expect(
			classify(`<a href="/elsewhere#main">Skip</a><main id="main"></main>`).fragment,
		).toBeNull();
		expect(
			classify(`<a href="https://other.example/#main">Skip</a><main id="main"></main>`).fragment,
		).toBeNull();
	});

	it("ignores a bare hash and #top, which scroll to the top of the page", () => {
		expect(classify(`<a href="#">Skip</a>`).fragment).toBeNull();
		expect(classify(`<a href="#top">Skip</a>`).fragment).toBeNull();
		expect(classify(`<a href="#TOP">Skip</a>`).fragment).toBeNull();
	});

	it("ignores hash-router and hashbang paths so SPA navigation is not a skip link", () => {
		expect(classify(`<a href="#/home">Skip</a>`).fragment).toBeNull();
		expect(classify(`<a href="#!/route">Skip</a>`).fragment).toBeNull();
	});

	it("ignores elements that are not links", () => {
		expect(classify("<button>Skip to content</button>", "button")).toMatchObject({
			isBody: false,
			fragment: null,
			skipLike: false,
		});
	});

	it("reports the body when there is no element or it is the body", () => {
		document.body.innerHTML = `<a href="#main">Skip</a>`;

		expect(inspectSkipLinkScript(null, "classify").link?.isBody).toBe(true);
		expect(inspectSkipLinkScript(document.body, "classify").link?.isBody).toBe(true);
	});
});

describe("inspectSkipLinkScript: resolving the target", () => {
	it("resolves a target by id and describes it", () => {
		expect(
			classify(`<a href="#main">Skip to content</a>${NAV}<main id="main" tabindex="-1"></main>`)
				.target,
		).toEqual({ selector: "#main", html: `<main id="main" tabindex="-1"></main>`, rendered: true });
	});

	it("resolves a percent-encoded fragment", () => {
		expect(
			classify(`<a href="#contenu%20principal">Skip</a><main id="contenu principal"></main>`).target
				?.html,
		).toBe(`<main id="contenu principal"></main>`);
	});

	it("resolves a legacy <a name> anchor", () => {
		expect(
			classify(`<a href="#content">Skip</a>${NAV}<a name="content"></a>`).target,
		).toMatchObject({ selector: 'a[name="content"]' });
	});

	it("does not resolve to a meta tag or form control that shares the name", () => {
		expect(
			classify(
				`<a href="#description">Skip</a><meta name="description" content="x"><input name="description">`,
			).target,
		).toBeNull();
	});

	it("returns no target when nothing matches", () => {
		expect(classify(`<a href="#main">Skip</a><main id="other"></main>`).target).toBeNull();
	});

	it("reports a target inside a display:none container as not rendered", () => {
		expect(
			classify(`<a href="#main">Skip</a><div style="display: none"><main id="main"></main></div>`)
				.target?.rendered,
		).toBe(false);
	});
});

describe("inspectSkipLinkScript: which fragment links are skip links", () => {
	it("accepts a link to the main landmark whatever its text says", () => {
		expect(classify(`<a href="#m">Zum Hauptteil</a>${NAV}<main id="m"></main>`).skipLike).toBe(
			true,
		);
		expect(classify(`<a href="#m">Contenu</a>${NAV}<div id="m" role="main"></div>`).skipLike).toBe(
			true,
		);
	});

	it("accepts a link to a wrapper around main, or to something inside main", () => {
		expect(
			classify(`<a href="#page">Inhalt</a>${NAV}<div id="page"><main></main></div>`).skipLike,
		).toBe(true);
		expect(
			classify(`<a href="#start">Inhalt</a>${NAV}<main><div id="start"></div></main>`).skipLike,
		).toBe(true);
	});

	it("accepts a link to a heading", () => {
		expect(classify(`<a href="#title">Inhalt</a><h1 id="title">Title</h1>`).skipLike).toBe(true);
	});

	it("accepts a link to an element with a conventional content id when there is no main landmark", () => {
		for (const id of ["content", "main-content", "maincontent", "page-content", "primary"]) {
			expect(
				classify(`<a href="#${id}">Inhalt</a>${NAV}<div id="${id}"><p>Text</p></div>`).skipLike,
				id,
			).toBe(true);
		}
	});

	it("rejects a link that only jumps past other controls", () => {
		expect(
			classify(`<a href="#offers">Offers</a>${NAV}<div id="offers"><p>Text</p></div>`).skipLike,
		).toBe(false);
	});

	it("rejects a menu link whose menu sits further down the page", () => {
		const page = `<a href="#menu">Menu</a><a href="/search">Search</a><a href="/cart">Cart</a>
			<main><h1>Shop</h1></main>`;

		expect(
			classify(`${page}<nav id="menu"><a href="#">Close</a><a href="/a">A</a></nav>`).skipLike,
		).toBe(false);
		// Hidden until `:target` reveals it, so not somewhere a skip link could take focus.
		expect(
			classify(`${page}<div id="menu" style="display: none"><h2>Menu</h2><a href="/a">A</a></div>`)
				.skipLike,
		).toBe(false);
		// Inside main, but still a navigation block.
		expect(
			classify(
				`<a href="#toc">Contents</a>${NAV}<main><nav id="toc"><a href="#one">One</a></nav></main>`,
			).skipLike,
		).toBe(false);
	});

	it("recognises skip wording in each supported language", () => {
		const wording = [
			"Skip to main content",
			"Skip",
			"Skip navigation",
			"Jump to content",
			"Go to main content",
			"Zum Inhalt springen",
			"Direkt zum Hauptinhalt",
			"Zur Hauptnavigation",
			"Navigation überspringen",
			"Aller au contenu",
			"Aller au contenu principal",
			"Passer au contenu",
			"Accéder directement au contenu",
			"Saltar al contenido",
			"Ir al contenido principal",
			"Saltar navegación",
			"Vai al contenuto",
			"Salta al contenuto principale",
			"Ir para o conteúdo",
			"Pular para o conteúdo",
			"Ga naar inhoud",
			"Ga direct naar de inhoud",
			"Naar de hoofdinhoud",
			"Hoppa till innehåll",
			"Till innehållet",
			"Hopp til hovedinnhold",
			"Gå til hovedindhold",
			"Spring til indhold",
			"Siirry sisältöön",
			"Siirry pääsisältöön",
			"Przejdź do treści",
			"Przejdź do głównej treści",
			"Pomiń nawigację",
			"Přeskočit na obsah",
			"Přejít k hlavnímu obsahu",
			"Перейти к содержанию",
			"Перейти к основному содержанию",
			"Пропустить навигацию",
			"本文へスキップ",
			"メインコンテンツへ",
			"跳到主要内容",
			"跳至主要內容",
			"跳过导航",
			"본문 바로가기",
			"메뉴 건너뛰기",
		];

		for (const text of wording) {
			expect(classify(`<a href="#missing">${text}</a>${NAV}`).skipLike, text).toBe(true);
		}
	});

	it("does not find skip wording inside ordinary words or in other 'go to' links", () => {
		const ordinary = [
			"Popular posts",
			"Their albums",
			"Smaller audiences",
			"Springer",
			"Aller au panier",
			"Ir al carrito",
			"Ga naar winkelwagen",
			"Go to checkout",
			"Jump rope",
			"Vai al carrello",
			"Gå til kassen",
			"Перейти к оплате",
			"跳到购物车",
			"Saltare",
			"Skipton",
		];

		for (const text of ordinary) {
			expect(classify(`<a href="#missing">${text}</a>${NAV}`).skipLike, text).toBe(false);
		}
	});

	it("reads skip wording from the text and aria-label, and only whole skip tokens from class and id", () => {
		const page = `${NAV}<div id="c"></div>`;

		expect(classify(`<a href="#c" aria-label="Skip to content">↓</a>${page}`).skipLike).toBe(true);
		expect(classify(`<a href="#c" id="skip-to-content">Contenu</a>${page}`).skipLike).toBe(true);
		expect(classify(`<a href="#c" class="btn skiplink">Contenu</a>${page}`).skipLike).toBe(true);
		expect(classify(`<a href="#c" class="popular">Posts</a>${page}`).skipLike).toBe(false);
		expect(classify(`<a href="#c" id="their-albums">Albums</a>${page}`).skipLike).toBe(false);
		expect(classify(`<a href="#c" class="skipper">Boats</a>${page}`).skipLike).toBe(false);
		expect(classify(`<a href="#c" title="Skip to content">Boats</a>${page}`).skipLike).toBe(false);
	});

	it("accepts skip wording even when the target is missing or right next to the link", () => {
		expect(classify(`<a href="#missing">Skip to content</a>${NAV}`).skipLike).toBe(true);
		expect(
			classify(`<a href="#nav">Skip to navigation</a><nav id="nav"><a href="/">Home</a></nav>`)
				.skipLike,
		).toBe(true);
		expect(classify(`<a class="skip-link" href="#c">Contenu</a><div id="c"></div>`).skipLike).toBe(
			true,
		);
	});

	it("rejects a menu toggle whose target is the menu right after it", () => {
		expect(
			classify(
				`<a href="#menu">Menu</a><nav id="menu"><a href="/a">A</a><a href="/b">B</a></nav><main></main>`,
			).skipLike,
		).toBe(false);
	});

	it("rejects a fragment link whose target is missing and whose text is not skip wording", () => {
		expect(classify(`<a href="#menu">Menu</a>${NAV}<main></main>`).skipLike).toBe(false);
	});

	it("rejects a link whose target comes before it", () => {
		expect(
			classify(`<h1 id="title">Title</h1>${NAV}<a id="back" href="#title">Title</a>`, "#back")
				.skipLike,
		).toBe(false);
	});

	it("rejects disclosure triggers, tabs and link-shaped buttons even with skip wording", () => {
		const page = `${NAV}<main id="main"></main>`;

		expect(
			classify(`<a href="#main" aria-expanded="false">Skip to content</a>${page}`).skipLike,
		).toBe(false);
		expect(classify(`<a href="#main" role="tab">Skip to content</a>${page}`).skipLike).toBe(false);
		expect(classify(`<a href="#main" role="button">Skip to content</a>${page}`).skipLike).toBe(
			false,
		);
	});

	it("reports the link text, falling back to aria-label", () => {
		expect(classify(`<a href="#main">  Skip to\n content </a>`).linkText).toBe("Skip to content");
		expect(classify(`<a href="#main" aria-label="Skip to content"><svg></svg></a>`).linkText).toBe(
			"Skip to content",
		);
	});
});

describe("inspectSkipLinkScript: where focus is", () => {
	const PAGE = `
		<a id="before" href="/home">Home</a>
		<a id="skip" href="#main">Skip to content</a>
		<a id="between" href="/about">About</a>
		<main id="main" tabindex="-1"><a id="inside" href="/in">Inside</a></main>
		<a id="after" href="/privacy">Privacy</a>`;

	beforeEach(() => {
		document.body.innerHTML = PAGE;
	});

	it("is on the skip link while it still has focus", () => {
		expect(focusPosition("#skip")).toBe("skip-link");
	});

	it("is inside the target when the target or a descendant has focus", () => {
		expect(focusPosition("#main")).toBe("inside-target");
		expect(focusPosition("#inside")).toBe("inside-target");
	});

	it("is after the target when later content has focus", () => {
		expect(focusPosition("#after")).toBe("after-target");
	});

	it("is elsewhere when focus is before the link or between the link and its target", () => {
		expect(focusPosition("#before")).toBe("elsewhere");
		expect(focusPosition("#between")).toBe("elsewhere");
	});

	it("is on the body when nothing has focus", () => {
		expect(
			inspectSkipLinkScript(document.querySelector("#skip"), "focus").link?.focus.position,
		).toBe("body");
	});

	it("is after the link when the link has no target and later content has focus", () => {
		document.body.innerHTML = `
			<a id="before" href="/home">Home</a>
			<a id="skip" href="#gone">Skip to content</a>
			<main tabindex="-1" id="content-area"></main>`;

		expect(focusPosition("#content-area")).toBe("after-link");
		expect(focusPosition("#before")).toBe("elsewhere");
	});

	it("reports whether the URL fragment is the one the link points at", () => {
		const skip = document.querySelector("#skip");

		expect(inspectSkipLinkScript(skip, "focus").link?.focus.navigated).toBe(false);

		location.hash = "#main";

		expect(inspectSkipLinkScript(skip, "focus").link?.focus.navigated).toBe(true);
	});
});

describe("inspectSkipLinkScript: unreachable skip links", () => {
	function unreachable(html: string) {
		document.body.innerHTML = html;

		return inspectSkipLinkScript(null, "unreachable").unreachable;
	}

	const PAGE = `${NAV}<main id="main"></main>`;

	it("reports a display:none skip link", () => {
		expect(
			unreachable(`<a class="skip" href="#main" style="display: none">Skip to content</a>${PAGE}`),
		).toEqual([
			{
				html: `<a class="skip" href="#main" style="display: none"></a>`,
				linkText: "Skip to content",
				fragment: "#main",
				reason: "not-rendered",
			},
		]);
	});

	it("reports skip links that are visibility:hidden, inert or taken out of the tab order", () => {
		expect(
			unreachable(
				`<a href="#main" style="visibility: hidden">Skip to content</a>
				<div inert><a href="#main">Skip to content</a></div>
				<a href="#main" tabindex="-1">Skip to content</a>${PAGE}`,
			).map((link) => link.reason),
		).toEqual(["visibility-hidden", "inert", "negative-tabindex"]);
	});

	it("stays silent about a skip link that can be focused", () => {
		expect(unreachable(`<a href="#main">Skip to content</a>${PAGE}`)).toEqual([]);
	});

	it("stays silent about hidden fragment links that are not skip links", () => {
		expect(
			unreachable(
				`<a href="#main" style="display: none">Contents</a>
				<a href="#main" style="display: none" aria-expanded="false">Skip to content</a>
				<a href="/other#main" style="display: none">Skip to content</a>${PAGE}`,
			),
		).toEqual([]);
	});

	it("stays silent about hidden in-page links whose words only contain skip wording", () => {
		expect(
			unreachable(
				`<ul hidden style="display: none">
					<li><a href="#popular">Popular posts</a></li>
					<li><a href="#albums">Their albums</a></li>
					<li><a href="#basket">Aller au panier</a></li>
				</ul>
				<a href="#main" class="skip-link" style="display: none">Contents</a>
				${NAV}<main id="main"><h2 id="popular">Popular</h2></main>`,
			),
		).toEqual([]);
	});

	it("marks each unreachable link so a handle can be taken to it, then clears the marker", () => {
		unreachable(
			`<a id="one" href="#main" hidden style="display: none">Skip to content</a>
			<a id="two" href="#main" tabindex="-1">Skip to content</a>${PAGE}`,
		);

		expect(takeUnreachableSkipLinkScript()?.id).toBe("one");
		expect(takeUnreachableSkipLinkScript()?.id).toBe("two");
		expect(takeUnreachableSkipLinkScript()).toBeNull();
		expect(document.querySelector(`[${UNREACHABLE_MARKER}]`)).toBeNull();
	});

	it("reports no more links than the limit", () => {
		document.body.innerHTML = `${`<a href="#main" tabindex="-1">Skip to content</a>`.repeat(5)}${PAGE}`;

		expect(inspectSkipLinkScript(null, "unreachable", 2).unreachable).toHaveLength(2);
	});
});

describe("restorePageStateScript", () => {
	it("rewrites the URL in place when following the link added no history entry", async () => {
		const href = location.href;
		const historyLength = history.length;

		history.replaceState(null, "", `${href}#main`);
		await restorePageStateScript({ href, scrollX: 0, scrollY: 0, historyLength });

		expect(location.href).toBe(href);
		expect(history.length).toBe(historyLength);
	});

	it("leaves the page alone when nothing changed", async () => {
		const href = location.href;
		const historyLength = history.length;

		await restorePageStateScript({ href, scrollX: 0, scrollY: 0, historyLength });

		expect(location.href).toBe(href);
		expect(history.length).toBe(historyLength);
	});
});
