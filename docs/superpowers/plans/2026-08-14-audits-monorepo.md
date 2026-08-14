# Audits Monorepo Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `A11y-Pulse/audits` from a single-package repo into an npm-workspaces monorepo whose first package is the existing `@a11y-pulse/focus-appearance-audit`, with Changesets replacing Release Drafter.

**Architecture:** Private root workspace owns shared tooling (Biome, TypeScript, Vitest, Changesets, CI). The focus-appearance package moves to `packages/focus-appearance-audit` with its public API, exports, and version unchanged. `release.yml` stays the Trusted Publisher workflow filename and now publishes via `changeset publish` on merge of a Version PR. No npm publish happens in this conversion.

**Tech Stack:** npm workspaces, Biome, TypeScript, tsup, Vitest, Puppeteer, Changesets, GitHub Actions, npm Trusted Publishing (OIDC).

## Global Constraints

- Package name stays `@a11y-pulse/focus-appearance-audit`.
- Exports stay `"."` and `"./puppeteer"`; `files` stay `dist`, `README.md`, `LICENSE.md`.
- Do not bump `version` and do not add a changeset for this conversion (no publish).
- Do not change audit behaviour or public API.
- Do not extract `@a11y-pulse/browser-adaptor`.
- Do not add skip-link or any other audit.
- Workflow filename must remain `release.yml` (npm Trusted Publisher is pinned to it).
- Node `>=22`. Root is `"private": true`. Package `publishConfig.access` stays `"public"`.
- GitHub repo is already `A11y-Pulse/audits`; Trusted Publisher already points at repository `audits`.
- Working copy path is `/Users/joseph/dev/a11y-pulse/focus-appearance-audit` (local folder name may stay).
- All commands in this plan run from that working copy unless a step says otherwise.

---

## File structure

**Root (shared):**

- Create: `package.json` — private workspace root, fan-out scripts, hoisted tooling + Changesets
- Modify: `biome.json` — `files.includes` cover `packages/*`
- Keep: `tsconfig.base.json`, `.gitignore`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- Modify: `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`
- Create: `README.md` (catalogue; current README moves with the package)
- Create: `.changeset/config.json` (via `npx changeset init`, then edit)
- Modify: `.github/workflows/ci.yml` — same matrix, workspace scripts
- Modify: `.github/workflows/release.yml` — Changesets publish on push to `main`
- Delete: `.github/workflows/release-drafter.yml`, `.github/release-drafter.yml`

**Package (moved, not rewritten):**

- `packages/focus-appearance-audit/` — `src/`, `tests/`, `examples/`, `docs/accuracy.md`, `docs/accuracy/`, `docs/detection-*.svg`, `docs/api/`, `LICENSE.md`, `README.md`, `CHANGELOG.md`, `tsup.config.ts`, `vitest*.config.ts`, `tsconfig.json`, `tsconfig.build.json`, `package.json`
- Modify: `packages/focus-appearance-audit/package.json` — repository metadata; drop hoisted devDependencies
- Modify: `packages/focus-appearance-audit/tsconfig.json` — extend `../../tsconfig.base.json`
- Modify: `packages/focus-appearance-audit/README.md` — CI badge URLs + Releasing section

**Stay at repo root `docs/`:**

- `docs/superpowers/specs/2026-08-14-audits-monorepo-design.md`
- `docs/superpowers/plans/2026-08-14-audits-monorepo.md`

**SaaS repo (separate git repo):**

- Modify: `/Users/joseph/dev/a11y-pulse/a11y-pulse/docs/architecture/README.md` — npm row points at `A11y-Pulse/audits`

---

### Task 1: Workspace root and package move

**Files:**

- Create: `package.json` (root)
- Modify: `biome.json`
- Modify: `packages/focus-appearance-audit/package.json` (after git mv)
- Modify: `packages/focus-appearance-audit/tsconfig.json` (after git mv)
- Keep unchanged after move: `src/`, `tests/`, `examples/`, `tsup.config.ts`, `vitest*.config.ts`, `tsconfig.build.json`

**Interfaces:**

- Consumes: current single-package layout at repo root
- Produces: npm workspaces repo; `@a11y-pulse/focus-appearance-audit` importable from the root install; `npm test` / `npm run test:integration` pass from root

- [ ] **Step 1: Point origin at the renamed GitHub repo**

