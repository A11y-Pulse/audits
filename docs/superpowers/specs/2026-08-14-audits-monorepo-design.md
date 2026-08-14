# Audits monorepo conversion

## Problem

`A11y-Pulse/focus-appearance-audit` is a single-package repo. The coverage roadmap has a family of source-available behavioural audits (skip-link, reflow, text-spacing, keyboard-trap, orientation, and others) that were each specified as their own GitHub repo plus npm package. That does not scale: CI, Biome, Vitest, release automation, npm Trusted Publisher, and community files would be duplicated per audit, and sharing `@a11y-pulse/browser-adaptor` across separate repos is worse than sharing it in one workspace.

## Goals

- Convert the renamed `A11y-Pulse/audits` repo into an npm-workspaces monorepo whose first package is the existing `@a11y-pulse/focus-appearance-audit`.
- Preserve the published package contract so the A11y Pulse runner does not need a lockfile bump for this conversion.
- Replace Release Drafter with Changesets so later packages can version independently.
- Leave a documented, copyable shape for the next public audit (skip-link).

## Non-goals

- Extracting `@a11y-pulse/browser-adaptor` (skip-link, the second consumer, extracts it).
- Adding skip-link or any other audit in this conversion.
- Moving private/static/platform work into this repo (Tier 0 statics, iframe injection, state explorer, Tier 3 site-level aggregation, Tier 4 AI). Those stay in `a11y-pulse`.
- A mega-package (`@a11y-pulse/audits/focus-appearance`). Each audit remains its own npm package.
- Publishing a new npm version as part of the conversion.
- Renaming the local checkout directory (`~/dev/a11y-pulse/focus-appearance-audit` may stay).
- Changing audit behaviour, public API, or detection heuristics.

## Already done

- GitHub repo renamed `A11y-Pulse/focus-appearance-audit` → `A11y-Pulse/audits` (old URLs redirect).
- npm Trusted Publisher on `@a11y-pulse/focus-appearance-audit` updated: Organization `A11y-Pulse`, Repository `audits`, Workflow filename `release.yml`.

## Scope of what lives here

This repo holds **source-available npm audit packages** under PolyForm Shield, plus shared tooling. It does not hold:

- Runner wrappers, audit short names, `helpUrl` marketing docs, or changelog entries for the SaaS product (those stay in `a11y-pulse`).
- Heuristic checks judged not worth packaging (orphaned tabs, filename-as-alt, generic link text, visible `aria-hidden`, keyboard-reachability, uncalibrated focus-order).
- Platform features that are not packages (state explorer, site-level aggregation, AI pipeline).

## Architecture

One git repo, many publishable packages:

```
audits/
  package.json                 private root, workspaces: ["packages/*"]
  biome.json, tsconfig.base.json
  CODE_OF_CONDUCT.md, CONTRIBUTING.md, SECURITY.md
  README.md                    catalogue
  .github/workflows/ci.yml
  .github/workflows/release.yml
  .changeset/config.json
  packages/
    focus-appearance-audit/    @a11y-pulse/focus-appearance-audit
      src/, tests/, examples/, docs/accuracy.md
      README.md, LICENSE.md, CHANGELOG.md
      tsup.config.ts, vitest*.config.ts, tsconfig*.json
```

The runner in `a11y-pulse` keeps consuming published `@a11y-pulse/*-audit` packages from npm. Wrappers stay private.

## Published package contract

The conversion must not change what consumers import. `@a11y-pulse/focus-appearance-audit` keeps:

- Package name
- Exports `"."` and `"./puppeteer"`
- `files`: `dist`, `README.md`, `LICENSE.md`
- Optional `puppeteer` peer dependency
- Public API (`runFocusAppearanceAudit`, `PuppeteerAdaptor`, `BrowserAdaptor`, result types)
- Current `package.json` `version` field (no bump)

Metadata URLs change:

| Field | New value |
| --- | --- |
| `homepage` | `https://github.com/A11y-Pulse/audits/tree/main/packages/focus-appearance-audit#readme` |
| `repository.url` | `git+https://github.com/A11y-Pulse/audits.git` |
| `repository.directory` | `packages/focus-appearance-audit` |
| `bugs.url` | `https://github.com/A11y-Pulse/audits/issues` |

## Shared tooling

