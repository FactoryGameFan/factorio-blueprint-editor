# Vite+ Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the full Vite+ toolchain (Oxlint + Oxfmt + unified `vp`) across the npm-workspace packages of factorio-blueprint-editor, shipped as one PR of five phased, reviewable commits.

**Architecture:** `vp migrate` has already run on branch `explore/vite-plus`; its output sits uncommitted in the working tree. This plan pins/cleans that output, isolates the Oxfmt reformat, unblocks type-aware lint, reorganizes the test runners, and rewires CI - one commit per concern.

**Tech Stack:** Vite+ (`vp` CLI v0.2.1, `vite-plus` / `@voidzero-dev/vite-plus-core` 0.2.1), Oxlint (type-aware), Oxfmt, Vitest 4.1.9, npm workspaces, Playwright (unchanged), Node 24.18.0 via vp.

## Global Constraints

- Work only on branch `explore/vite-plus`. Do not push or open a PR unless asked.
- Scope: repo root + `packages/editor` + `packages/website`. Do NOT touch `packages/exporter` (Rust) or `packages/worker` (wrangler).
- The authoritative type gate stays `scripts/type-check-gate.mjs` (tsc, baseline 0). Do NOT fold type-checking into a `vp` gate. Keep `typescript@^5.9.3` in root devDeps.
- No `@latest` / `"latest"` dependency specifiers may remain. Pin to exact `0.2.1`.
- Type-aware lint findings are non-blocking (warnings); `vp lint .` must exit 0 with warnings present. Do not use `--deny-warnings` / `--max-warnings 0`.
- `vp` binary path if the `vp` shell function is unavailable in a non-interactive shell: `~/.vite-plus/bin/vp`.
- Commit messages end with the two trailers used in this repo:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and the `Claude-Session:` line.

---

## File Structure

- `package.json` (root) - pin versions, fix scripts (`test`->`test:e2e`, drop `test:scripts`), add `typed-factorio` dep.
- `packages/editor/package.json` - pin `vite-plus`.
- `packages/website/package.json` - pin `vite-plus`, drop redundant `vite` override dep.
- `vite.config.ts` (root) - fix `fmt.tabWidth` 2->4 + ignore YAML (Task 1); add a `test` block with explicit projects (Task 4).
- `.prettierignore` - delete (stale).
- `vite.config.ts` lint block (Task 3) - `typeCheck: false`; `no-explicit-any`/`ban-ts-comment` off.
- `packages/editor/src/core/spriteDataBuilder.ts` - one unused var (Task 3).
- `scripts/type-check-gate.test.mjs` - node:test -> Vitest import.
- `.github/workflows/ci.yml` - rewrite for `vp`.
- `.node-version` - pin `24.18.0`.
- `CLAUDE.md` - update commands/docs.

---

## Task 1: Pin versions and commit the migration output

**Files:**

- Modify: `package.json` (root) - `overrides.vite`, `devDependencies.vite-plus`
- Modify: `packages/editor/package.json` - `devDependencies.vite-plus`
- Modify: `packages/website/package.json` - `devDependencies.vite-plus`, remove `devDependencies.vite`

**Interfaces:**

- Produces: a committed, pinned toolchain baseline (commit 1) that all later tasks build on. Exact pinned version string: `0.2.1`.

- [ ] **Step 1: Confirm starting state**

Run: `git -C /Users/ericjohnson/GitHub/factorio-blueprint-editor branch --show-current && git status --short`
Expected: branch `explore/vite-plus`; modified/created migration files present (`vite.config.ts`, `.node-version`, deleted `.nvmrc`/`.prettierrc.yml`/`eslint.config.mjs`, modified `package.json` etc.) and `.prettierignore` still present.

- [ ] **Step 2: Pin the root `vite` override and `vite-plus` dep**

In `package.json` (root), replace:

```json
        "vite-plus": "latest"
```

with:

```json
        "vite-plus": "0.2.1"
```

and replace:

```json
        "vite": "npm:@voidzero-dev/vite-plus-core@latest",
```

with:

```json
        "vite": "npm:@voidzero-dev/vite-plus-core@0.2.1",
```

- [ ] **Step 3: Pin `vite-plus` in the editor package**

In `packages/editor/package.json`, replace:

```json
        "vite-plus": "latest"
```

with:

```json
        "vite-plus": "0.2.1"
```

