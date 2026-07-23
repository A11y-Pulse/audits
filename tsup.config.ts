import { defineConfig } from "tsup";

// Build for npm publishing. While the package lives in the monorepo it is
// consumed as source (the `exports` map points at `./src/*.ts` and the runner
// bundles it via tsup `noExternal`), so this build is only exercised to validate
// the publishable artifact ahead of the repo split. Repointing `exports` at this
// `dist` for published consumers is deferred to that split (see the future
// checklist in docs/plans/2026-06-07-focus-appearance-package/1-design.md).
export default defineConfig({
	entry: ["src/index.ts", "src/adaptors/puppeteer.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	// pixelmatch/pngjs (deps) and puppeteer (peer) are left external by default,
	// so the CommonJS pngjs is never bundled (its require() calls would otherwise
	// break in an ESM bundle).
});