Root owns: Biome, `tsconfig.base.json`, Node `>=22`, CI, Changesets, Dependabot, community files.

Hoisted to root `devDependencies`: `@biomejs/biome`, `@tsconfig/node22`, `@types/node`, `tsup`, `typescript`, `vitest`, `@changesets/cli`, `@changesets/changelog-github`.

Stay in the focus-appearance package: `pixelmatch`, `pngjs`, `@types/pngjs`, `happy-dom`, `puppeteer` (dev + optional peer).

Each audit package keeps its own `tsup` config, Vitest configs, PolyForm Shield `LICENSE.md`, README, CHANGELOG, and examples. Package `tsconfig.json` extends `../../tsconfig.base.json`. The Puppeteer example moves to `packages/focus-appearance-audit/examples/puppeteer`; its `file:../..` dependency then correctly points at the package root.

Biome `files.includes` is updated to `packages/*/src/**`, `packages/*/tests/**`, `packages/*/examples/**`, excluding fixture HTML.

## Releases

Release Drafter is removed (`.github/workflows/release-drafter.yml` and `.github/release-drafter.yml`).

Changesets versions each package independently:

1. A PR that should bump a published package includes a changeset (e.g. `"@a11y-pulse/focus-appearance-audit": patch`).
2. `changesets/action` on push to `main` opens a Version PR when changesets exist.
3. Merging the Version PR runs `.github/workflows/release.yml` (filename unchanged; Trusted Publisher is pinned to it), which builds and runs `changeset publish` via OIDC. `NPM_TOKEN` stays empty. Provenance is the npm trusted-publishing default.
4. The action tags/releases per package (e.g. `@a11y-pulse/focus-appearance-audit@0.3.0`).

Tooling-only Dependabot PRs (root TypeScript/Biome) do not need a changeset and must not publish. Dependabot PRs that bump a package's production dependencies (`pixelmatch`, `pngjs`) need a `patch` changeset on that package, added by the reviewer.

When a new package is first published, add a Trusted Publisher on that npm package: Organization `A11y-Pulse`, Repository `audits`, Workflow `release.yml`.

## CI

One workflow, unchanged Node 22/24 matrix, Puppeteer cache keyed on the root lockfile, Ubuntu AppArmor workaround. Root scripts fan out:

- `lint`: Biome at repo root
- `typecheck` / `test:unit` / `build` / `test:integration`: `npm run <script> --workspaces --if-present`

Path filters wait until there are several packages.

## Adding a later audit

Not this conversion. The recipe, for skip-link and friends:

1. Add `packages/<name>-audit` mirroring focus-appearance (adaptor, engine-neutral core, fake-probe unit tests, Puppeteer adaptor, integration fixtures).
2. Add a changeset; first publish also needs a Trusted Publisher entry on the new npm package.
3. In `a11y-pulse`: thin `AuditRunner` wrapper, short name, metadata, `helpUrl` docs page, product changelog. The runner depends on the published semver range, not a workspace path.

`packages/browser-adaptor` is extracted when the second tab-loop consumer lands, as the union of primitives both audits actually call.

## Local git remote

Update the checkout's `origin` to `git@github.com:A11y-Pulse/audits.git`. GitHub redirects the old URL; OIDC and clone docs should use the new name.

## Testing

No new audit behaviour tests. Conversion is verified when:

- `npm run lint`, `npm test` (typecheck + unit), `npm run build`, and `npm run test:integration` pass from the repo root.
- `npm pack` inside `packages/focus-appearance-audit` still produces `@a11y-pulse/focus-appearance-audit` with `dist/`, `README.md`, and `LICENSE.md`.
- Package exports still resolve `"."` and `"./puppeteer"`.
- CI is green on the conversion PR.

## Success criteria

- `A11y-Pulse/audits` is an npm workspaces monorepo with one package, `@a11y-pulse/focus-appearance-audit`.
- Existing unit and integration tests pass.
- Release Drafter is gone; Changesets + `release.yml` is the publish path.
- npm Trusted Publisher still points at repo `audits` and workflow `release.yml`.
- The A11y Pulse runner continues to resolve `@a11y-pulse/focus-appearance-audit` from the registry with no required change for this PR.
- Root README is a catalogue; the package README remains the consumer docs.
