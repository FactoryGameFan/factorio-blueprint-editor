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
- `vite.config.ts` (root) - add a `test` block scoping `vp test`.
- `.prettierignore` - delete (stale).
- `packages/editor/src/UI/controls/Slider.ts` - fix two TS2531 null derefs.
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
- Modify: ~109 files repo-wide (mechanical reformat by `vp fmt`)
- Delete: `.prettierignore`

**Interfaces:**
- Produces: a tree where `vp fmt --check` passes. No hand edits.

- [ ] **Step 1: Dry-run the formatter to confirm scope**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp fmt . --check 2>&1 | tail -5`
Expected: reports formatting issues in ~109 files. Scan the file list for anything unexpected (e.g. files under `docs/`, `wormeyman-tests/`, `diagnostic-reports/`).

- [ ] **Step 2: If unexpected trees appear, extend `fmt.ignorePatterns`**

Only if Step 1 lists generated/fixture files that should not be reformatted: in `vite.config.ts`, add the offending glob(s) to the `fmt.ignorePatterns` array (which already contains `packages/editor/src/basis`, `packages/exporter`, `**/package-lock.json`, `packages/worker/worker-configuration.d.ts`, `.claude`, `.superpowers`). If nothing unexpected appears, skip this step.

- [ ] **Step 3: Delete the stale `.prettierignore`**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && git rm .prettierignore`
Expected: `rm '.prettierignore'`.

- [ ] **Step 4: Apply the reformat**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp fmt .`
Expected: rewrites the ~109 files.

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

## Task 3: Unblock type-aware lint (fix TS2531 ×2 + root tsconfig)

**Files:**
- Modify: `packages/editor/src/UI/controls/Slider.ts` (methods `onButtonDragStart`, `onButtonDragMove`)
- Modify: `package.json` (root) - add `typed-factorio` devDependency

**Interfaces:**
- Produces: `vp lint .` exits 0 (warnings allowed). Consumed by the CI lint step in Task 5.

- [ ] **Step 1: Confirm the current lint failure**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp lint . ; echo "exit: $?"`
Expected: exit 1; output includes `Slider.ts:182 … TS2531`, `Slider.ts:173 … TS2531` (verify both appear), and `tsconfig.json: error typescript(tsconfig-error): … Cannot find type definition file for 'typed-factorio/prototype'`.

- [ ] **Step 2: Fix `onButtonDragStart` (Slider.ts) with a null guard**

Replace:
```ts
    private readonly onButtonDragStart = (event: FederatedPointerEvent): void => {
        if (!this.m_Dragging) {
            this.m_Dragging = true
            this.m_Dragpoint =
                this.m_SliderButton.parent.worldTransform.applyInverse(event.global).x -
                this.m_SliderButton.x
            this.m_SliderButton.getChildAt<ContainerChild>(1).visible = true
        }
    }
```
with:
```ts
    private readonly onButtonDragStart = (event: FederatedPointerEvent): void => {
        if (!this.m_Dragging) {
            const parent = this.m_SliderButton.parent
            if (!parent) return
            this.m_Dragging = true
            this.m_Dragpoint =
                parent.worldTransform.applyInverse(event.global).x - this.m_SliderButton.x
            this.m_SliderButton.getChildAt<ContainerChild>(1).visible = true
        }
    }
```

(Uses a narrowed local, not a `!` assertion - the lint config sets `typescript/no-non-null-assertion: error`.)

- [ ] **Step 3: Fix `onButtonDragMove` (Slider.ts) with a null guard**

Replace:
```ts
    private readonly onButtonDragMove = (event: FederatedPointerEvent): void => {
        if (this.m_Dragging) {
            const position = this.m_SliderButton.parent.worldTransform.applyInverse(event.global)
```
with:
```ts
    private readonly onButtonDragMove = (event: FederatedPointerEvent): void => {
        if (this.m_Dragging) {
            const parent = this.m_SliderButton.parent
            if (!parent) return
            const position = parent.worldTransform.applyInverse(event.global)
```

- [ ] **Step 4: Make `typed-factorio` resolvable at the repo root**