```bash
git remote set-url origin git@github.com:A11y-Pulse/audits.git
git remote -v
git fetch origin
```

Expected: `origin` fetch/push URLs are `git@github.com:A11y-Pulse/audits.git`. Fetch succeeds (GitHub redirects the old name, but we stop using it).

- [ ] **Step 2: Move the package with git mv so history is preserved**

Do **not** `git mv docs` as a whole — `docs/superpowers/` must stay at the repo root.

```bash
mkdir -p packages/focus-appearance-audit

git mv src tests examples LICENSE.md README.md CHANGELOG.md \
  tsup.config.ts tsconfig.json tsconfig.build.json \
  vitest.config.ts vitest.integration.config.ts package.json \
  packages/focus-appearance-audit/

mkdir -p packages/focus-appearance-audit/docs

git mv docs/accuracy.md docs/accuracy \
  docs/detection-style.svg docs/detection-pixel.svg docs/detection-flow.svg \
  docs/api \
  packages/focus-appearance-audit/docs/
```

Expected: `git status` shows renames into `packages/focus-appearance-audit/`. `docs/superpowers/` is still at the repo root. `tsconfig.base.json`, `biome.json`, community files, and `.github/` are still at the root.

- [ ] **Step 3: Write the private root `package.json`**

Replace the now-moved root `package.json` by creating a new root file. Use the same tooling versions that were in the old package `devDependencies` for Biome / TypeScript / Vitest / tsup / `@tsconfig/node22` / `@types/node`.

Create `/Users/joseph/dev/a11y-pulse/focus-appearance-audit/package.json`:

```json
{
	"name": "@a11y-pulse/audits",
	"private": true,
	"type": "module",
	"engines": {
		"node": ">=22"
	},
	"workspaces": ["packages/*"],
	"scripts": {
		"build": "npm run build --workspaces --if-present",
		"typecheck": "npm run typecheck --workspaces --if-present",
		"lint": "biome check",
		"lint:fix": "biome check --fix",
		"test:unit": "npm run test:unit --workspaces --if-present",
		"test:integration": "npm run test:integration --workspaces --if-present",
		"test": "npm run typecheck && npm run test:unit",
		"release": "changeset publish"
	},
	"devDependencies": {
		"@biomejs/biome": "^2.5.4",
		"@tsconfig/node22": "^22.0.2",
		"@types/node": "^26.1.1",
		"tsup": "^8.5.0",
		"typescript": "^7.0.2",
		"vitest": "^4.1.7"
	}
}
```

Do not add Changesets yet (Task 2). Do not put `"release"` behind a missing binary — adding the script now is fine; `changeset` lands in Task 2.

- [ ] **Step 4: Slim the package `package.json` and fix repository metadata**

Write `packages/focus-appearance-audit/package.json` as the old package file with these changes only:

- `homepage` / `repository` / `bugs` updated as below
- add `"directory": "packages/focus-appearance-audit"` under `repository`
- `devDependencies` keep only package-specific tools (`@types/pngjs`, `happy-dom`, `puppeteer`)
- drop `@biomejs/biome`, `@tsconfig/node22`, `@types/node`, `tsup`, `typescript`, `vitest` (hoisted)
- keep `version` exactly as it is (`0.1.0` today — do not “fix” it to match npm; that drift is out of scope)
- keep `exports`, `files`, `scripts`, `publishConfig`, `dependencies`, `peerDependencies`

