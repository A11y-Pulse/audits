import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const PACKAGES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const TEST_TIMEOUT_MS = 60_000;

const HOOK_TIMEOUT_MS = 120_000;

type PackageJson = {
	name?: string;
	exports?: Record<string, { source?: string } | string>;
};

function readPackage(name: string): PackageJson | null {
	try {
		return JSON.parse(readFileSync(join(PACKAGES_DIR, name, "package.json"), "utf8"));
	} catch {
		return null;
	}
}

/**
 * Maps every workspace package's import specifiers to its TypeScript source.
 */
export function sourceAliases(): Record<string, string> {
	const entries: [string, string][] = [];

	for (const dir of readdirSync(PACKAGES_DIR)) {
		const pkg = readPackage(dir);

		if (!pkg?.name || !pkg.exports) {
			continue;
		}

		for (const [subpath, target] of Object.entries(pkg.exports)) {
			const source = typeof target === "string" ? undefined : target.source;

			if (!source) {
				continue;
			}

			const specifier = subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
			entries.push([specifier, join(PACKAGES_DIR, dir, source)]);
		}
	}

	// Vite matches a string alias against the specifier and everything under it, so a bare package
	// name would otherwise swallow its own subpaths. Longest first puts each subpath ahead of it.
	entries.sort(([a], [b]) => b.length - a.length);

	return Object.fromEntries(entries);
}

// The "source" export condition is a tsc-only resolution, and a package's internal imports of its
// siblings resolve through node_modules symlinks. Aliasing both to source keeps a run off a
// possibly-stale dist/ without needing `npm run build` first.
const sourceResolution = {
	tsconfigPaths: true,
	alias: sourceAliases(),
} as const;

/**
 * Builds the Vitest config each package's unit suite runs under.
 */
export function unitConfig() {
	return defineConfig({
		resolve: sourceResolution,
		test: {
			include: ["src/**/*.test.{ts,tsx}"],
			environment: "node",
		},
	});
}

/**
 * Builds the Vitest config each package's integration suite runs under.
 */
export function integrationConfig() {
	return defineConfig({
		resolve: sourceResolution,
		test: {
			include: ["tests/integration/**/*.test.ts"],
			environment: "node",
			testTimeout: TEST_TIMEOUT_MS,
			hookTimeout: HOOK_TIMEOUT_MS,
			fileParallelism: false,
		},
	});
}
