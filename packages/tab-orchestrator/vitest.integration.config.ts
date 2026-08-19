import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		include: ["tests/integration/**/*.test.ts"],
		environment: "node",
		testTimeout: 60_000,
		hookTimeout: 120_000,
		fileParallelism: false,
		passWithNoTests: true,
	},
});