```json
{
	"name": "@a11y-pulse/focus-appearance-audit",
	"version": "0.1.0",
	"description": "WCAG 2.4.7 Focus Visible audit that tabs through a page and detects visible focus indicators via computed styles and pixel-diff fallback.",
	"type": "module",
	"license": "SEE LICENSE IN LICENSE.md",
	"author": "A11y Pulse Limited",
	"homepage": "https://github.com/A11y-Pulse/audits/tree/main/packages/focus-appearance-audit#readme",
	"repository": {
		"type": "git",
		"url": "git+https://github.com/A11y-Pulse/audits.git",
		"directory": "packages/focus-appearance-audit"
	},
	"bugs": {
		"url": "https://github.com/A11y-Pulse/audits/issues"
	},
	"keywords": [
		"accessibility",
		"a11y",
		"wcag",
		"focus-visible",
		"focus-appearance",
		"puppeteer",
		"audit"
	],
	"engines": {
		"node": ">=22"
	},
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"import": "./dist/index.js"
		},
		"./puppeteer": {
			"types": "./dist/adaptors/puppeteer.d.ts",
			"import": "./dist/adaptors/puppeteer.js"
		}
	},
	"files": [
		"dist",
		"README.md",
		"LICENSE.md"
	],
	"scripts": {
		"build": "tsup && tsc -p tsconfig.build.json",
		"typecheck": "tsc --noEmit",
		"lint": "biome check",
		"lint:fix": "biome check --fix",
		"test:unit": "vitest run",
		"test:integration": "vitest run --config vitest.integration.config.ts",
		"test": "npm run typecheck && npm run test:unit",
		"prepublishOnly": "npm run build"
	},
	"publishConfig": {
		"access": "public"
	},
	"dependencies": {
		"pixelmatch": "^7.2.0",
		"pngjs": "^7.0.0"
	},
	"peerDependencies": {
		"puppeteer": "^25.3.0"
	},
	"peerDependenciesMeta": {
		"puppeteer": {
			"optional": true
		}
	},
	"devDependencies": {
		"@types/pngjs": "^6.0.5",
		"happy-dom": "^20.9.0",
		"puppeteer": "^25.3.0"
	}
}
```

Leave `examples/puppeteer/package.json` `"file:../.."` as-is. After the move that path is the package root.

- [ ] **Step 5: Point the package tsconfig at the root base**

Write `packages/focus-appearance-audit/tsconfig.json`:

```json
{
	"extends": ["@tsconfig/node22/tsconfig.json", "../../tsconfig.base.json"],
	"compilerOptions": {
		"types": ["node"],
		"lib": ["ES2022", "DOM"]
	},
	"include": ["src", "tests"]
}
```

Leave `tsconfig.build.json` unchanged (it still extends `./tsconfig.json` with `rootDir: "src"`).

- [ ] **Step 6: Update root `biome.json` includes**

Replace the `files.includes` array in `/Users/joseph/dev/a11y-pulse/focus-appearance-audit/biome.json` with:

```json
"includes": [
	"package.json",
	"biome.json",
	"tsconfig*.json",
	"packages/*/package.json",
	"packages/*/src/**/*",
	"packages/*/tests/**/*",
	"!packages/*/tests/integration/fixtures",
	"packages/*/examples/**/*"
]
```

Leave formatter, linter, and javascript settings unchanged.

- [ ] **Step 7: Reinstall and run the existing test cycle**

```bash
rm -rf node_modules packages/focus-appearance-audit/node_modules
npm install
npm run lint
npm test
npm run build
npm run test:integration
```

Expected:

- `npm install` writes a workspace-aware root `package-lock.json` (`packages/focus-appearance-audit` listed as a workspace).
- `lint` exits 0.
- `test` runs typecheck + unit tests for the workspace package and passes (same count as before the move).
- `build` writes `packages/focus-appearance-audit/dist/`.
- `test:integration` launches Chromium and passes.

If lint fails on path-only noise, fix the config, not the audit source.

- [ ] **Step 8: Confirm the published contract still packs**

```bash
cd packages/focus-appearance-audit
npm pack --dry-run
cd ../..
node --input-type=module -e "import { runFocusAppearanceAudit } from '@a11y-pulse/focus-appearance-audit'; import { PuppeteerAdaptor } from '@a11y-pulse/focus-appearance-audit/puppeteer'; console.log(typeof runFocusAppearanceAudit, PuppeteerAdaptor.name)"
```

Expected: tarball name `@a11y-pulse/focus-appearance-audit`, contents include `dist/`, `README.md`, `LICENSE.md`. The node one-liner prints `function PuppeteerAdaptor`.

- [ ] **Step 9: Commit**

```bash
git add -A
git status
git commit -m "$(cat <<'EOF'
Convert the repo into an npm workspaces monorepo.

Move focus-appearance-audit under packages/ so later public audits can share tooling without a new GitHub repo.
EOF
)"
```

Do not commit `node_modules/`, `dist/`, or `*.tgz`.

---

### Task 2: Changesets

**Files:**

- Create: `.changeset/config.json`, `.changeset/README.md` (from `npx changeset init`)
- Modify: root `package.json` — add `@changesets/cli` and `@changesets/changelog-github`
- Modify: `package-lock.json` (via npm install)

**Interfaces:**

