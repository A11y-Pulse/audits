import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			"@a11y-pulse/tab-orchestrator/puppeteer": new URL(
				"../tab-orchestrator/src/adaptors/puppeteer.ts",
				import.meta.url,
			).pathname,
			"@a11y-pulse/tab-orchestrator": new URL(
				"../tab-orchestrator/src/index.ts",
				import.meta.url,
			).pathname,
		},
	},
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
		environment: "node",
	},
});