- [ ] **Step 4: Pin `vite-plus` and drop the redundant `vite` dep in the website package**

In `packages/website/package.json`, the `devDependencies` currently include both:

```json
        "vite": "npm:@voidzero-dev/vite-plus-core@latest",
        "vite-plugin-static-copy": "^4.1.1",
        "vite-plus": "latest"
```

Replace that block with (drop the `vite` line - the root `overrides` covers it - and pin `vite-plus`):

```json
        "vite-plugin-static-copy": "^4.1.1",
        "vite-plus": "0.2.1"
```

- [ ] **Step 4b: Fix the Oxfmt indent width to match the repo (4-space) and exclude YAML**

The migration emitted `fmt.tabWidth: 2`, but the repo (and prior Prettier) use
4-space. Left at 2, the Task 2 reformat reindents the entire repo and breaks the
4-space edit blocks in Tasks 3-4. In `vite.config.ts`, inside the `fmt` block, change:

```ts
    tabWidth: 2,
```

to:

```ts
    tabWidth: 4,
```

Then add YAML globs to the existing `fmt.ignorePatterns` array (so the GitHub
workflow YAML is not reindented to 4-space) by adding these two entries:

```ts
      "**/*.yml",
      "**/*.yaml",
```

- [ ] **Step 5: Re-resolve the lockfile against the pinned versions**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp install`
Expected: completes without error; `package-lock.json` updated to the pinned `0.2.1` versions.

- [ ] **Step 6: Verify no `@latest`/`"latest"` specifiers remain**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && grep -rn '"latest"\|@latest' package.json packages/*/package.json`
Expected: no output (exit 1 from grep).

- [ ] **Step 7: Verify the build still works**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor/packages/website && vp build`
Expected: `✓ built in …` with `dist/index.html` and assets emitted.

- [ ] **Step 8: Commit (commit 1)**

```bash
cd /Users/ericjohnson/GitHub/factorio-blueprint-editor
git add -A
git commit -m "build: migrate toolchain to Vite+ (pinned 0.2.1)

vp migrate output: vite/vitest aliased to Vite+ via root overrides,
vite-plus added, ESLint/Prettier deps removed, defineConfig/vitest
imports rewritten, website plugins wrapped in lazyPlugins, scripts
repointed to vp, .nvmrc/.prettierrc.yml/eslint.config.mjs folded into
vite.config.ts. All specifiers pinned to 0.2.1; redundant website vite
dep dropped.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TJNktKfkk4GuyExffTQzrS"
```

Note: this commit intentionally still contains `.prettierignore` (deleted in Task 2) and the not-yet-rewritten `ci.yml` (Task 5). Intermediate inconsistency is acceptable per the spec - CI only runs on `wormeyman-space-age-support`.

---

## Task 2: Apply the Oxfmt reformat (isolated) and delete `.prettierignore`

**Files:**

- Modify: a small set of files (genuine Oxfmt-vs-Prettier diffs; with `tabWidth: 4` from Task 1 Step 4b this is ~3 files, NOT a whole-repo reindent)
- Delete: `.prettierignore`

**Interfaces:**

- Produces: a tree where `vp fmt --check` passes. No hand edits.

- [ ] **Step 1: Dry-run the formatter to confirm scope**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp fmt . --check 2>&1 | tail -10`
Expected: with `tabWidth: 4` from Task 1 Step 4b, this is now a SMALL set (genuine Oxfmt-vs-Prettier differences only), NOT the ~109-file whole-repo reindent. If it still reports ~100+ files, Task 1 Step 4b's `tabWidth: 4` change did not take effect - stop and fix that first. Scan the file list for anything unexpected (e.g. files under `docs/`, `wormeyman-tests/`, `diagnostic-reports/`).

- [ ] **Step 2: If unexpected trees appear, extend `fmt.ignorePatterns`**

Only if Step 1 lists generated/fixture files that should not be reformatted: in `vite.config.ts`, add the offending glob(s) to the `fmt.ignorePatterns` array (which already contains `packages/editor/src/basis`, `packages/exporter`, `**/package-lock.json`, `packages/worker/worker-configuration.d.ts`, `.claude`, `.superpowers`). If nothing unexpected appears, skip this step.