- Consumes: workspace root from Task 1
- Produces: `npx changeset status` works; `release` script is `changeset publish`; no changeset file for this conversion

- [ ] **Step 1: Install Changesets at the root**

```bash
npm install -D @changesets/cli @changesets/changelog-github
```

Expected: both packages appear in root `devDependencies`. Lockfile updates.

- [ ] **Step 2: Initialize Changesets and set the GitHub changelog**

```bash
npx changeset init
```

Then overwrite `.changeset/config.json`:

```json
{
	"$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
	"changelog": [
		"@changesets/changelog-github",
		{ "repo": "A11y-Pulse/audits" }
	],
	"commit": false,
	"fixed": [],
	"linked": [],
	"access": "public",
	"baseBranch": "main",
	"updateInternalDependencies": "patch",
	"ignore": [],
	"privatePackages": {
		"version": false,
		"tag": false
	}
}
```

If `npx changeset init` already created a README in `.changeset/`, keep it.

- [ ] **Step 3: Confirm the conversion will not publish**

```bash
npx changeset status
```

Expected: no changesets pending. Do **not** run `npx changeset` to add one. The conversion is tooling-only.

- [ ] **Step 4: Re-run unit tests after the install**

```bash
npm test
```

Expected: PASS (same as Task 1).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .changeset
git commit -m "$(cat <<'EOF'
Add Changesets for independent package releases.

Replace the single-repo Release Drafter versioning model before a second audit lands.
EOF
)"
```

---

### Task 3: CI and release workflows

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Delete: `.github/workflows/release-drafter.yml`
- Delete: `.github/release-drafter.yml`
- Modify: `.github/dependabot.yml` (only if the npm directory entry is not already `"/"`)

**Interfaces:**

- Consumes: root scripts from Task 1; `changeset publish` from Task 2
- Produces: CI runs lint/typecheck/unit/build/integration across workspaces; `release.yml` publishes only when a Version PR is merged

- [ ] **Step 1: Point CI at workspace root scripts**

The current `ci.yml` already runs `npm ci` then `npm run lint`, `typecheck`, `test:unit`, `build`, `test:integration`. Those script names now exist at the root and fan out. Keep the Node 22/24 matrix, Puppeteer cache, and AppArmor workaround.

Write `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node-version: [22, 24]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - name: Cache Puppeteer browser
        uses: actions/cache@v6
        with:
          path: ~/.cache/puppeteer
          key: puppeteer-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - name: Allow Chrome sandbox (Ubuntu 24.04 AppArmor userns restriction)
        run: echo 0 | sudo tee /proc/sys/kernel/apparmor_restrict_unprivileged_userns
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run build
      - run: npm run test:integration
```

- [ ] **Step 2: Replace `release.yml` with Changesets + OIDC**

Keep the filename `release.yml`. Stop triggering on GitHub Release publish. Publish only via `changesets/action` when a Version PR lands on `main`.

Write `.github/workflows/release.yml`:

```yaml
name: Release

# Keep this filename as release.yml — npm Trusted Publisher is configured for it.
on:
  push:
    branches: [main]

concurrency: ${{ github.workflow }}-${{ github.ref }}

permissions:
  contents: write
  pull-requests: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm

      - name: Upgrade npm for OIDC trusted publishing
        run: npm install -g npm@latest

      - run: npm ci

      - name: Clear token auth so OIDC is used
        run: npm config delete "//registry.npmjs.org/:_authToken" || true

      - uses: changesets/action@v1
        with:
          publish: npm run release
          title: Version packages
          commit: Version packages
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ""
```

Because this conversion adds no changeset, the first merge to `main` must **not** publish. `changesets/action` should succeed and report that there are no packages to publish / no Version PR to open.

- [ ] **Step 3: Delete Release Drafter**

```bash
git rm .github/workflows/release-drafter.yml .github/release-drafter.yml
```

- [ ] **Step 4: Confirm Dependabot still targets the root lockfile**

`.github/dependabot.yml` must keep:

```yaml
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
```

Do not add per-package npm entries; the root lockfile is the source of truth. Leave the `github-actions` entry as-is.

- [ ] **Step 5: Close leftover Release Drafter drafts so nobody publishes them**

```bash
gh release list --repo A11y-Pulse/audits
```

If a draft named like the old `v$RESOLVED_VERSION` flow exists, delete it:

```bash
gh release delete <tag> --repo A11y-Pulse/audits --yes --cleanup-tag
```

Only delete **drafts**. Do not delete published tags such as `v0.1.0`.

- [ ] **Step 6: Commit**

```bash
git add .github
git commit -m "$(cat <<'EOF'
Switch CI and publish to the workspaces + Changesets flow.

