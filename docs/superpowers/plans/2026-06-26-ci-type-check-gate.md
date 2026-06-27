# CI Type-Check Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single PR-triggered CI workflow that runs the project's full quality suite - prettier format check, eslint, and a TypeScript error-count gate (baseline 87) - so formatting, lint, and type debt all stop slipping through on PRs; and gate the blueprint-decode `console.log` behind the existing Debug flag instead of always logging.

**Architecture:** A small dependency-free Node script (`scripts/type-check-gate.mjs`) runs `tsc --noEmit -p packages/editor/tsconfig.json`, counts the diagnostics, and compares the count to a committed baseline file. Its pure logic is unit-tested with Node's built-in `node:test`. A new GitHub Actions workflow (`ci.yml`) runs `prettier . --check`, `eslint`, and the type-check gate on pull requests and pushes to the main branch. A final independent task wraps the stray `console.log(data)` in `if (G.debug)` so it only fires when the Debug checkbox is on.

**Tech Stack:** Node.js (version from `.nvmrc`, currently `lts/*`), TypeScript 5.9 (`tsc`), prettier 3.8.5, eslint 10.6.0, GitHub Actions, built-in `node:test` / `node:child_process` (no new dependencies).

## Global Constraints

- Node version comes from `.nvmrc` (`lts/*`); do not pin a different version.
- Add NO new runtime or dev dependencies - use only built-in `node:test`, `node:child_process`, `node:fs`, `node:url`, `node:path`.
- The project formatter is **prettier** (config `.prettierrc.yml`, scripts `format` / `format:fix`). Do NOT introduce `deno fmt` or any other formatter - that would fight prettier's rules.
- Gate target is `packages/editor/tsconfig.json` only. Current baseline is exactly **87** errors. The root and website tsconfigs each report a single spurious TS2688 (`typed-factorio/prototype` resolution) and are out of scope.
- Do NOT change the `typescript` or `typed-factorio` versions - both majors are intentionally held back.
- Invoke `tsc` with `--pretty false` so each diagnostic is one stable, parseable line.
- CI uses the latest action majors, matching `.github/workflows/deploy.yml`: `actions/checkout@v7` (latest v7.0.0) and `actions/setup-node@v6` (latest v6.4.0). Pin to the major so patch/minor float to newest. The job installs with `npm ci` (uses the current lockfile) and reads Node from `.nvmrc` (`lts/*`).
- Shell commands are written in fish syntax.
- All prose and code comments use hyphens (`-`), never em or en dashes.
- The format gate checks the whole repo (`.prettierignore` does not exclude `scripts/`, `docs/`, or `.github/`). After creating or editing ANY file - scripts, workflow YAML, even this plan doc - make sure it passes `npm run format`; run `npm run format:fix` and re-commit if needed. The prettier style is `tabWidth: 4, semi: false, singleQuote: true, trailingComma: es5, arrowParens: avoid`, with YAML at `tabWidth: 2`.

---

## File Structure

- `scripts/type-check-gate.mjs` (create) - the gate: pure helpers `countErrors` and `evaluateGate`, plus a guarded `main` that runs `tsc` and exits non-zero on regression.
- `scripts/type-check-gate.test.mjs` (create) - `node:test` unit tests for `countErrors` and `evaluateGate`. Imports the helpers only; the gate's `main` is guarded so importing has no side effects.
- `scripts/type-check-baseline.json` (create) - the committed baseline: target project path and `maxErrors`.
- `package.json` (modify) - add `type-check:gate` and `test:scripts` npm scripts.
- `.github/workflows/ci.yml` (create) - PR + push workflow that runs prettier check, eslint, and the type-check gate.
- `packages/editor/src/core/bpString.ts` (modify) - import `G` and wrap the stray `console.log(data)` in `decode` with `if (G.debug)`.

---

## Task 1: Gate logic with unit tests

**Files:**

- Create: `scripts/type-check-gate.mjs`
- Test: `scripts/type-check-gate.test.mjs`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
    - `countErrors(tscOutput: string): number` - counts lines matching `/error TS\d+/`, excluding the `Found N errors` summary line.
    - `evaluateGate({ count: number, baseline: number }): { status: 'pass' | 'fail' | 'improved', count: number, baseline: number }` - `fail` when `count > baseline`, `improved` when `count < baseline`, `pass` when equal.

