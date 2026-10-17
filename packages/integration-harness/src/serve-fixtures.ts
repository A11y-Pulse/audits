import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css",
	".html": "text/html",
	".js": "text/javascript",
	".json": "application/json",
	".svg": "image/svg+xml",
	".vtt": "text/vtt",
};

export type RecordedRequest = {
	method: string;
	path: string;
	/** Path of the page that made the request, from its `Referer`, when it sent one. */
	referrer: string | undefined;
};

export type FixtureServer = {
	url: string;
	/** Every request received, in order, including the ones that 404. */
	requests: RecordedRequest[];
	close: () => Promise<void>;
};

/**
 * Serve the files under `dir` over HTTP on a free port, recording every request.
 */
export async function startFixtureServer(dir: string | URL): Promise<FixtureServer> {
	const root = path.resolve(dir instanceof URL ? fileURLToPath(dir) : dir);
	const requests: RecordedRequest[] = [];

	const server = http.createServer(async (req, res) => {
		const { pathname } = new URL(req.url ?? "/", "http://localhost");
		const referer = req.headers.referer;
		requests.push({
			method: req.method ?? "GET",
			path: pathname,
			referrer: referer ? new URL(referer).pathname : undefined,
		});

		let name: string;

		try {
			name = decodeURIComponent(pathname).replace(/^\//, "") || "index.html";
		} catch {
			res.writeHead(400);
			res.end("bad request");

			return;
		}

		// Resolve within the root and reject anything that escapes it.
		const target = path.resolve(root, name);

		if (target !== root && !target.startsWith(root + path.sep)) {
			res.writeHead(403);
			res.end("forbidden");

			return;
		}

		try {
			const body = await readFile(target);
			const contentType = CONTENT_TYPES[path.extname(target)] ?? "application/octet-stream";
			res.writeHead(200, { "Content-Type": contentType });
			res.end(body);
		} catch {
			res.writeHead(404);
			res.end("not found");
		}
	});

	await new Promise<void>((resolve) => server.listen(0, resolve));

	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;

	return {
		url: `http://localhost:${port}`,
		requests,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