- [ ] **Step 3: Delete the stale `.prettierignore`**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && git rm .prettierignore`
Expected: `rm '.prettierignore'`.

- [ ] **Step 4: Apply the reformat**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp fmt .`
Expected: rewrites the small set from Step 1 (~3 files with `tabWidth: 4`).

- [ ] **Step 5: Verify formatting is now clean**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp fmt . --check`
Expected: no formatting issues reported (exit 0).

- [ ] **Step 6: Sanity-check the build survived the reformat**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor/packages/website && vp build 2>&1 | tail -3`
Expected: `✓ built in …`.

- [ ] **Step 7: Commit (commit 2)**

```bash
cd /Users/ericjohnson/GitHub/factorio-blueprint-editor
git add -A
git commit -m "style: reformat with Oxfmt; remove stale .prettierignore

Mechanical Oxfmt pass (no hand edits). Review with --ignore-all-space.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TJNktKfkk4GuyExffTQzrS"
```

---

## Task 3: Make `vp lint` pass (turn off duplicate strict typeCheck; restore disabled rules)

**Context (read before editing):** The migrated Oxlint config runs with
`lint.options.typeCheck: true`, which performs a FULL strict-mode type-check and
emits ~900 TypeScript errors (TS18048 x282, TS2322 x201, TS2345 x166, ...) plus
54 `no-explicit-any` and 1 `ban-ts-comment`. The project's own `tsc` runs with
`strict` OFF (the `type-check:gate`, baseline 0) and is the authoritative type
gate; Oxlint's strict typeCheck duplicates a check the project intentionally does
not enforce. Per the approved design (confirmed with the user), set
`typeCheck: false` so lint stops duplicating strict tsc, keep `typeAware: true`
so type-aware lint RULES (unbound-method etc.) still run as warnings, and restore
the two rule disables the deleted `eslint.config.mjs` carried
(`@typescript-eslint/no-explicit-any: off`, `@typescript-eslint/ban-ts-comment:
off` - the Space Age code uses `as any` casts by design). With those changes,
verified residual errors drop to: 2 `tsconfig-error` (typed-factorio resolution,
fixed below) + 1 `no-unused-vars`. The Slider `TS2531` errors are typeCheck
diagnostics and disappear once typeCheck is off - no Slider edit is needed.

**Files:**

- Modify: `vite.config.ts` (root) - `lint.options.typeCheck`, two `lint.rules` entries
- Modify: `package.json` (root) - add `typed-factorio` devDependency
- Modify: `packages/editor/src/core/spriteDataBuilder.ts` - one unused variable

**Interfaces:**

- Produces: `vp lint .` exits 0 (warnings allowed). Consumed by the CI lint step in Task 5.

NOTE: Task 2 has reformatted `vite.config.ts` to 4-space, single quotes, and
unquoted object keys where valid. The lint rule keys containing `/` (e.g.
`'typescript/no-explicit-any'`) stay quoted. Because the exact post-reformat
layout is formatter-driven, the steps below say WHAT to change - `Read` the file
and edit the located values; do not rely on a pre-written literal block. Run
`vp fmt vite.config.ts` after editing and confirm `vp fmt vite.config.ts --check`
is clean before committing.

- [ ] **Step 1: Confirm the current lint failure and its scale**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp lint . 2>&1 | grep -oE 'error [a-z]+\([A-Za-z0-9/_-]+\)' | sort | uniq -c | sort -rn | head`
Expected: exit non-zero; hundreds of `typescript(TS....)` errors plus `typescript(no-explicit-any)` (~54), `typescript(tsconfig-error)` (2), `typescript(ban-ts-comment)` (1), `eslint(no-unused-vars)` (1).

- [ ] **Step 2: Turn off Oxlint's strict typeCheck**

`Read` `vite.config.ts`, find the `lint.options` block (currently `typeAware: true, typeCheck: true`), and set `typeCheck` to `false`. Leave `typeAware: true` unchanged.

- [ ] **Step 3: Restore the two rule disables from the old ESLint config**

In the `lint.rules` block of `vite.config.ts`:

- set `'typescript/no-explicit-any'` to `'off'` (currently `'error'`)
- set `'typescript/ban-ts-comment'` to `'off'` (currently an array `['error', { minimumDescriptionLength: 10 }]` - replace the whole value with `'off'`)

- [ ] **Step 4: Add `typed-factorio` to root devDeps (fixes the 2 `tsconfig-error`s)**

The root `tsconfig.json` (and `packages/website/tsconfig.json`) list `typed-factorio/prototype` in `types`, but the package is only installed under `packages/editor`. In root `package.json` `devDependencies`, add (before `typescript`):

```json
        "typed-factorio": "^3.35.0",