The root `tsconfig.json` lists `typed-factorio/prototype` in `types`, but the package is only installed under `packages/editor`. Add it to the root `devDependencies` in `package.json` so the type-aware pass resolves it from root. Insert before `typescript`:
```json
        "typed-factorio": "^3.35.0",
```
so the `devDependencies` read:
```json
    "devDependencies": {
        "@playwright/test": "^1.58.2",
        "typed-factorio": "^3.35.0",
        "typescript": "^5.9.3",
        "vite-plus": "0.2.1"
    },
```

- [ ] **Step 5: Install the new dep**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp install`
Expected: completes; `typed-factorio` present at root.

- [ ] **Step 6: Verify lint now exits 0 with only warnings**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp lint . ; echo "exit: $?"`
Expected: `exit: 0`. No lines containing ` error ` remain; `warning` lines (e.g. `unbound-method`, `restrict-template-expressions`) may remain - those are non-blocking by design.

- [ ] **Step 7: Fallback only if Step 6 still shows ERRORS**

If `vp lint .` still exits non-zero because tsgolint surfaces additional type-level **errors** beyond the two Slider sites (the project runs `tsc` with `strict` off, so strict-null-check style diagnostics can appear): demote type diagnostics to non-blocking by setting the type-check severity to `warn` in `vite.config.ts` under `lint.options` (the design treats all type-aware findings as non-blocking). Re-run Step 6 until `exit: 0`. Do NOT hand-fix unrelated files. If a config knob to demote them is not available, stop and report rather than suppressing file-by-file.

- [ ] **Step 8: Confirm the type gate is unaffected**

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && npm run type-check:gate`
Expected: `Type-check gate passed: 0 errors (at baseline 0).`

- [ ] **Step 9: Commit (commit 3)**

```bash
cd /Users/ericjohnson/GitHub/factorio-blueprint-editor
git add packages/editor/src/UI/controls/Slider.ts package.json package-lock.json vite.config.ts
git commit -m "fix(editor): unblock Vite+ type-aware lint

Guard the two Slider.ts parent null-derefs (TS2531) without non-null
assertions; add typed-factorio to root devDeps so the root type-aware
pass resolves it. vp lint . now exits 0 with warnings only.

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

- [ ] **Step 2: Add a root `test` block to scope `vp test`**

In `vite.config.ts`, the `defineConfig({ ... })` object currently has `lint` and `fmt` properties. Add a `test` property (top level, sibling of `lint`/`fmt`) so the root run picks up `scripts/**` gate tests and excludes the Playwright suite:
```ts
  test: {
    include: ['scripts/**/*.test.mjs'],
    exclude: ['tests/**', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
  },
```

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

Run: `cd /Users/ericjohnson/GitHub/factorio-blueprint-editor && vp test 2>&1 | tail -15`
Expected: editor `spriteShape.test.ts` (13 tests) AND `scripts/type-check-gate.test.mjs` (16 tests) pass; NO `tests/blueprint-loading.spec.ts` is collected. Test files: 2 passed.

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

Notes baked in: `VP_VERSION=0.2.1` pins the installer; `VP_NODE_MANAGER=yes` lets vp provide Node 24.18.0 non-interactively; the toolchain dir is cached; `npm run type-check:gate` still uses `npx tsc` (typescript stays in devDeps from Task 3's untouched root deps).

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

In `CLAUDE.md`, update the dev/build/test/lint/format commands to their `vp` equivalents. Replace the dev-server line `npm run start` (website) references with `vp dev`; the build `npx vite build` with `vp build`; `npx playwright test` references stay but note the script is now `npm run test:e2e` / `vp run test:e2e`; the type-check commands are unchanged (`npm run type-check:gate`). Replace the `npm run test:scripts` reference (gate tests) with a note that gate tests now run under `vp test`. Add a short "Vite+ toolchain" subsection stating: `vp` is the unified CLI; lint/format/test config live in the root `vite.config.ts` (`lint`/`fmt`/`test` blocks); `npm run lint`/`format` now require `vp` on PATH.

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
