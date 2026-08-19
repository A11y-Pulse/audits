import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			// Self-alias so the audit packages' own internal imports of this
			// package (resolved through their node_modules symlink) hit the same
			// fresh source this test file uses, not a possibly-stale dist/.
			"@a11y-pulse/tab-orchestrator/puppeteer": new URL(
				"./src/adaptors/puppeteer.ts",
				import.meta.url,
			).pathname,
			"@a11y-pulse/tab-orchestrator": new URL(
				"./src/index.ts",
				import.meta.url,
			).pathname,
			"@a11y-pulse/focus-appearance-audit": new URL(
				"../focus-appearance-audit/src/index.ts",
				import.meta.url,
			).pathname,
			"@a11y-pulse/focus-not-obscured-audit": new URL(
				"../focus-not-obscured-audit/src/index.ts",
				import.meta.url,
			).pathname,
			"@a11y-pulse/context-change-on-focus-audit": new URL(
				"../context-change-on-focus-audit/src/index.ts",
				import.meta.url,
			).pathname,
		},
	},
	test: {
		include: ["tests/integration/**/*.test.ts"],
		environment: "node",
		testTimeout: 60_000,
		hookTimeout: 120_000,
		fileParallelism: false,
	},
});