Keep release.yml as the Trusted Publisher workflow and drop Release Drafter so packages can version independently.
EOF
)"
```

---

### Task 4: Documentation in the audits repo

**Files:**

- Create: `README.md` (root catalogue)
- Modify: `CONTRIBUTING.md`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`
- Modify: `packages/focus-appearance-audit/README.md`

**Interfaces:**

- Consumes: new clone URL `https://github.com/A11y-Pulse/audits.git`; Changesets from Task 2; Trusted Publisher repo `audits`
- Produces: root README lists packages; package README still documents the audit; contributing explains changesets

- [ ] **Step 1: Write the root catalogue README**

Write `/Users/joseph/dev/a11y-pulse/focus-appearance-audit/README.md` exactly as follows (license link points at the package copy of PolyForm Shield):

````markdown
# A11y Pulse audits

Source-available accessibility audits used by [A11y Pulse](https://www.a11ypulse.com/), published as separate npm packages from this repo.

Each package is framework-agnostic (drive it through an adaptor) and released under the [PolyForm Shield License 1.0.0](./packages/focus-appearance-audit/LICENSE.md) — read, fork, and use them in non-competing products; do not use them to build a competing accessibility monitoring service.

## Packages

| Package | npm | What it checks |
| --- | --- | --- |
| [`@a11y-pulse/focus-appearance-audit`](./packages/focus-appearance-audit) | [@a11y-pulse/focus-appearance-audit](https://www.npmjs.com/package/@a11y-pulse/focus-appearance-audit) | [WCAG 2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible): tabs through a page and detects a visible focus indicator |

## Development

Requires Node.js `>=22`.

```bash
git clone https://github.com/A11y-Pulse/audits.git
cd audits
npm install
npm test                 # typecheck + unit tests
npm run test:integration # real Chromium via Puppeteer
npm run lint
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for Changesets and pull-request expectations.
````

- [ ] **Step 2: Update CONTRIBUTING.md**

Replace the clone block and retitle so it is repo-wide. Write `CONTRIBUTING.md`:

````markdown
# Contributing

Thanks for your interest in contributing to the A11y Pulse audits.

## License note

Packages in this repo are released under the [PolyForm Shield License 1.0.0](./packages/focus-appearance-audit/LICENSE.md), a source-available (not open-source/OSI-approved) license: it permits non-competing use but forbids using the software (including modified versions) to build a competing product or service. By submitting a contribution, you agree that it will be licensed under the same terms, and that A11y Pulse Limited may use, modify, and relicense your contribution as part of the project.

If you're not comfortable with that, please open an issue to discuss your change before submitting a pull request.

## Getting set up

```bash
git clone https://github.com/A11y-Pulse/audits.git
cd audits
npm install
```

Requires Node.js `>=22`.

## Running tests

From the repo root:

```bash
# Type checking + unit tests (what `npm test` runs)
npm test

# Unit tests only
npm run test:unit

# Integration tests (launches a real headless Chromium via Puppeteer)
npm run test:integration
```

Unit tests live alongside source files as `*.test.ts` inside each package. Integration tests live in `packages/<package>/tests/integration/` and exercise real browser behaviour against HTML fixtures.

## Linting and formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting.

```bash
npm run lint       # check
npm run lint:fix   # auto-fix what's safe to fix
```

## Versioning

Published packages version independently with [Changesets](https://github.com/changesets/changesets).

- If your PR should bump a published package, run `npx changeset` and commit the file it creates.
- Tooling-only changes (root TypeScript, Biome, GitHub Actions) do **not** need a changeset and must not publish.
- Dependabot PRs that bump a package's production dependencies (`pixelmatch`, `pngjs`, …) need a `patch` changeset on that package.

After merge to `main`, the Release workflow opens a Version PR when changesets exist. Merging that PR publishes to npm via trusted publishing (`release.yml`).

## Opening a pull request

1. Fork the repo and create a branch for your change.
2. Add or update tests for any behaviour change.
3. Make sure `npm test`, `npm run test:integration` (if your change touches browser behaviour), and `npm run lint` all pass.
4. Add a changeset if a published package should bump.
5. Open a pull request describing what changed and why, using the PR template.

For anything beyond a small fix, please open an issue first to discuss the approach.
````

- [ ] **Step 3: Add a changeset checkbox to the PR template**

Write `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Summary

## Test plan

- [ ] `npm test`
- [ ] `npm run test:integration` (if browser-related)
- [ ] Changeset added (if this should bump a published package)
```

- [ ] **Step 4: Update the package README badge and Releasing section**

In `packages/focus-appearance-audit/README.md`:

1. Change the CI badge URLs from `A11y-Pulse/focus-appearance-audit` to `A11y-Pulse/audits`:

```markdown
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
```

2. Replace the entire `## Releasing` section with:

```markdown
## Releasing

Releases are managed in the [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits) monorepo with [Changesets](https://github.com/changesets/changesets). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC) — there is no long-lived `NPM_TOKEN`.

### Ship a change

1. Open a PR against `main` that includes a changeset (`npx changeset`) naming `@a11y-pulse/focus-appearance-audit`.
2. After merge, the Release workflow opens a Version PR. Merging that PR publishes this package to npm and tags `@a11y-pulse/focus-appearance-audit@<version>`.

Trusted Publisher on npm must stay configured for:

| Field | Value |
| --- | --- |
| Organization or user | `A11y-Pulse` |
| Repository | `audits` |
| Workflow filename | `release.yml` |

### Consumers (e.g. the A11y Pulse runner)

Bumping the published version in downstream apps is a separate change — update the dependency range / lockfile there after the npm release lands.
```

Leave Install, Quickstart, Options, Detection methods, Adaptors, Limitations, and License as they are. Relative links (`./docs/accuracy.md`, `./examples/puppeteer`, `./src/adaptors/puppeteer.ts`, `./LICENSE.md`) stay valid because those files moved with the package.

- [ ] **Step 5: Run lint on the edited JSON/markdown-adjacent files**

```bash
npm run lint
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md CONTRIBUTING.md .github/PULL_REQUEST_TEMPLATE.md packages/focus-appearance-audit/README.md
git commit -m "$(cat <<'EOF'
Document the audits monorepo layout and Changesets releases.

Point clone URLs, CI badges, and Trusted Publisher at A11y-Pulse/audits.
EOF
)"
```

---

### Task 5: Point the SaaS architecture doc at the audits repo

**Files:**

- Modify: `/Users/joseph/dev/a11y-pulse/a11y-pulse/docs/architecture/README.md`

**Interfaces:**

- Consumes: GitHub repo `A11y-Pulse/audits`
- Produces: live architecture map no longer implies a single-package audit repo

This is a **separate git repository**. Do not mix these files into audits-repo commits.

- [ ] **Step 1: Update the npm row**

In `/Users/joseph/dev/a11y-pulse/a11y-pulse/docs/architecture/README.md`, replace:

```markdown
| npm | `@a11y-pulse` org (publishes `@a11y-pulse/focus-appearance-audit`, consumed by the runner) |
```

with:

```markdown
| npm | `@a11y-pulse` org (publishes audit packages from [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits); runner consumes `@a11y-pulse/focus-appearance-audit`) |
```

Do not edit historical plans under `docs/plans/2026-07-23-focus-appearance-audit-repo-extraction/` or `.superpowers/sdd/` briefs.

- [ ] **Step 2: Commit in the a11y-pulse repo**

```bash
cd /Users/joseph/dev/a11y-pulse/a11y-pulse
git add docs/architecture/README.md
git commit -m "$(cat <<'EOF'
Point the npm architecture row at the audits monorepo.

The public audit packages now live in A11y-Pulse/audits rather than a single-package repo.
EOF
)"
```

Only commit if `docs/architecture/README.md` is the intended change on the current branch. If the working tree has unrelated edits, leave this file unstaged and stop for the human.

---

## Verification (after all tasks)

From `/Users/joseph/dev/a11y-pulse/focus-appearance-audit`:

```bash
npm run lint
npm test
npm run build
npm run test:integration
npx changeset status
git remote -v
```

Expected: all scripts pass; no pending changesets; `origin` is `git@github.com:A11y-Pulse/audits.git`.

Open a PR against `A11y-Pulse/audits` `main`. CI must be green. Merging must **not** publish to npm.
