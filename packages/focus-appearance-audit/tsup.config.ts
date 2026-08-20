import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	// TypeScript 7's published package no longer exposes the JS compiler API
	// that tsup's bundled rollup-plugin-dts needs. Emit .d.ts with `tsc` instead
	// (see the `build` script and tsconfig.build.json).
	dts: false,
	clean: true,
	sourcemap: true,
	// pixelmatch/pngjs and @a11y-pulse/tab-orchestrator (deps) stay external.
});