```

Then run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp install`

- [ ] **Step 5: Re-run lint and confirm only the unused-var error remains**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp lint . 2>&1 | grep -E ': error |tsconfig-error'`
Expected: no `TS....` errors, no `no-explicit-any`, no `tsconfig-error` (typed-factorio now resolves). The only remaining error should be `eslint(no-unused-vars)` for `render_layer` at `packages/editor/src/core/spriteDataBuilder.ts:1155`.

- [ ] **Step 6: Fix the unused variable**

`Read` `packages/editor/src/core/spriteDataBuilder.ts` around line 1155. Determine whether `render_layer` is genuinely unused:

- If unused: remove the declaration (or, if it documents a destructured field, prefix with `_` and confirm the rule's ignore pattern - the old ESLint used `varsIgnorePattern: '^_'`; if Oxlint's `no-unused-vars` needs the same option, add it to the rule config).
- If actually used (Oxlint false positive): add a scoped `// oxlint-disable-next-line no-unused-vars -- <reason>` comment.
  Pick the minimal correct fix; do not change unrelated code.

- [ ] **Step 7: Format the config and verify lint exits 0**

Run:

```bash
cd /Users/ericjohnson/GitHub/factorio-blueprint-editor
vp fmt vite.config.ts && vp fmt vite.config.ts --check
vp lint . ; echo "exit: $?"
```

Expected: fmt clean; `exit: 0`. `warning` lines (unbound-method, restrict-template-expressions, no-redundant-type-constituents, unicorn/\*) remain and are non-blocking by design.

- [ ] **Step 8: Confirm the type gate is unaffected**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && npm run type-check:gate`
Expected: `Type-check gate passed: 0 errors (at baseline 0).`

- [ ] **Step 9: Commit (commit 3)**

```bash
cd /Users/ericjohnson/GitHub/factorio-blueprint-editor
git add vite.config.ts package.json package-lock.json packages/editor/src/core/spriteDataBuilder.ts
git commit -m "lint: make vp lint pass; tsc gate stays the type authority

Oxlint typeCheck:true duplicated a full strict tsc (~900 errors) that
the project intentionally does not run (tsc strict off, baseline 0).
Set typeCheck:false (type-aware lint rules stay on as warnings); restore
no-explicit-any/ban-ts-comment off per the old eslint.config.mjs (Space
Age as-any casts); add typed-factorio to root devDeps so the root types
resolve; fix one unused var. vp lint . now exits 0 with warnings only.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TJNktKfkk4GuyExffTQzrS"
```

---

## Task 4: Reorganize tests under `vp test`

**Files:**

- Modify: `scripts/type-check-gate.test.mjs` (import line only)
- Modify: `vite.config.ts` (root) - add a `test` block
- Modify: `package.json` (root) - rename `test`->`test:e2e`, update `test:report`, remove `test:scripts`

**Interfaces:**

- Consumes: the Vitest API re-exported from `vite-plus/test` (the migration already uses it in `packages/editor/src/core/spriteShape.test.ts`).
- Produces: `vp test` runs exactly editor unit tests + gate tests; Playwright stays on `vp run test:e2e`.

- [ ] **Step 1: Switch the gate test to the Vitest runner**

In `scripts/type-check-gate.test.mjs`, replace the first import line:

```js
import { test } from 'node:test'
```

with:

```js
import { test } from 'vite-plus/test'
```

Leave `import assert from 'node:assert/strict'` and every `test(...)`/`assert.*` call unchanged - Vitest runs the `test()` blocks and treats a thrown `assert` failure as a test failure.

- [ ] **Step 2: Add a root `test` block with explicit projects**

In `vite.config.ts`, the `defineConfig({ ... })` object has `lint` and `fmt` properties. Add a `test` property (top level, sibling of `lint`/`fmt`). Use explicit Vitest 4 `projects` rather than a bare `include`, so both the editor units and the gate tests are guaranteed to run and Playwright is never swept in (relying on vp's implicit workspace auto-discovery is unsafe - if the editor project silently dropped, CI would go green without running editor units).

IMPORTANT: by this point Task 2 has reformatted `vite.config.ts` to **4-space indent, single quotes, unquoted object keys**. Write the inserted block in that style so the file stays `vp fmt`-clean (otherwise the CI `vp fmt . --check` in Task 5 fails). Insert, as a sibling before the closing `})`:

```ts
    test: {
        projects: [
            // editor unit tests: uses packages/editor/vitest.config.ts as-is
            './packages/editor',
            {
                // type-check-gate tests (outside any workspace package)
                test: {
                    name: 'gate',
                    environment: 'node',
                    include: ['scripts/**/*.test.mjs'],
                    exclude: ['tests/**', '**/node_modules/**', '**/dist/**'],
                },
            },
        ],
    },
