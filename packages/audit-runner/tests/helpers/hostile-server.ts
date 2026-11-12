import http from "node:http";

// How long the history traversal page keeps a stop settling. A run against it needs a longer settle
// delay than this for the wait to count.
export const BACK_SETTLE_MS = 250;

const SKIP_LINK = `<a href="#main">Skip to main content</a>`;

const page = (title: string, body: string): string =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
	`<meta name="viewport" content="width=device-width, initial-scale=1"></head>` +
	`<body>${body}</body></html>`;

const PAGES: Record<string, string> = {
	"/ok.html": page(
		"A page that behaves",
		`${SKIP_LINK}<main id="main" tabindex="-1"><h1>Orders</h1><p><a href="/other.html">Other</a></p></main>`,
	),
	"/other.html": page("Somewhere else", "<main><h1>Somewhere else</h1></main>"),
	// A toolbar that cycles Tab between its own buttons and ignores Escape. A keyboard trap is only
	// ever reported for review, so this page has no failed audit to show for it.
	"/trap.html": page(
		"A page with a keyboard trap",
		`${SKIP_LINK}<main id="main" tabindex="-1"><h1>Editor</h1>` +
			`<div id="toolbar"><button id="bold">Bold</button><button id="italic">Italic</button></div>` +
			`<p><a id="after" href="/other.html">After the toolbar</a></p></main>` +
			`<script>const buttons = [...document.querySelectorAll("#toolbar button")];` +
			`document.getElementById("toolbar").addEventListener("keydown", (event) => {` +
			`if (event.key !== "Tab") return; event.preventDefault();` +
			"buttons[(buttons.indexOf(document.activeElement) + 1) % buttons.length].focus(); });</script>",
	),
	// Focusing the search field leaves the page, the way a badly wired autocomplete does. It sits
	// past the first few tab stops, which the skip link audit tabs through on its own.
	"/nav-on-focus.html": page(
		"Navigates on focus",
		`${SKIP_LINK}<main id="main" tabindex="-1"><h1>Search</h1>` +
			`<nav><a href="#a">Orders</a> <a href="#b">Returns</a> <a href="#c">Account</a></nav>` +
			`<label>Query <input id="jumpy" onfocus="location.href='/other.html'"></label>` +
			`<div id="wide" style="width: 900px; height: 40px; background: #ccc">Wide</div></main>`,
	),
	// The same field, leaving by a history traversal: the one kind of navigation the tab pass
	// cannot cancel in any browser, so the page really does go. A traversal unloads the page when the
	// browser gets round to it, which in Firefox can be after the stop is read. The timer holds the
	// stop's settle open until the page has gone.
	"/back-on-focus.html": page(
		"Goes back on focus",
		`${SKIP_LINK}<main id="main" tabindex="-1"><h1>Search</h1>` +
			`<nav><a href="#a">Orders</a> <a href="#b">Returns</a> <a href="#c">Account</a></nav>` +
			`<label>Query <input id="jumpy" onfocus="history.back(); setTimeout(() => {}, ${BACK_SETTLE_MS})"></label>` +
			`<div id="wide" style="width: 900px; height: 40px; background: #ccc">Wide</div></main>`,
	),
	"/alert-on-focus.html": page(
		"Alerts on focus",
		`${SKIP_LINK}<main id="main" tabindex="-1"><h1>Alerts</h1>` +
			`<button id="noisy" onfocus="alert('Are you sure?')">Delete</button>` +
			`<a id="after" href="/other.html">After the button</a></main>`,
	),
	"/alert-on-load.html": page(
		"Alerts while loading",
		`<main><h1>Welcome</h1></main><script>alert("Welcome!")</script>`,
	),
	// More tab stops than a short run can get through. The first element to take focus tells the
	// server, so a test knows the tab pass is under way.
	"/many-buttons.html": page(
		"Many buttons",
		`${SKIP_LINK}<main id="main" tabindex="-1"><h1>Seat map</h1>` +
			Array.from({ length: 800 }, (_, i) => `<button id="seat-${i}">Seat ${i}</button>`).join(" ") +
			"</main>" +
			`<script>document.addEventListener("focusin", (event) => {` +
			`if (event.target.id.startsWith("seat-")) fetch("/tabbing"); });</script>`,
	),
	// Stops answering shortly after it has loaded: its script never yields again.
	"/blocked.html": page(
		"Blocked",
		"<main><h1>Dashboard</h1><button>Refresh</button></main>" +
			`<script>addEventListener("load", () => setTimeout(() => { for (;;) {} }, 50));</script>`,
	),
	// A same-origin frame with content axe-core fails, and nothing wrong outside it.
	"/framed.html": page(
		"Framed",
		`<main><h1>Embedded form</h1><iframe id="embed" title="Sign-up form" src="/frame-inner.html"></iframe></main>`,
	),
	"/frame-inner.html": page(
		"Sign-up form",
		`<main><h1>Sign up</h1><img id="unlabelled" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA="></main>`,
	),
	// Three requests that never finish, one more than Puppeteer's idle wait tolerates.
	"/never-idle.html": page(
		"Never idle",
		"<main><h1>Live prices</h1></main>" +
			`<script>addEventListener("load", () => { for (let i = 0; i < 3; i++) fetch("/hang?" + i); });</script>`,
	),
};

export type HostileServer = {
	url: string;
	/** Resolves once a request for `pathname` has arrived since the last call for it resolved. */
	requested: (pathname: string) => Promise<void>;
	close: () => Promise<void>;
};

/**
 * Serve the pages a runner has to survive: ones that navigate or raise dialogs when focused, error
 * responses, a non-HTML response, and a page whose network never goes quiet.
 */
export async function startHostileServer(): Promise<HostileServer> {
	const waiting = new Map<string, Array<() => void>>();

	const server = http.createServer((req, res) => {
		const { pathname } = new URL(req.url ?? "/", "http://localhost");
		const html = PAGES[pathname];

		for (const resolve of waiting.get(pathname) ?? []) {
			resolve();
		}

		waiting.delete(pathname);

		if (html !== undefined) {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(html);
		} else if (pathname === "/tabbing") {
			res.writeHead(204);
			res.end();
		} else if (pathname === "/hang") {
			// Never answered: the connection stays open until the server closes.
		} else if (pathname === "/data.json") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ orders: [] }));
		} else if (pathname === "/error") {
			res.writeHead(500, { "Content-Type": "text/html" });
			res.end(page("Server error", "<h1>Something went wrong</h1>"));
		} else {
			res.writeHead(404, { "Content-Type": "text/html" });
			res.end(page("Not found", "<h1>Page not found</h1>"));
		}
	});

	await new Promise<void>((resolve) => server.listen(0, resolve));

	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;

	return {
		url: `http://localhost:${port}`,
		requested: (pathname) =>
			new Promise<void>((resolve) => {
				waiting.set(pathname, [...(waiting.get(pathname) ?? []), resolve]);
			}),
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			}),
	};
}