- [ ] **Step 1: Write the failing test**

Create `scripts/type-check-gate.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countErrors, evaluateGate } from './type-check-gate.mjs'

const SAMPLE_TSC_OUTPUT = [
    "src/core/spriteDataBuilder.ts(10,5): error TS2339: Property 'x' does not exist on type 'Y'.",
    "src/core/spriteDataBuilder.ts(22,9): error TS2345: Argument of type 'A' is not assignable.",
    "src/core/bpString.ts(30,1): error TS2322: Type 'string' is not assignable to type 'number'.",
    'Found 3 errors in 2 files.',
    '',
].join('\n')

test('countErrors counts diagnostic lines and ignores the summary line', () => {
    assert.equal(countErrors(SAMPLE_TSC_OUTPUT), 3)
})

test('countErrors returns 0 for clean output', () => {
    assert.equal(countErrors(''), 0)
})

test('evaluateGate fails when count exceeds baseline', () => {
    assert.deepEqual(evaluateGate({ count: 88, baseline: 87 }), {
        status: 'fail',
        count: 88,
        baseline: 87,
    })
})

test('evaluateGate passes when count equals baseline', () => {
    assert.deepEqual(evaluateGate({ count: 87, baseline: 87 }), {
        status: 'pass',
        count: 87,
        baseline: 87,
    })
})

test('evaluateGate reports improvement when count drops below baseline', () => {
    assert.deepEqual(evaluateGate({ count: 80, baseline: 87 }), {
        status: 'improved',
        count: 80,
        baseline: 87,
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/type-check-gate.test.mjs`
Expected: FAIL - cannot import `./type-check-gate.mjs` because the file does not exist yet (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/type-check-gate.mjs`:

```js
// Counts TypeScript diagnostics from `tsc --pretty false` output and compares
// the total to a committed baseline so CI can block regressions without
// requiring a zero-error codebase.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ERROR_LINE = /error TS\d+/

export function countErrors(tscOutput) {
    return tscOutput.split('\n').filter(line => ERROR_LINE.test(line)).length
}

export function evaluateGate({ count, baseline }) {
    if (count > baseline) return { status: 'fail', count, baseline }
    if (count < baseline) return { status: 'improved', count, baseline }
    return { status: 'pass', count, baseline }
}

function runTsc(project) {
    // tsc exits non-zero when there are errors; its diagnostics land on stdout.
    // `--pretty false` keeps each diagnostic on one parseable line.
    try {
        return execFileSync('npx', ['tsc', '--noEmit', '--pretty', 'false', '-p', project], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    } catch (e) {
        return `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
}

function main() {
    const here = dirname(fileURLToPath(import.meta.url))
    const baselinePath = join(here, 'type-check-baseline.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    const repoRoot = join(here, '..')
    const output = runTsc(join(repoRoot, baseline.project))
    const count = countErrors(output)
    const result = evaluateGate({ count, baseline: baseline.maxErrors })

    if (result.status === 'fail') {
        console.error(
            `Type-check gate FAILED: ${count} errors against baseline ${baseline.maxErrors}.`
        )
        console.error(
            'New type errors were introduced. Fix them, or if intentional update scripts/type-check-baseline.json.'
        )
        console.error(output)
        process.exit(1)
    }

    if (result.status === 'improved') {
        console.log(
            `Type-check improved: ${count} errors (baseline ${baseline.maxErrors}). ` +
                `Lower "maxErrors" in scripts/type-check-baseline.json to ${count} to lock in the gain.`
        )
        process.exit(0)
    }

    console.log(`Type-check gate passed: ${count} errors (at baseline ${baseline.maxErrors}).`)
    process.exit(0)
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/type-check-gate.test.mjs`
Expected: PASS - all 5 tests pass (`# pass 5`, `# fail 0`).

- [ ] **Step 5: Commit**

```fish
git add scripts/type-check-gate.mjs scripts/type-check-gate.test.mjs
git commit -m "feat: add type-check gate logic with unit tests"
```

---

## Task 2: Baseline file and npm scripts, wired end-to-end

**Files:**

- Create: `scripts/type-check-baseline.json`
- Modify: `package.json` (scripts block)

**Interfaces:**

- Consumes: `scripts/type-check-gate.mjs` (the `main` entry point) and `scripts/type-check-gate.test.mjs` from Task 1.
- Produces:
    - npm script `type-check:gate` -> `node scripts/type-check-gate.mjs`
    - npm script `test:scripts` -> `node --test scripts/`
    - baseline file shape `{ "project": "packages/editor/tsconfig.json", "maxErrors": 87 }`

- [ ] **Step 1: Create the baseline file**

Create `scripts/type-check-baseline.json`:

```json
{
    "project": "packages/editor/tsconfig.json",
    "maxErrors": 87
}
```

- [ ] **Step 2: Add npm scripts**

In `package.json`, inside the `"scripts"` object, add these two entries next to the existing `"type-check"` entry (which stays unchanged):

```json
        "type-check:gate": "node scripts/type-check-gate.mjs",
        "test:scripts": "node --test scripts/",
```

The relevant region of `"scripts"` should read:

```json
        "build:website": "npm --workspace=@fbe/website run build",
        "type-check": "tsc",
        "type-check:gate": "node scripts/type-check-gate.mjs",
        "test:scripts": "node --test scripts/",
        "lint": "eslint .",
```

- [ ] **Step 3: Run the gate against the real editor config to verify it passes at baseline**

Run: `npm run type-check:gate`
Expected: exit code 0 and the line `Type-check gate passed: 87 errors (at baseline 87).`

If the count printed is not 87, the editor type debt changed since this plan was written. Do NOT silently edit the baseline to whatever number appears. Stop and confirm the new number is intentional (for example, a genuine fix lowered it) before updating `maxErrors`.

- [ ] **Step 4: Verify the gate actually catches a regression (temporary, reverted)**

Introduce a deliberate type error, confirm the gate fails, then revert it.

Run:

```fish
printf '\nconst __gate_probe: number = "not a number"\n' >> packages/editor/src/core/bpString.ts
npm run type-check:gate; echo "exit: $status"
```

Expected: the gate prints `Type-check gate FAILED: 88 errors against baseline 87.` and `exit: 1`.

Now revert the probe:

```fish
git checkout -- packages/editor/src/core/bpString.ts
npm run type-check:gate; echo "exit: $status"
```

Expected: back to `Type-check gate passed: 87 errors (at baseline 87).` and `exit: 0`.

- [ ] **Step 5: Run the script unit tests via the new npm script**

Run: `npm run test:scripts`
Expected: PASS (`# pass 5`, `# fail 0`).

- [ ] **Step 6: Commit**

```fish
git add scripts/type-check-baseline.json package.json
git commit -m "feat: wire type-check gate npm scripts and baseline"
```

---

## Task 3: PR-triggered CI workflow (format + lint + type-check)

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: the existing `format` (`prettier . --check`) and `lint` (`eslint .`) npm scripts, plus `type-check:gate` from Task 2.
- Produces: a CI workflow named `CI` that runs on pull requests and pushes targeting `wormeyman-space-age-support`, plus manual dispatch. It runs all three checks; later steps use `if: ${{ !cancelled() }}` so one failure still reports the others.

- [ ] **Step 1: Confirm the format and lint scripts pass locally before gating on them**

A CI gate is only safe to add once the repo already satisfies it. Run both:

```fish
npm run format
npm run lint
```

Expected: `format` prints `All matched files use Prettier code style!` (exit 0); `lint` exits 0 with no errors. If either fails, STOP - run `npm run format:fix` / `npm run lint:fix`, review and commit those fixes as their own commit first, then continue. Do not add a gate the main branch cannot pass.

- [ ] **Step 2: Create the workflow file**

Create `.github/workflows/ci.yml`:

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

            - name: Set up Node
              uses: actions/setup-node@v6
              with:
                  node-version-file: .nvmrc
                  cache: npm

            - name: Install dependencies
              run: npm ci

            - name: Format check (prettier)
              if: ${{ !cancelled() }}
              run: npm run format

            - name: Lint (eslint)
              if: ${{ !cancelled() }}
              run: npm run lint

            - name: Type-check gate
              if: ${{ !cancelled() }}
              run: npm run type-check:gate
```

- [ ] **Step 3: Validate the workflow YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
Expected: prints `yaml ok` with no traceback.

- [ ] **Step 4: Re-run all three checks locally to confirm the exact commands the workflow invokes pass**

Run:

```fish
npm run format; and npm run lint; and npm run type-check:gate
```

Expected: prettier reports all files formatted, eslint exits clean, and the gate prints `Type-check gate passed: 87 errors (at baseline 87).` (overall exit 0).

- [ ] **Step 5: Commit**

```fish
git add .github/workflows/ci.yml
git commit -m "ci: add PR workflow running prettier, eslint, and type-check gate"
```

---

## Task 4: Gate the blueprint-decode log behind the Debug flag

**Files:**

- Modify: `packages/editor/src/core/bpString.ts`

**Interfaces:**

- Consumes: the global `G` (default export of `packages/editor/src/common/globals.ts`), whose `debug: boolean` property is driven by the Debug checkbox in `packages/website/src/settingsPane.ts` (via `editor.debug` -> `G.debug`). This task is independent of Tasks 1-3 and may be done in any order.
- Produces: no API change. The `console.log(data)` in `decode` now fires only when `G.debug` is true, so a normal blueprint load no longer dumps the entire parsed blueprint to the console.

Background: `G` is already the editor's global object, imported elsewhere as `import G from '../common/globals'` (for example in `Editor.ts` and `actions.ts`). `bpString.ts` does not import it yet. There is no circular-import risk - nothing in `globals.ts`'s import chain (`Blueprint`, `UIContainer`, `BlueprintContainer`, `actions`) imports `bpString`.

- [ ] **Step 1: Confirm the unconditional log is present**

Run: `grep -n 'console.log(data)' packages/editor/src/core/bpString.ts`
Expected: one match inside the `decode` function's `.then(data => {` block (around line 180).

- [ ] **Step 2: Add the `G` import**

In `packages/editor/src/core/bpString.ts`, add the globals import alongside the other local imports. Change:

```ts
import { IBlueprint, IBlueprintBook, IBlueprintBookEntry } from '../types'
import FD from './factorioData'
```

to:

```ts
import { IBlueprint, IBlueprintBook, IBlueprintBookEntry } from '../types'
import G from '../common/globals'
import FD from './factorioData'
```

- [ ] **Step 3: Gate the log behind `G.debug`**

In the same file, change:

```ts
    }).then(data => {
        console.log(data)
        loadWarnings = []
```

to:

```ts
    }).then(data => {
        if (G.debug) console.log(data)
        loadWarnings = []
```

- [ ] **Step 4: Verify the log is now gated and the import is present**

Run:

```fish
grep -n 'if (G.debug) console.log(data)' packages/editor/src/core/bpString.ts
grep -n "import G from '../common/globals'" packages/editor/src/core/bpString.ts
```

Expected: one match for each grep.

- [ ] **Step 5: Verify the editor still type-checks at baseline (the import/guard must not change the count)**

Run: `npm run type-check:gate`
Expected: exit 0, `Type-check gate passed: 87 errors (at baseline 87).`

- [ ] **Step 6: Verify the bundle still builds (catches any import-resolution or cycle break)**

Run: `npm run build:website`
Expected: vite build completes successfully with no errors.

- [ ] **Step 7: Commit**

```fish
git add packages/editor/src/core/bpString.ts
git commit -m "chore: gate blueprint decode log behind debug flag"
```

---

## Notes for the executor

- The gate is intentionally count-based, not a per-error snapshot. It blocks any net increase above 87 while letting unrelated line numbers churn freely. If a future task wants exact new-error detection, that is a separate enhancement.
- When real fixes lower the count, the gate prints `improved` and passes - it never fails on improvement. Lowering `maxErrors` in `scripts/type-check-baseline.json` to the new number is a deliberate, reviewable follow-up commit.
- The existing root `type-check` script (`tsc`) is left as-is. It reports one spurious TS2688 because the root tsconfig cannot resolve `typed-factorio/prototype`; fixing that is out of scope for this plan.
