import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/adaptors/puppeteer.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	// pixelmatch/pngjs (deps) and puppeteer (peer) stay external.
});
