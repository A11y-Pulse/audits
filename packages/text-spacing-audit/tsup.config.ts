import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/adaptors/puppeteer.ts"],
	format: ["esm"],
	// TypeScript 7's published package no longer exposes the JS compiler API
	// that tsup's bundled rollup-plugin-dts needs. Emit .d.ts with `tsc` instead
	// (see the `build` script and tsconfig.build.json).
	dts: false,
	clean: true,
	sourcemap: true,
	// puppeteer (peer) stays external.
});