```

After inserting, run `vp fmt vite.config.ts` and confirm `vp fmt vite.config.ts --check` is clean before committing. If `'./packages/editor'` does not resolve its `vitest.config.ts` (Step 4 shows editor units missing), use the explicit path `'./packages/editor/vitest.config.ts'` instead.

- [ ] **Step 3: Rename the Playwright scripts in root `package.json`**

Replace:

```json
        "test:scripts": "node --test 'scripts/**/*.test.mjs'",
```

(delete this line entirely - the gate tests now run under `vp test`), and replace:

```json
        "test": "npx playwright test",
        "test:report": "npx playwright test --reporter=list"
```

with:

```json
        "test:e2e": "npx playwright test",
        "test:e2e:report": "npx playwright test --reporter=list"
```

- [ ] **Step 4: Verify `vp test` runs the right suites**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp test 2>&1 | tail -20`
Expected: BOTH projects run - the editor project (`spriteShape.test.ts`, 13 tests) AND the `gate` project (`scripts/type-check-gate.test.mjs`, 16 tests); 29 tests total pass. NO `tests/blueprint-loading.spec.ts` is collected. If the editor tests are missing (only the gate project ran), the `./packages/editor` project entry is not being picked up - stop and fix the `projects` config before continuing (do not proceed with editor units silently unrun).

- [ ] **Step 5: Verify Playwright still discovers its suite separately**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp run test:e2e -- --list 2>&1 | tail -5`
Expected: Playwright lists the blueprint-loading tests (it does not execute them with `--list`). If `vp run test:e2e` does not forward args, run `npx playwright test --list` instead.

- [ ] **Step 6: Commit (commit 4)**

```bash
cd /Users/ericjohnson/GitHub/factorio-blueprint-editor
git add scripts/type-check-gate.test.mjs vite.config.ts package.json
git commit -m "test: run unit + gate tests under vp test; keep Playwright separate

