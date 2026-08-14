import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = path.resolve(
	fileURLToPath(new URL("../fixtures", import.meta.url)),
);

export type FixtureServer = {
	url: string;
	close: () => Promise<void>;
};

export async function startFixtureServer(): Promise<FixtureServer> {
	const server = http.createServer(async (req, res) => {
		const name = (req.url ?? "/").replace(/^\//, "") || "index.html";

		// Resolve within the fixtures dir and reject anything that escapes it.
		const target = path.resolve(fixturesDir, name);

		if (target !== fixturesDir && !target.startsWith(fixturesDir + path.sep)) {
			res.writeHead(403);
			res.end("forbidden");

			return;
		}

		try {
			const body = await readFile(target);
			res.writeHead(200, { "Content-Type": "text/html" });
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
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