Gate tests node:test -> Vitest import; root vite.config.ts test block
scopes vp test to scripts/** + editor and excludes Playwright; rename
root test -> test:e2e so npm test no longer launches Playwright.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TJNktKfkk4GuyExffTQzrS"
```

---

## Task 5: Rewrite CI, pin Node, update docs

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.node-version`
- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: everything from Tasks 1-4 (`vp fmt --check`, `vp lint .`, `vp test`, `npm run type-check:gate` all green).
- Produces: a CI workflow that installs `vp` and runs the Vite+ checks; pinned Node; accurate docs.

- [ ] **Step 1: Pin `.node-version`**

Replace the entire contents of `.node-version` (currently `lts/*`) with:

```
24.18.0
```

- [ ] **Step 2: Rewrite `.github/workflows/ci.yml`**

Replace the whole file with:

```yaml
name: CI

on:
  pull_request:
    branches:
      - wormeyman-space-age-support
  push:
    branches:
      - wormeyman-space-age-support
  workflow_dispatch:

permissions:
  contents: read

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Cache Vite+ toolchain
        uses: actions/cache@v4
        with:
          path: ~/.vite-plus
          key: vite-plus-${{ runner.os }}-0.2.1

      - name: Install vp
        run: |
          VP_VERSION=0.2.1 VP_NODE_MANAGER=yes curl -fsSL https://vite.plus | bash
          echo "$HOME/.vite-plus/bin" >> "$GITHUB_PATH"

      - name: Install dependencies
        run: vp install

      - name: Format check (oxfmt)
        if: ${{ !cancelled() }}
        run: vp fmt . --check

      - name: Lint (oxlint)
        if: ${{ !cancelled() }}
        run: vp lint .

      - name: Tests (vitest: units + gate)
        if: ${{ !cancelled() }}
        run: vp test

      - name: Type-check gate
        if: ${{ !cancelled() }}
        run: npm run type-check:gate
```

Notes baked in: `VP_VERSION=0.2.1` pins the installer; `VP_NODE_MANAGER=yes` lets vp provide Node 24.18.0 non-interactively; the toolchain dir is cached. `npm run type-check:gate` runs `node scripts/type-check-gate.mjs`, which spawns `tsc` internally - so `typescript` must remain in root devDeps (it does; Task 3 only adds `typed-factorio`). The `npm`/`node` used here come from vp's managed Node (on PATH via the install step).

- [ ] **Step 3: If `vp install` does not honor the lockfile, fall back to `npm ci`**

Verify locally whether `vp install` mutates `package-lock.json`:

```bash
cd /Users/ericjohnson/GitHub/factorio-blueprint-editor
git status --short package-lock.json   # should be clean before
vp install
git status --short package-lock.json   # must still be clean
```

If `package-lock.json` changed, replace the `Install dependencies` step's `run: vp install` with `run: npm ci` (npm is available via vp's managed Node). Otherwise leave `vp install`.

- [ ] **Step 4: Update `CLAUDE.md` Key Commands**

In `CLAUDE.md`, update the commands to their `vp` equivalents. Specific anchors to change:

- Key Commands block: `npm run start` (dev server, ~line 18) -> `vp dev`; `cd packages/website && npx vite build` (~line 24) -> `cd packages/website && vp build`; the `npm run test:scripts` reference (~line 36) -> note gate tests now run under `vp test`; the type-check lines (`npm run type-check:gate`) are unchanged.
- Cloudflare Deployment section: the `npx vite build` line (~line 103) -> `vp build`.
- Replace `npx playwright test` script references with `vp run test:e2e` (script renamed in Task 4).
- Add a short "Vite+ toolchain" subsection stating: `vp` is the unified CLI; lint/format/test config live in the root `vite.config.ts` (`lint`/`fmt`/`test` blocks); `npm run lint`/`format` now require `vp` on PATH.

(Line numbers are approximate - `Read` the file and match the actual text.)

- [ ] **Step 5: Update `CLAUDE.md` Playwright Diagnostics prerequisites**

In the "Playwright Blueprint Diagnostics" section's Prerequisites, change `cd packages/website && npm run start` to `cd packages/website && vp dev` (the sprite-data `npx serve` line is unchanged).

- [ ] **Step 6: Full local verification pass (mirror CI)**

Run each and confirm green:

```bash
cd /Users/ericjohnson/GitHub/factorio-blueprint-editor
vp fmt . --check          # exit 0
vp lint . ; echo $?       # exit 0 (warnings ok)
vp test 2>&1 | tail -5    # units + gate pass, no Playwright
npm run type-check:gate   # 0 errors at baseline 0
(cd packages/website && vp build 2>&1 | tail -3)   # built
npx playwright test --list 2>&1 | tail -3          # discovers blueprints
```

Expected: all green as annotated.

- [ ] **Step 7: Commit (commit 5)**

```bash
cd /Users/ericjohnson/GitHub/factorio-blueprint-editor
git add .github/workflows/ci.yml .node-version CLAUDE.md
git commit -m "ci,docs: run CI on Vite+ toolchain; pin Node 24.18.0

CI installs pinned vp (cached), runs vp fmt/lint/test + the tsc type
gate; .node-version pinned to vp LTS; CLAUDE.md commands updated to vp.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TJNktKfkk4GuyExffTQzrS"
```

---

## Final verification (whole plan)

- [ ] All five commits present on `explore/vite-plus`: `git log --oneline -5`
- [ ] `vp install` clean, no lockfile drift
- [ ] `vp fmt . --check` exit 0; `.prettierignore` gone
- [ ] `vp lint .` exit 0 (warnings allowed)
- [ ] `vp test` green (editor units + gate), no Playwright swept in
- [ ] `npx playwright test --list` discovers the blueprint suite
- [ ] `vp build` produces working `packages/website/dist/`
- [ ] `npm run type-check:gate` = 0 at baseline 0
- [ ] no `@latest`/`"latest"` specifiers remain
- [ ] `typescript` still pinned in root devDeps
