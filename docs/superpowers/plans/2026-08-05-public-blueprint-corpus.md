# Public blueprint corpus implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gitignored `wormeyman-tests/` corpus with a committed, publicly redistributable `test-blueprints/`, so that the nine corpus-driven Playwright specs pass on a fresh clone instead of failing at `expect(files.length).toBeGreaterThan(0)`.

**Architecture:** The corpus becomes 12 committed files - the four ElderAxe books already on disk, byte-identical, plus eight factorio.school blueprints by Jepakazol. Because five sets of pinned fixture values are keyed to corpus membership, a throwaway recorder is built and proved against the corpus _as it stands today_ before anything is deleted; only once it reproduces the committed fixtures byte-for-byte is the corpus swapped and the fixtures re-recorded. The recorder is deleted in the final task, the same way `tools/oracle/` treats a probe.

**Tech Stack:** Playwright (browser specs, needs both dev servers), `vp` (Vite+ CLI: format, lint, type check, unit tests), Node for offline blueprint decoding, git.

Design spec: `/Users/ericjohnson/GitHub/factorio-blueprint-editor/docs/superpowers/specs/2026-08-05-public-blueprint-corpus-design.md`. Closes #186.

## Global Constraints

- **Do not delete `wormeyman-tests/AVADII/` until Task 2's control has passed.** Once it is gone the control is impossible and every re-recorded digest becomes unfalsifiable. A `new ⊆ old` subset check is not a substitute: adding blueprints introduces genuinely new digests, so the subset relation does not hold.
- **`wormeyman-tests/` was never committed.** `rm -rf` on it is permanent data loss. Task 4 _moves_ it out of the repo to `~/fbe-wormeyman-tests-archive-2026-08-05/` instead.
- **Hyphens, never em dashes or en dashes**, in every file touched - source, comments, markdown.
- **Never put an issue number in a commit subject.** `Closes #186` goes in the commit body. PRs are squash-merged and GitHub appends the PR number to the subject.
- **PRs target `wormeyman-space-age-support`**, this repo's default branch. Not `main`, not the `teoxoy` upstream.
- **`vp` flags go before paths.** `vp check --fix .` works; `vp check . --fix` fails with a misleading `no such flag: --fix` error.
- **Playwright needs both dev servers.** `npm run localpreview` from the repo root, in a separate terminal, before any `npx playwright test`. It starts Vite on 8080 and the sprite data server on 8081 and stops both on Ctrl-C. Do not hand-start them - they fail quietly on a port clash.
- The branch is `public-blueprint-corpus`, already checked out, 2 commits ahead of `wormeyman-space-age-support`.

## Measurements this plan is built on

All measured on 2026-08-05 against the working tree, before any change. Two are corrections to the design spec; they are marked.

| Quantity                                               | Old corpus (10 files) | New corpus (12 files) |
| ------------------------------------------------------ | --------------------- | --------------------- |
| Files discovered                                       | 10                    | 12                    |
| Flattened blueprints                                   | **578**               | **367**               |
| Versioned blueprints + books                           | 670                   | 402                   |
| Declared version range                                 | 2.0.45 - 2.0.73       | 2.0.32 - 2.1.12       |
| Raw entities                                           | 408,290               | 347,725               |
| Raw tiles                                              | 426,868               | 232,815               |
| Entities carrying `request_filters`                    | 4,639                 | 5,995                 |
| `request_filters` sections                             | 4,645                 | 6,017                 |
| `request_filters` section indexes seen                 | 1, 2                  | 1, 2, 3               |
| Filters total (all carry `quality` + `comparator`)     | 3,461                 | 4,069                 |
| Objects carrying `request_from_buffers`                | 433                   | 728                   |
| Objects carrying `trash_not_requested`                 | 54                    | 36                    |
| Objects with a second section                          | 14                    | 19                    |
| Largest section-0 filter list                          | 5                     | **19**                |
| `control_behavior` sections (indexes 1-15, contiguous) | 1,295                 | 1,344                 |
| `control_behavior.filters` (pre-2.0 shape)             | 0                     | 0                     |
| `request_filters` as a flat array (pre-2.0 shape)      | 0                     | 0                     |
| `stack-inserter` entities                              | 9,479                 | 2,790                 |
| Corpus size on disk                                    | 5.75 MB               | 4.68 MB               |

The measuring script reproduced the committed 578 / 408,290 / 426,868 / 4,639 / 4,645 / 3,461 / 433 / 54 / 14 / 5 exactly, which is what makes its new numbers usable.

**Three figures already in the repo did not reconcile, and the reasons matter:**

- `tests/pre-2-0-shape-migrations.spec.ts:154` says **1452** `control_behavior` sections. The discovered corpus has 1,295. The missing 157 are all in `wormeyman-tests/a.txt`, the stray top-level file that `discoverBlueprintFiles()` never reads because it only walks directories. That figure was measured over files the suite does not see.
- `tests/chest-filters.spec.ts:33` says **4631** entities carry a `request_filters` object; the measurement is 4,639, and it is 4,639 in `tests/paste-filter-cap.spec.ts:29` too. The two committed figures already disagree with each other. Neither corresponds to a chest-only count (3,657).
- `tests/name-migrations.spec.ts:15` says **9535** stack inserters; this plan's measurement of the archived `wormeyman-tests/` corpus gives 9,479, and `a.txt` contributes none of it. The two are not necessarily the same corpus - the EARN books carry revision numbers in their filenames and the gitignored corpus predates git history, so there is no way to tell whether 9535 was wrong when written or the corpus simply moved on since. Neither figure is asserted as fact; both are recorded and the discrepancy is left open, matching how the corrected prose in `tests/name-migrations.spec.ts` and `tests/blueprint-round-trip.spec.ts` now frames it.

**Two gaps in the design spec, both resolved before this plan was written:**

1. The spec lists `tests/entity-container-mappings.spec.ts` as needing no edits. It does: line 29 names `AVADII/Alpha Cygni Blueprints 1.3` and line 73 pins `small.entities === 2`. Task 4 replaces it with `EARN/earn-v22-0-12.rev-2` at 69 entities (chosen: smallest first entry in the new corpus, still a book, 3.5x under BIG's 243).
2. `discoverBlueprintFiles()` uses raw `readdirSync` order, and `blueprint-round-trip`'s `serializedHash` is order-dependent. Task 1 adds an explicit sort. Measured: today's readdir order on this machine is already alphabetical, so the sort is a no-op here and Task 2's byte-identical control still holds.

**Provenance, verified live on 2026-08-05:** every one of the eight Jepakazol files staged at `/tmp/jepa/` is byte-identical to `https://facorio-blueprints.firebaseio.com/blueprints/<key>.json` field `blueprintString` after `.trim()`, and every heart count matches the design spec's table. All twelve files decode clean against `packages/exporter/data/output/data.json` with zero unknown entity names and zero unknown tile names.

## File structure

| File                                      | Responsibility                                      | Fate                 |
| ----------------------------------------- | --------------------------------------------------- | -------------------- |
| `tests/helpers/blueprint-files.ts`        | corpus discovery; `TESTS_DIR` and sort order        | modified             |
| `playwright.recorder.config.ts`           | runs `*.recorder.ts` only, outside the normal suite | created then deleted |
| `tests/record-fixtures.recorder.ts`       | the throwaway recorder                              | created then deleted |
| `test-blueprints/EARN/*.txt`              | four ElderAxe books, byte-identical copies          | created              |
| `test-blueprints/JEPAKAZOL/*.txt`         | eight Jepakazol blueprints                          | created              |
| `test-blueprints/README.md`               | attribution and provenance                          | created              |
| `tests/__fixtures__/sprite-data.json`     | 5 digest halves; `noGridReal` and `real` move       | modified             |
| `tests/entity-accessors.spec.ts`          | inline `EXPECTED`                                   | modified             |
| `tests/blueprint-round-trip.spec.ts`      | inline `EXPECTED`                                   | modified             |
| `tests/overlay-container.spec.ts`         | inline `EXPECTED_REAL`                              | modified             |
| `tests/entity-container-mappings.spec.ts` | `SMALL` constant and its pinned count               | modified             |
| `tests/sprite-generation.spec.ts`         | `EXPECTED_FAILURES`, only if the run says so        | maybe modified       |
| `.gitignore`                              | drop `/wormeyman-tests`                             | modified             |
| `CONTRIBUTING.md`                         | the "gitignored and not distributed" paragraph      | modified             |
| `CLAUDE.md`                               | corpus path, counts, version range                  | modified             |
| five spec header comments                 | corpus figures quoted in prose                      | modified             |

---

## Task 1: Deterministic corpus file ordering

**Files:**

- Modify: `tests/helpers/blueprint-files.ts:22-28`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `discoverBlueprintFiles(): BlueprintFile[]` with the same signature, now returning collections and files in `localeCompare` order. Every later task depends on this ordering being stable, because `blueprint-round-trip`'s `serializedHash` folds the blueprints in iteration order.

**Why first:** the sort is a no-op on this machine (measured - `readdirSync` already returns `["AVADII","EARN","NILAUS"]` and the alphabetical file lists), so landing it before the recorder means the recorder's byte-identical control also proves the sort changed nothing. Landing it after would mix an ordering change into the corpus diff.

- [ ] **Step 1: Confirm the sort is a no-op before changing anything**

Run:

```bash
node -e "
const fs=require('fs'),path=require('path');
const d='wormeyman-tests';
const cols=fs.readdirSync(d,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name);
const ok=(a)=>JSON.stringify(a)===JSON.stringify([...a].sort((x,y)=>x.localeCompare(y)));
let all=ok(cols);
for(const c of cols){const f=fs.readdirSync(path.join(d,c)).filter(x=>x.endsWith('.txt'));all=all&&ok(f)}
console.log(all?'ALREADY SORTED - sort is a no-op here':'NOT SORTED - see note below');
"
```

Expected: `ALREADY SORTED - sort is a no-op here`.

If it prints `NOT SORTED`, stop and say so. The sort is still correct, but it will move `serializedHash`, so it must be landed with a deliberately re-recorded `blueprint-round-trip` fixture and Task 2's control must then be run _after_ Task 1 rather than treating the two as independent.

- [ ] **Step 2: Add the sort**

In `tests/helpers/blueprint-files.ts`, replace lines 22-28:

```typescript
    const collections = fs
        .readdirSync(TESTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())

    for (const collection of collections) {
        const collectionPath = path.join(TESTS_DIR, collection.name)
        const txtFiles = fs.readdirSync(collectionPath).filter(f => f.endsWith('.txt'))
```

with:

```typescript
    /*
        Sorted explicitly rather than left to readdirSync. Directory order is a
        filesystem property - APFS and ext4 both return hash order, not name
        order - and blueprint-round-trip.spec.ts folds the corpus into a single
        serializedHash in iteration order. Unsorted, that fixture is a fixed
        point only on the machine that recorded it, which is the one thing a
        committed corpus must not be.
    */
    const collections = fs
        .readdirSync(TESTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))

    for (const collection of collections) {
        const collectionPath = path.join(TESTS_DIR, collection.name)
        const txtFiles = fs
            .readdirSync(collectionPath)
            .filter(f => f.endsWith('.txt'))
            .sort((a, b) => a.localeCompare(b))
```

- [ ] **Step 3: Prove no fixture moved**

With `npm run localpreview` running in another terminal:

```bash
npx playwright test tests/blueprint-round-trip.spec.ts
```

Expected: PASS, 1 test. `serializedHash` is the order-sensitive value, so a pass is the proof.

- [ ] **Step 4: Check formatting, lint and types**

```bash
vp check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/blueprint-files.ts
git commit -m "$(cat <<'EOF'
test: sort corpus discovery so serializedHash does not depend on the filesystem

readdirSync returns directory order, which APFS and ext4 both derive from a
hash rather than from the name. blueprint-round-trip.spec.ts folds the whole
corpus into one serializedHash in iteration order, so that fixture was a fixed
point only on the machine that recorded it. Verified a no-op here: the order
readdirSync already returns is the sorted one, and the spec passes untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ErAwBHYHrkdJdmwYhHGGxq
EOF
)"
```

---

## Task 2: The fixture recorder and its byte-identical control

**Files:**

- Create: `playwright.recorder.config.ts`
- Create: `tests/record-fixtures.recorder.ts`

**Interfaces:**

- Consumes: `discoverBlueprintFiles()` / `readBlueprintString()` from `tests/helpers/blueprint-files.ts`; `buildAllEntitiesBlueprint(directions: number[]): { source: string; names: string[] }` from `tests/helpers/all-entities-blueprint.ts`; `waitForEditor(page)`, `loadBlueprint(page, source)` and the `SpriteDataTally` type from `tests/helpers/fbe-test-api.ts`.
- Produces, into the directory named by `$FBE_RECORD_OUT`:
    - `sprite-data.json` - all five halves, in the key order `synthetic`, `noGrid`, `noGridReal`, `paintPreview`, `real`
    - `entity-accessors.EXPECTED.json` and `.ts.txt`
    - `blueprint-round-trip.EXPECTED.json` and `.ts.txt`
    - `overlay-container.EXPECTED_REAL.json` and `.ts.txt`

Each `.json` holds the raw recorded value; each `.ts.txt` is the same value rendered as a ready-to-paste TypeScript declaration. Both are written so that a change to the renderer can be re-applied without re-running the browser.

**Why the recorder duplicates the specs' measurement code instead of importing it:** importing a `.spec.ts` executes its top-level `test()` registrations into the importing file's suite. The duplication is also what makes the control meaningful - byte-identical output from an independent copy is evidence the copy measures the same thing.

**Why one Playwright `test()` per fixture half:** `EntitySprite.getParts` fills `filename` in from `filenames` on the prototype objects out of `data.json`, not on copies, so rendering a blueprint mutates state the digest reads. `tests/sprite-data.spec.ts` documents this at its head. Each half must therefore run on its own fresh page, with exactly the same sequence of loads the original spec performs.

- [ ] **Step 1: Prove the emit -> format -> diff loop converges, before spending an hour recording**

The control is "apply the recorder's output and `git diff` is empty". That only works if `vp check --fix` normalises a mechanically-emitted file to the exact committed text. Test that against the fixture that already exists, on a 30-second round trip:

```bash
node -e "
const fs=require('fs');const p='tests/__fixtures__/sprite-data.json';
fs.writeFileSync(p, JSON.stringify(JSON.parse(fs.readFileSync(p,'utf8')), null, 4) + '\n');
"
vp check --fix .
git diff --exit-code tests/__fixtures__/sprite-data.json && echo "CONVERGES"
```

Expected: `CONVERGES`, and `git status --short` shows no modified files.

If the diff is non-empty, read it. It will be a formatting difference only (`vp fmt` collapsing arrays onto one line is the likely one). Restore with `git checkout tests/__fixtures__/sprite-data.json`, and adjust Step 3's `writeJson` helper to emit whatever shape converges - the values are not in question here, only the text around them.

- [ ] **Step 2: Write the recorder config**

Create `playwright.recorder.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

/*
    THROWAWAY. Deleted before the PR for #186 lands - a measuring instrument,
    not a test, the same way tools/oracle/ treats a probe.

    Kept out of playwright.config.ts on purpose: that config's testMatch is
    Playwright's default (**/*.@(spec|test).?(c|m)[jt]s?(x)), which does not
    match *.recorder.ts, so `npx playwright test` never picks the recorder up.
    Run it deliberately:

      FBE_RECORD_OUT=<dir> npx playwright test --config=playwright.recorder.config.ts
*/
const baseURL = process.env.FBE_BASE_URL ?? 'http://localhost:8080'

export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.recorder.ts',
    // The corpus walks are minutes each, not seconds - the normal 120s is for
    // one spec, and the recorder replays five of them back to back.
    timeout: 900_000,
    expect: { timeout: 120_000 },
    use: { baseURL, headless: true },
    retries: 0,
    workers: 1,
    reporter: [['list']],
})
```

- [ ] **Step 3: Write the recorder**

Create `tests/record-fixtures.recorder.ts`:

```typescript
import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { buildAllEntitiesBlueprint } from './helpers/all-entities-blueprint'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'
import { loadBlueprint, waitForEditor, SpriteDataTally } from './helpers/fbe-test-api'

/*
    THROWAWAY. Deleted before the PR for #186 lands.

    Re-records the four sets of pinned values that are keyed to corpus
    membership, for the one change that legitimately moves them: the corpus
    itself being replaced. These fixtures are fixed points and the repo
    deliberately has no re-record path; this is a measuring instrument that
    exists for one change and then goes, the same way tools/oracle/ treats a
    probe.

    Every measurement below is copied verbatim from the spec that owns it. That
    duplication is the point rather than a shortcut: run against the corpus as
    it stands today, this must reproduce the committed fixtures byte for byte,
    and an independent copy agreeing to the byte is what makes anything it says
    afterwards trustworthy. Run against a corpus it cannot reproduce, nothing it
    produces means anything.

    One test per fixture half, because each needs a fresh page.
    EntitySprite.getParts fills `filename` in from `filenames` on the prototype
    objects out of data.json rather than on copies, so rendering a blueprint
    mutates state the digest reads - see the note at the head of
    tests/sprite-data.spec.ts.
*/

const OUT = process.env.FBE_RECORD_OUT ?? path.resolve(process.cwd(), 'recorder-out')

/** Cardinals only - must match sprite-data.spec.ts and overlay-container.spec.ts. */
const DIRECTIONS = [0, 4, 8, 12]

type Page = import('@playwright/test').Page

// ---------------------------------------------------------------- output

function writeJson(name: string, value: unknown): void {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 4) + '\n')
}

/**
 * A TypeScript object literal in this repo's house style: identifier keys
 * unquoted, everything else single quoted, 4-space indent, trailing commas.
 * Line wrapping is left to `vp check --fix`, which is deterministic, so two
 * renderings that agree on values and key order converge on identical text.
 */
function toTs(value: unknown, indent = 0): string {
    const pad = ' '.repeat(indent)
    const inner = ' '.repeat(indent + 4)
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]'
        return `[${value.map(v => toTs(v, indent + 4)).join(', ')}]`
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
        if (entries.length === 0) return '{}'
        const body = entries
            .map(([k, v]) => {
                const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : `'${k}'`
                return `${inner}${key}: ${toTs(v, indent + 4)},`
            })
            .join('\n')
        return `{\n${body}\n${pad}}`
    }
    if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
    return String(value)
}

function writeTs(name: string, declaration: string, value: unknown): void {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, name), `${declaration} = ${toTs(value)}\n`)
}

// ------------------------------------------- copied from sprite-data.spec.ts

/** Same digests, entities in name order. */
function sortKeys(digests: SpriteDataTally): Record<string, string[]> {
    return Object.fromEntries(Object.entries(digests).sort(([a], [b]) => a.localeCompare(b)))
}

/** Sorted distinct digests per entity. */
function summarise(digests: Record<string, Iterable<string>>): Record<string, string[]> {
    return Object.fromEntries(
        Object.entries(digests)
            .map(([name, seen]) => [name, [...new Set(seen)].sort()] as const)
            .sort(([a], [b]) => a.localeCompare(b))
    )
}

async function tallyFor(page: Page, source: string): Promise<SpriteDataTally> {
    await loadBlueprint(page, source)
    return page.evaluate(() => window.__fbe_test.spriteDataTally())
}

/*
    Assembled across five tests and written once, so the key order matches the
    committed file: synthetic, noGrid, noGridReal, paintPreview, real. Playwright
    runs a file's tests in declaration order at workers: 1.
*/
const spriteData: Record<string, Record<string, string[]>> = {}

test('record sprite-data: synthetic', async ({ page }) => {
    await waitForEditor(page)
    const { source, names } = buildAllEntitiesBlueprint(DIRECTIONS)
    expect(names.length).toBeGreaterThan(100)
    spriteData.synthetic = summarise(await tallyFor(page, source))
})

test('record sprite-data: noGrid', async ({ page }) => {
    await waitForEditor(page)
    const { source } = buildAllEntitiesBlueprint(DIRECTIONS)
    await loadBlueprint(page, source)
    const tally = await page.evaluate(() =>
        window.__fbe_test.spriteDataTally(undefined, { withGrid: false })
    )
    spriteData.noGrid = summarise(tally)
})

test('record sprite-data: noGridReal', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)
    await waitForEditor(page)

    const sources = files.map(f => readBlueprintString(f.filePath))
    const tally = await page.evaluate(async (strings: string[]) => {
        const api = window.__fbe_test
        const out: Record<string, string[]> = {}
        for (const str of strings) {
            const loaded = await api.getBlueprintOrBookFromSource(str)
            const isBook = typeof loaded.selectBlueprint === 'function'
            const count = isBook ? (loaded.lastBookIndex ?? 0) + 1 : 1
            for (let i = 0; i < count; i++) {
                const blueprint = isBook ? loaded.selectBlueprint(i) : loaded
                for (const [name, digests] of Object.entries(
                    api.spriteDataTally(blueprint, { withGrid: false })
                )) {
                    ;(out[name] ??= []).push(...digests)
                }
            }
        }
        return out
    }, sources)

    spriteData.noGridReal = summarise(tally)
})

test('record sprite-data: paintPreview', async ({ page }) => {
    await waitForEditor(page)
    const tally = await page.evaluate(dirs => window.__fbe_test.paintPreviewTally(dirs), [
        ...DIRECTIONS,
        undefined,
    ] as (number | undefined)[])
    expect(Object.keys(tally).length).toBeGreaterThan(100)
    // Not summarised - one digest per entry of the directions array, in order.
    spriteData.paintPreview = sortKeys(tally)
})

test('record sprite-data: real', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)
    await waitForEditor(page)

    const sources = files.map(f => readBlueprintString(f.filePath))
    const { tally, blueprintCount, entitiesSeen } = await page.evaluate(
        async (strings: string[]) => {
            const api = window.__fbe_test
            const out: Record<string, string[]> = {}
            let blueprintCount = 0
            let entitiesSeen = 0

            for (const str of strings) {
                const loaded = await api.getBlueprintOrBookFromSource(str)
                const isBook = typeof loaded.selectBlueprint === 'function'
                const count = isBook ? (loaded.lastBookIndex ?? 0) + 1 : 1

                for (let i = 0; i < count; i++) {
                    const blueprint = isBook ? loaded.selectBlueprint(i) : loaded
                    blueprintCount += 1
                    for (const [name, digests] of Object.entries(api.spriteDataTally(blueprint))) {
                        entitiesSeen += digests.length
                        ;(out[name] ??= []).push(...digests)
                    }
                }
            }

            return { tally: out, blueprintCount, entitiesSeen }
        },
        sources
    )

    spriteData.real = summarise(tally)
    // Reported, not asserted - the spec pins them and this is what tells us what to.
    console.log(`RECORDED blueprintCount=${blueprintCount} entitiesSeen=${entitiesSeen}`)
    writeJson('sprite-data.counts.json', { blueprintCount, entitiesSeen })
})

// -------------------------------------- copied from entity-accessors.spec.ts

const TALLIED = [
    'recipe',
    'directionType',
    'railLayer',
    'filters',
    'filterSlots',
    'splitterInputPriority',
    'splitterOutputPriority',
    'filterMode',
    'trainStopColor',
    'station',
    'constantCombinatorFilters',
    'displayPanelIcon',
    'modules',
    'moduleSlots',
    'combinatorConditions',
    'inserterStackSize',
    'acceptedRecipes',
    'acceptedModules',
    'acceptedFilters',
    'possibleRotations',
    'canBeRotated',
    'maxWireDistance',
    'generateConnector',
    'assemblerHasFluidInputs',
    'mayCraftWithFluid',
] as const

type Tally = { value: number; empty: number; nothing: number; threw: number }

test('record entity-accessors EXPECTED', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)
    await waitForEditor(page)

    const sources = files.map(f => readBlueprintString(f.filePath))

    const tally = await page.evaluate(
        async ({ strings, accessors }: { strings: string[]; accessors: string[] }) => {
            const api = window.__fbe_test as unknown as Record<string, any>
            const out: Record<string, Tally> = {}
            const bump = (key: string, field: keyof Tally): void => {
                out[key] ??= { value: 0, empty: 0, nothing: 0, threw: 0 }
                out[key][field] += 1
            }

            let entityCount = 0
            let blueprintCount = 0

            for (const str of strings) {
                const loaded = await api.getBlueprintOrBookFromSource(str)
                const isBook = typeof loaded.selectBlueprint === 'function'
                const count = isBook ? loaded.lastBookIndex + 1 : 1

                for (let i = 0; i < count; i++) {
                    const bp = isBook ? loaded.selectBlueprint(i) : loaded
                    blueprintCount += 1
                    for (const e of bp.entities.values()) {
                        entityCount += 1
                        for (const key of accessors) {
                            let v: unknown
                            try {
                                v = e[key]
                            } catch {
                                bump(key, 'threw')
                                continue
                            }
                            if (v === undefined || v === null) bump(key, 'nothing')
                            else if (Array.isArray(v) && v.length === 0) bump(key, 'empty')
                            else bump(key, 'value')
                        }
                    }
                }
            }

            return { entityCount, blueprintCount, accessors: out }
        },
        { strings: sources, accessors: [...TALLIED] }
    )

    /*
        The spec asserts with toEqual, which ignores key order, and `out` is
        built in TALLIED order. The committed literal is ASCII-sorted, so sort
        here or the re-recorded block reorders 25 keys for no reason.
    */
    const recorded = {
        entityCount: tally.entityCount,
        blueprintCount: tally.blueprintCount,
        accessors: Object.fromEntries(
            Object.entries(tally.accessors).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        ),
    }

    writeJson('entity-accessors.EXPECTED.json', recorded)
    writeTs(
        'entity-accessors.EXPECTED.ts.txt',
        `const EXPECTED: {
    entityCount: number
    blueprintCount: number
    accessors: Record<string, Tally>
}`,
        recorded
    )
})

// ----------------------------------- copied from blueprint-round-trip.spec.ts

test('record blueprint-round-trip EXPECTED', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)
    await waitForEditor(page)

    const sources = files.map(f => readBlueprintString(f.filePath))

    const summary = await page.evaluate(async (strings: string[]) => {
        const api = window.__fbe_test as unknown as Record<string, any>

        const hashInto = (h: number, s: string): number => {
            let acc = h
            for (let i = 0; i < s.length; i++) {
                acc = ((acc << 5) + acc + s.charCodeAt(i)) | 0
            }
            return acc
        }

        let blueprints = 0
        let entities = 0
        let tiles = 0
        let wires = 0
        let icons = 0
        let threw = 0
        let positionChecksum = 0
        let modelPositionChecksum = 0
        let serializedHash = 5381

        for (const str of strings) {
            const loaded = await api.getBlueprintOrBookFromSource(str)
            const isBook = typeof loaded.selectBlueprint === 'function'
            const count = isBook ? loaded.lastBookIndex + 1 : 1

            for (let i = 0; i < count; i++) {
                const bp = isBook ? loaded.selectBlueprint(i) : loaded
                blueprints += 1

                for (const e of bp.entities.values()) {
                    modelPositionChecksum =
                        (modelPositionChecksum +
                            Math.round(e.position.x * 4) * 3 +
                            Math.round(e.position.y * 4) * 7) |
                        0
                }
                for (const t of bp.tiles.values()) {
                    modelPositionChecksum =
                        (modelPositionChecksum + Math.round(t.x) * 11 + Math.round(t.y) * 13) | 0
                }

                let obj: any
                try {
                    obj = bp.serialize()
                } catch {
                    threw += 1
                    continue
                }

                entities += obj.entities ? obj.entities.length : 0
                tiles += obj.tiles ? obj.tiles.length : 0
                wires += obj.wires ? obj.wires.length : 0
                icons += obj.icons ? obj.icons.length : 0

                for (const e of obj.entities ?? []) {
                    positionChecksum =
                        (positionChecksum +
                            Math.round(e.position.x * 4) * 3 +
                            Math.round(e.position.y * 4) * 7) |
                        0
                }

                serializedHash = hashInto(serializedHash, JSON.stringify(obj))
            }
        }

        return {
            blueprints,
            entities,
            tiles,
            wires,
            icons,
            threw,
            positionChecksum,
            modelPositionChecksum,
            serializedHash,
        }
    }, sources)

    writeJson('blueprint-round-trip.EXPECTED.json', summary)
    writeTs('blueprint-round-trip.EXPECTED.ts.txt', 'const EXPECTED', summary)
})

// ------------------------------------- copied from overlay-container.spec.ts

/** Sorted distinct counts, dropping entities that never draw anything. */
function summariseOverlay(counts: Record<string, Iterable<number>>): Record<string, number[]> {
    return Object.fromEntries(
        Object.entries(counts)
            .map(([name, seen]) => [name, [...new Set(seen)].sort((a, b) => a - b)] as const)
            .filter(([, seen]) => seen.some(c => c !== -1))
            .sort(([a], [b]) => a.localeCompare(b))
    )
}

test('record overlay-container EXPECTED_REAL', async ({ page }) => {
    const files = discoverBlueprintFiles()
    expect(files.length).toBeGreaterThan(0)
    await waitForEditor(page)

    const combined: Record<string, Set<number>> = {}
    let entitiesSeen = 0

    for (const file of files) {
        await loadBlueprint(page, readBlueprintString(file.filePath))
        const tally = await page.evaluate(() => window.__fbe_test.overlayInfoTally())
        for (const [name, counts] of Object.entries(tally)) {
            entitiesSeen += counts.length
            for (const c of counts) (combined[name] ??= new Set()).add(c)
        }
    }

    console.log(`RECORDED overlay entitiesSeen=${entitiesSeen}`)
    const recorded = summariseOverlay(combined)
    writeJson('overlay-container.EXPECTED_REAL.json', recorded)
    writeTs(
        'overlay-container.EXPECTED_REAL.ts.txt',
        'const EXPECTED_REAL: Record<string, number[]>',
        recorded
    )
})

// ----------------------------------------------------------------- assemble

const HALVES = ['synthetic', 'noGrid', 'noGridReal', 'paintPreview', 'real'] as const

test.afterAll(() => {
    /*
        Refuse to write a partial file. Running a subset with --grep leaves
        halves undefined, and a sprite-data.json missing one is silently wrong
        in exactly the way the whole control exists to rule out.
    */
    const missing = HALVES.filter(k => spriteData[k] === undefined)
    if (missing.length > 0) {
        console.log(`NOT WRITING sprite-data.json - halves not recorded: ${missing.join(', ')}`)
        return
    }
    writeJson('sprite-data.json', Object.fromEntries(HALVES.map(k => [k, spriteData[k]])))
})
```

- [ ] **Step 4: Type check the recorder before running it**

```bash
vp check
```

Expected: 0 errors, 0 warnings. `tests/` is owned by the root `tsconfig.json`, which has `node` in `types`, so `fs`/`path`/`process` resolve.

- [ ] **Step 5: Run the recorder against the corpus exactly as it stands today**

`wormeyman-tests/` must still hold AVADII, EARN, NILAUS and `a.txt`. Confirm first:

```bash
ls wormeyman-tests/
```

Expected: `a.txt  AVADII  EARN  NILAUS`.

With `npm run localpreview` running in another terminal:

```bash
REC=/private/tmp/claude-501/-Users-ericjohnson-GitHub-factorio-blueprint-editor/2bb1ac79-7269-4c78-93c4-222090044e55/scratchpad/record-control
rm -rf "$REC"
FBE_RECORD_OUT="$REC" npx playwright test --config=playwright.recorder.config.ts
```

Expected: 8 passed. The log carries `RECORDED blueprintCount=578 entitiesSeen=<n>` - **578 is the number to check**; anything else means the corpus is not what this control requires.

- [ ] **Step 6: The control - the recorded values must reproduce the committed ones byte for byte**

```bash
REC=/private/tmp/claude-501/-Users-ericjohnson-GitHub-factorio-blueprint-editor/2bb1ac79-7269-4c78-93c4-222090044e55/scratchpad/record-control

cp "$REC/sprite-data.json" tests/__fixtures__/sprite-data.json
vp check --fix .
git diff --exit-code tests/__fixtures__/sprite-data.json && echo "sprite-data.json: BYTE IDENTICAL"
```

Then compare the three inline blocks. Replace each committed declaration with the recorder's rendering, whole block, from `const EXPECTED` (or `const EXPECTED_REAL`) through its closing `}`:

- `tests/entity-accessors.spec.ts` - the `const EXPECTED: { ... } = { ... }` at the end of the file, keeping the `/* Captured from the accessors ... */` comment above it untouched
- `tests/blueprint-round-trip.spec.ts` - the `const EXPECTED = { ... }` at the end of the file, keeping the JSDoc above it untouched
- `tests/overlay-container.spec.ts` - the `const EXPECTED_REAL: Record<string, number[]> = { ... }`, keeping the JSDoc above it untouched

Then:

```bash
vp check --fix .
git diff --exit-code tests/entity-accessors.spec.ts tests/blueprint-round-trip.spec.ts tests/overlay-container.spec.ts \
  && echo "inline EXPECTED blocks: BYTE IDENTICAL"
git status --short
```

Expected: both `BYTE IDENTICAL` lines, and `git status --short` showing only the two new untracked recorder files.

**If any diff is non-empty, stop and read it.** A difference in _values_ means the recorder does not measure what the spec measures and everything downstream is void - fix the recorder, do not touch the fixture. A difference in _whitespace, quoting or wrapping only_ means `toTs`/`writeJson` need adjusting; the recorded `.json` files are already on disk, so re-render from them rather than re-running the browser. Write this to the scratchpad as `rerender.mjs`, edit its `toTs` until the diff closes, and then port the same change back into the recorder so a later run agrees:

```javascript
import fs from 'fs'
import path from 'path'

const OUT = process.argv[2]

// Keep byte-for-byte in step with toTs in tests/record-fixtures.recorder.ts.
function toTs(value, indent = 0) {
    const pad = ' '.repeat(indent)
    const inner = ' '.repeat(indent + 4)
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]'
        return `[${value.map(v => toTs(v, indent + 4)).join(', ')}]`
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value)
        if (entries.length === 0) return '{}'
        const body = entries
            .map(([k, v]) => {
                const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : `'${k}'`
                return `${inner}${key}: ${toTs(v, indent + 4)},`
            })
            .join('\n')
        return `{\n${body}\n${pad}}`
    }
    if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
    return String(value)
}

const decls = {
    'entity-accessors.EXPECTED': `const EXPECTED: {
    entityCount: number
    blueprintCount: number
    accessors: Record<string, Tally>
}`,
    'blueprint-round-trip.EXPECTED': 'const EXPECTED',
    'overlay-container.EXPECTED_REAL': 'const EXPECTED_REAL: Record<string, number[]>',
}

for (const [name, decl] of Object.entries(decls)) {
    const value = JSON.parse(fs.readFileSync(path.join(OUT, `${name}.json`), 'utf8'))
    fs.writeFileSync(path.join(OUT, `${name}.ts.txt`), `${decl} = ${toTs(value)}\n`)
    console.log('rendered', name)
}
```

Run it as `node <scratchpad>/rerender.mjs "$REC"`. Restore anything you changed with `git checkout <file>` before retrying.

- [ ] **Step 7: Commit the recorder**

```bash
git add playwright.recorder.config.ts tests/record-fixtures.recorder.ts
git commit -m "$(cat <<'EOF'
test: add a throwaway fixture recorder, proved against the current corpus

Four sets of pinned values are keyed to corpus membership and all move when the
corpus is replaced. 2000+ digests is past hand-editing and the repo deliberately
has no re-record path, so this is a measuring instrument for one change, deleted
before the PR lands - the way tools/oracle/ treats a probe.

Its measurement code is copied verbatim from the spec that owns each fixture
rather than imported, because importing a spec registers its tests into the
importing suite. Run against the corpus as it stands, it reproduces every
committed fixture byte for byte, which is what makes anything it says about a
different corpus worth reading.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ErAwBHYHrkdJdmwYhHGGxq
EOF
)"
```

---

## Task 3: Stage `test-blueprints/` alongside the old corpus

**Files:**

- Create: `test-blueprints/EARN/earn-v22-0-12.rev-2.txt`, `pocket-base-space-age-v22.1.2.txt`, `power-blocks-v22-0-8.rev-1.txt`, `quick-start-v22-0-11.txt`
- Create: `test-blueprints/JEPAKAZOL/nauvis-starter-bot-rush.txt`, `nauvis-midgame-science.txt`, `vulcanus-starter-mk2.txt`, `gleba-base-mall-all.txt`, `gleba-mall-5-planets.txt`, `fulgora-mall-4-planets.txt`, `aquilo-cryogenic-science.txt`, `space-platform-factory.txt`
- Create: `test-blueprints/README.md`

**Interfaces:**

- Consumes: nothing.
- Produces: a committed directory that `discoverBlueprintFiles()` does not yet read. `TESTS_DIR` still points at `wormeyman-tests/`, so this task changes no test behaviour and the suite stays green throughout.

**Why additive first:** any change to corpus membership breaks five fixture sets at once. Staging the new corpus without pointing anything at it keeps this task independently verifiable and keeps the flip in Task 4 down to a one-line change plus a re-record.

- [ ] **Step 1: Copy the four EARN books, byte-identical**

```bash
mkdir -p test-blueprints/EARN test-blueprints/JEPAKAZOL
cp wormeyman-tests/EARN/*.txt test-blueprints/EARN/
diff -r wormeyman-tests/EARN test-blueprints/EARN && echo "EARN: byte identical"
```

Expected: `EARN: byte identical`.

- [ ] **Step 2: Place the eight Jepakazol blueprints**

They are already staged at `/tmp/jepa/` from a previous session, and were verified on 2026-08-05 as byte-identical to the live source. If `/tmp/jepa/` is gone, skip to Step 2b.

```bash
cp /tmp/jepa/nauvis-starter-bot-rush.txt      test-blueprints/JEPAKAZOL/
cp /tmp/jepa/midgame-science.txt              test-blueprints/JEPAKAZOL/nauvis-midgame-science.txt
cp /tmp/jepa/vulcanus-starter-mk2.txt         test-blueprints/JEPAKAZOL/
cp /tmp/jepa/gleba-base-mall-all.txt          test-blueprints/JEPAKAZOL/
cp /tmp/jepa/gleba-mall-5-planets.txt         test-blueprints/JEPAKAZOL/
cp /tmp/jepa/fulgora-mall-4-planets.txt       test-blueprints/JEPAKAZOL/
cp /tmp/jepa/aquilo-cryogenic-science.txt     test-blueprints/JEPAKAZOL/
cp /tmp/jepa/space-platform-factory.txt       test-blueprints/JEPAKAZOL/
ls test-blueprints/JEPAKAZOL/ | wc -l
```

Expected: `8`.

- [ ] **Step 2b: Re-fetch, only if `/tmp/jepa/` is gone**

```bash
fetch() {
  curl -s "https://facorio-blueprints.firebaseio.com/blueprints/$2.json" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      process.stdout.write(JSON.parse(s).blueprintString.trim())})" \
  > "test-blueprints/JEPAKAZOL/$1.txt"
}
fetch nauvis-starter-bot-rush     -OP64HC3ibqmtD4bCM8l
fetch nauvis-midgame-science      -Oe7Ua7QavpUFi7znoaM
fetch vulcanus-starter-mk2        -On2A94-dyLTSW4Riapk
fetch gleba-base-mall-all         -OFa_ZWh1hQypFqucMTy
fetch gleba-mall-5-planets        -OYaLsmRoZfPAT5cm7p4
fetch fulgora-mall-4-planets      -OX4QBKmwEZ6dIBJY5C5
fetch aquilo-cryogenic-science    -OHdIUzkrhCJUlzZRo33
fetch space-platform-factory      -OL_E6IO4gmQUdqFgTjq
```

Note there is no trailing newline: `readBlueprintString` calls `.trim()`, so it makes no difference to the tests, but keeping the files exactly as fetched keeps a future re-verification a plain byte comparison.

**Do not add `Fulgora Starter Factory` (104 hearts) or `Vulcanus Mall` (54 hearts).** Both carry `ee-infinity-loader`, an Editor Extensions mod entity absent from `data.json`. They would be stripped with a warning, breaking the property that every corpus file loads clean and injecting strip warnings into `blueprint-loading.spec.ts`.

- [ ] **Step 3: Verify every file decodes clean against `data.json`**

```bash
node -e "
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const dec=s=>JSON.parse(zlib.inflateSync(Buffer.from(s.slice(1),'base64')).toString());
const flat=(o,out=[])=>{if(o.blueprint_book){for(const e of o.blueprint_book.blueprints??[])flat(e,out)}else if(o.blueprint){out.push(o.blueprint)}return out};
const d=JSON.parse(fs.readFileSync('packages/exporter/data/output/data.json','utf8'));
const kE=new Set(Object.keys(d.entities)), kT=new Set(Object.keys(d.tiles));
let files=0,bps=0,ents=0,tiles=0,bad=0;
for(const c of fs.readdirSync('test-blueprints',{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort())
for(const f of fs.readdirSync(path.join('test-blueprints',c)).filter(x=>x.endsWith('.txt')).sort()){
  files++;
  const list=flat(dec(fs.readFileSync(path.join('test-blueprints',c,f),'utf8').trim()));
  bps+=list.length;
  const uE=new Set(),uT=new Set();
  for(const b of list){
    for(const e of b.entities??[]){ents++;if(!kE.has(e.name))uE.add(e.name)}
    for(const t of b.tiles??[]){tiles++;if(!kT.has(t.name))uT.add(t.name)}
  }
  if(uE.size||uT.size){bad++;console.log('UNKNOWN in',c+'/'+f,[...uE],[...uT])}
}
console.log({files,bps,ents,tiles,filesWithUnknownPrototypes:bad});
"
```

Expected exactly:

```
{ files: 12, bps: 367, ents: 347725, tiles: 232815, filesWithUnknownPrototypes: 0 }
```

Any deviation means a wrong or truncated file. Do not proceed.

- [ ] **Step 4: Verify the Jepakazol files against the live source**

```bash
declare -A K=(
 [nauvis-starter-bot-rush]=-OP64HC3ibqmtD4bCM8l
 [nauvis-midgame-science]=-Oe7Ua7QavpUFi7znoaM
 [vulcanus-starter-mk2]=-On2A94-dyLTSW4Riapk
 [gleba-base-mall-all]=-OFa_ZWh1hQypFqucMTy
 [gleba-mall-5-planets]=-OYaLsmRoZfPAT5cm7p4
 [fulgora-mall-4-planets]=-OX4QBKmwEZ6dIBJY5C5
 [aquilo-cryogenic-science]=-OHdIUzkrhCJUlzZRo33
 [space-platform-factory]=-OL_E6IO4gmQUdqFgTjq
)
for n in "${!K[@]}"; do
  curl -s "https://facorio-blueprints.firebaseio.com/blueprints/${K[$n]}.json" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);
      const l=require('fs').readFileSync(process.argv[1],'utf8').trim();
      console.log([process.argv[2], o.numberOfFavorites, l===o.blueprintString.trim()?'MATCH':'DIFFER'].join(' | '))})" \
      "test-blueprints/JEPAKAZOL/$n.txt" "$n"
done | sort
```

Expected, all `MATCH`, with these heart counts:

```
aquilo-cryogenic-science | 9 | MATCH
fulgora-mall-4-planets | 82 | MATCH
gleba-base-mall-all | 320 | MATCH
gleba-mall-5-planets | 107 | MATCH
nauvis-midgame-science | 8 | MATCH
nauvis-starter-bot-rush | 71 | MATCH
space-platform-factory | 30 | MATCH
vulcanus-starter-mk2 | 37 | MATCH
```

Hearts move over time, so a changed number is fine and should be carried into the README; a `DIFFER` is not - it means the author edited the blueprint and the local copy is stale.

- [ ] **Step 5: Write the attribution README**

Create `test-blueprints/README.md`:

```markdown
# Test blueprints

Third-party Factorio blueprints, included here as **test fixtures**. Nine
Playwright specs load every file in this directory and pin what the editor makes
of it - see the Playwright section of `../CLAUDE.md`.

These are other people's designs. They are redistributed unmodified, with
attribution, so that the test suite works on a fresh clone; nothing here is
authored by this project. If you are an author listed below and would rather not
be included, open an issue and the file will be removed.

Every file is a raw Factorio blueprint string, exactly as the game exports it -
one line, no trailing newline. `tests/helpers/blueprint-files.ts` reads them
with a `.trim()`.

Provenance is recorded the way `tools/oracle/fixtures/` records its own.

## EARN - ElderAxe

Retrieved from an existing local copy on 2026-08-05, byte-identical to what the
suite has been running against since March 2026. Each book carries its author
and a Patreon collection link in its own description field, quoted below.

| File                                | Book label                                | Author                    | Version | Source                                                          |
| ----------------------------------- | ----------------------------------------- | ------------------------- | ------- | --------------------------------------------------------------- |
| `earn-v22-0-12.rev-2.txt`           | EARN - ElderAxe's Rail Network (v22.0.12) | ElderAxe                  | 2.0.55  | <https://www.patreon.com/collection/1415594>                    |
| `pocket-base-space-age-v22.1.2.txt` | Pocket Base - Space Age Edition (22.1.2)  | MisterGrimmJaw & ElderAxe | 2.0.73  | EARN 22 collection, <https://www.patreon.com/collection/909011> |
| `power-blocks-v22-0-8.rev-1.txt`    | EARN Power Blocks (v22.0.8)               | ElderAxe                  | 2.0.55  | <https://www.patreon.com/collection/672495>                     |
| `quick-start-v22-0-11.txt`          | ElderAxe's Quick Start Base (v22.0.11)    | ElderAxe                  | 2.0.45  | <https://www.patreon.com/collection/585174>                     |

`pocket-base-space-age-v22.1.2.txt` gives no collection link of its own; the one
above is the EARN 22 collection its description names for rail and station
compatibility.

## JEPAKAZOL - factorio.school

Retrieved 2026-08-05 from <https://www.factorio.school>, via
`https://facorio-blueprints.firebaseio.com/blueprints/<key>.json`, field
`blueprintString`, trimmed. Heart counts are as of that date. Files are named by
target rather than by title so the set reads as one per planet plus a space
platform.

| File                           | Title                                            | Key                                                                             | Hearts | Version |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------- | ------ | ------- |
| `nauvis-starter-bot-rush.txt`  | Starter Base, Bot Rush + Early Mall              | [`-OP64HC3ibqmtD4bCM8l`](https://www.factorio.school/view/-OP64HC3ibqmtD4bCM8l) | 71     | 2.0.76  |
| `nauvis-midgame-science.txt`   | Mid-game Science                                 | [`-Oe7Ua7QavpUFi7znoaM`](https://www.factorio.school/view/-Oe7Ua7QavpUFi7znoaM) | 8      | 2.0.72  |
| `vulcanus-starter-mk2.txt`     | Vulcanus Starter Mk2                             | [`-On2A94-dyLTSW4Riapk`](https://www.factorio.school/view/-On2A94-dyLTSW4Riapk) | 37     | 2.1.12  |
| `gleba-base-mall-all.txt`      | Gleba Base (Mall + All)                          | [`-OFa_ZWh1hQypFqucMTy`](https://www.factorio.school/view/-OFa_ZWh1hQypFqucMTy) | 320    | 2.1.12  |
| `gleba-mall-5-planets.txt`     | Gleba Mall - 5 Planets Tech (2000 SPM)           | [`-OYaLsmRoZfPAT5cm7p4`](https://www.factorio.school/view/-OYaLsmRoZfPAT5cm7p4) | 107    | 2.0.76  |
| `fulgora-mall-4-planets.txt`   | Fulgora Mall - 4 planets tech, normal quality    | [`-OX4QBKmwEZ6dIBJY5C5`](https://www.factorio.school/view/-OX4QBKmwEZ6dIBJY5C5) | 82     | 2.0.77  |
| `aquilo-cryogenic-science.txt` | Aquilo Cryogenic Science - 233 / Min, No Quality | [`-OHdIUzkrhCJUlzZRo33`](https://www.factorio.school/view/-OHdIUzkrhCJUlzZRo33) | 9      | 2.0.32  |
| `space-platform-factory.txt`   | Space Platform Factory                           | [`-OL_E6IO4gmQUdqFgTjq`](https://www.factorio.school/view/-OL_E6IO4gmQUdqFgTjq) | 30     | 2.0.76  |

All eight are by the same author, [Jepakazol](https://www.factorio.school/user/I6YX1Ar1cWUwhbQgMcW4nyZkDs52).

## What the set is chosen for

Not popularity. Two of the most-favourited blueprints on factorio.school for
these planets are deliberately **excluded**: `Fulgora Starter Factory` (104
hearts) and `Vulcanus Mall` (54 hearts) both contain `ee-infinity-loader`, an
Editor Extensions mod entity that is not in `data.json`. It would be stripped
with a warning, which breaks the one property this whole directory rests on -
that every file loads clean.

What the set is chosen for is **junction coverage**. Thirteen `draw_*` functions
in `spriteDataBuilder.ts` read the position grid to pick a sprite - pipes
picking a junction, belts picking a corner, undergrounds pairing up, heat pipes
and walls picking a connection, gates picking a rail base. The synthetic corpus
(`tests/helpers/all-entities-blueprint.ts`) cannot reach any of them by
construction: it spaces entities so that none of them touch. Only real bases do.

Measured against what the corpus held before this directory existed:
`stone-wall` 3,989 -> 6,130, `gate` 192 -> 240, loaders 4 -> 135. That last is
the one grid-reading family the ElderAxe books alone did not carry - four
`turbo-loader` and no `loader`, `fast-loader` or `express-loader` at all.

`nauvis-midgame-science.txt` adds no entity type and no tile type the rest of
the set does not already carry. It is here for its arrangements - 1,428 pipes,
173 heat pipes, 3,683 belts, 1,220 undergrounds, 261 splitters, 28 loaders in
mid-game Nauvis geometry - and because it is a book of 11, which exercises the
book-walking path.

`vulcanus-starter-mk2.txt` is the largest file here at 389 KB and 32,638
entities and adds zero new entity types. It is kept for the same reason: 8,776
pipes in arrangements nothing else covers.

## Facts the test suite depends on

Re-derive these rather than trusting them; they were measured on 2026-08-05.

- **12 files, 367 flattened blueprints** (a nested book contributes its contents,
  not itself), 347,725 entities, 232,815 tiles, 4.68 MB.
- **Zero unknown prototypes.** Every entity name and tile name resolves against
  `packages/exporter/data/output/data.json`. Adding a file that does not hold
  this breaks `blueprint-loading.spec.ts` and `tests/unknown-prototypes.spec.ts`
  at once.
- **Declared versions run 2.0.32 to 2.1.12**, all post-2.0. So the corpus still
  cannot reach any pre-2.0 branch - `nameMigrations.ts`, and the two shape
  migrations in `Blueprint.ts`. Those need a synthetic blueprint at a chosen
  version, which is what `tests/helpers/encode-blueprint.ts` is for.
- **Every file starts with `0`**, the plain blueprint-string form, so the
  `?source=` handlers in `bpString.ts` are unreachable from here by
  construction. `tests/blueprint-sources.spec.ts` covers those instead.

Adding a file moves five sets of pinned fixture values -
`tests/__fixtures__/sprite-data.json` and the inline `EXPECTED` blocks in
`entity-accessors`, `blueprint-round-trip` and `overlay-container`, plus
possibly `EXPECTED_FAILURES` in `sprite-generation`. Those are fixed points with
no re-record path on purpose. Weigh what a new file buys against that.
```

- [ ] **Step 6: Confirm the staged corpus changes nothing yet**

```bash
git status --short
vp check
```

Expected: `vp check` reports 0 errors and 0 warnings, and `git status` shows the new `test-blueprints/` files as untracked. `TESTS_DIR` still points at `wormeyman-tests/`, so no spec sees the new directory.

Confirm oxfmt left the blueprint strings alone:

```bash
vp check --fix .
git status --short test-blueprints/
```

Expected: nothing under `test-blueprints/*.txt` reformatted. `README.md` may be reformatted; that is fine.

- [ ] **Step 7: Commit**

```bash
git add test-blueprints/
git commit -m "$(cat <<'EOF'
test: add a public, committed blueprint corpus at test-blueprints/

Twelve files: the four ElderAxe books the suite has been running against, copied
byte for byte, plus eight blueprints by Jepakazol from factorio.school - one per
planet plus a space platform. Every one decodes clean against data.json with
zero unknown prototypes, and each Jepakazol file was verified byte-identical to
its live source. README.md carries the attribution and the provenance.

Nothing reads this directory yet; TESTS_DIR still points at wormeyman-tests/, so
the suite is untouched. The flip is the next commit, where it has to land
together with the fixture re-record.

Not chosen by popularity: Fulgora Starter Factory (104 hearts) and Vulcanus Mall
(54 hearts) are excluded because both carry ee-infinity-loader, an Editor
Extensions entity absent from data.json, which would break the property the
whole directory rests on - that every file loads clean.

Closes #186 in part.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ErAwBHYHrkdJdmwYhHGGxq
EOF
)"
```

---

## Task 4: Flip to the new corpus and re-record every pinned fixture

**Files:**

- Modify: `tests/helpers/blueprint-files.ts:13`
- Modify: `.gitignore:10`
- Modify: `tests/__fixtures__/sprite-data.json`
- Modify: `tests/entity-accessors.spec.ts` (inline `EXPECTED`)
- Modify: `tests/blueprint-round-trip.spec.ts` (inline `EXPECTED`)
- Modify: `tests/overlay-container.spec.ts` (inline `EXPECTED_REAL`)
- Modify: `tests/entity-container-mappings.spec.ts:29,72-73`
- Modify: `tests/sprite-data.spec.ts:239` (the pinned `blueprintCount`)
- Maybe modify: `tests/sprite-generation.spec.ts` (`EXPECTED_FAILURES`)
- Move out of the repo: `wormeyman-tests/`

**Interfaces:**

- Consumes: the recorder from Task 2, the staged corpus from Task 3.
- Produces: a green suite reading `test-blueprints/`. `discoverBlueprintFiles()` keeps its signature; only `TESTS_DIR` moves.

**This task is atomic on purpose.** Any change to corpus membership breaks five fixture sets at once, so there is no green intermediate state between the flip and the re-record. Expect the suite to be red between Step 2 and Step 7 and do not "fix" a fixture by hand.

- [ ] **Step 1: Archive the old corpus rather than deleting it**

`wormeyman-tests/` was never committed, so `rm -rf` is permanent data loss.

```bash
mv wormeyman-tests ~/fbe-wormeyman-tests-archive-2026-08-05
ls ~/fbe-wormeyman-tests-archive-2026-08-05
```

Expected: `a.txt  AVADII  EARN  NILAUS`. Say plainly in the final report where it went.

- [ ] **Step 2: Point discovery at the new directory**

In `tests/helpers/blueprint-files.ts`, line 13:

```typescript
const TESTS_DIR = path.resolve(process.cwd(), 'wormeyman-tests')
```

becomes:

```typescript
const TESTS_DIR = path.resolve(process.cwd(), 'test-blueprints')
```

- [ ] **Step 3: Un-ignore the corpus**

In `.gitignore`, delete line 10 entirely:

```
/wormeyman-tests
```

- [ ] **Step 4: Confirm the corpus the specs now see**

```bash
grep -n "TESTS_DIR = " tests/helpers/blueprint-files.ts
ls test-blueprints/EARN test-blueprints/JEPAKAZOL | cat
ls wormeyman-tests 2>&1
```

Expected: `TESTS_DIR` naming `test-blueprints`; the four EARN files and the eight JEPAKAZOL files, nothing else; and `ls: wormeyman-tests: No such file or directory`.

- [ ] **Step 5: Re-run the recorder against the new corpus**

With `npm run localpreview` running:

```bash
REC=/private/tmp/claude-501/-Users-ericjohnson-GitHub-factorio-blueprint-editor/2bb1ac79-7269-4c78-93c4-222090044e55/scratchpad/record-new
rm -rf "$REC"
FBE_RECORD_OUT="$REC" npx playwright test --config=playwright.recorder.config.ts
```

Expected: 8 passed, and the log carries `RECORDED blueprintCount=367`. **367 is the number to check** - it is the flattened blueprint count measured offline for this exact set of twelve files. If it is anything else, the corpus on disk is not the corpus this plan measured; stop.

- [ ] **Step 6: Apply the recorded fixtures**

```bash
REC=/private/tmp/claude-501/-Users-ericjohnson-GitHub-factorio-blueprint-editor/2bb1ac79-7269-4c78-93c4-222090044e55/scratchpad/record-new
cp "$REC/sprite-data.json" tests/__fixtures__/sprite-data.json
```

Then replace the three inline declarations with the recorder's renderings, exactly as in Task 2 Step 6 - whole block, comment above each left untouched:

- `tests/entity-accessors.spec.ts` from `$REC/entity-accessors.EXPECTED.ts.txt`
- `tests/blueprint-round-trip.spec.ts` from `$REC/blueprint-round-trip.EXPECTED.ts.txt`
- `tests/overlay-container.spec.ts` from `$REC/overlay-container.EXPECTED_REAL.ts.txt`

Then:

```bash
vp check --fix .
```

- [ ] **Step 7: Check the fixture diff has the shape it must have**

```bash
git diff --stat tests/__fixtures__/sprite-data.json
node -e "
const fs=require('fs'),cp=require('child_process');
const old=JSON.parse(cp.execSync('git show HEAD:tests/__fixtures__/sprite-data.json').toString());
const now=JSON.parse(fs.readFileSync('tests/__fixtures__/sprite-data.json','utf8'));
for(const k of ['synthetic','noGrid','noGridReal','paintPreview','real']){
  const same=JSON.stringify(old[k])===JSON.stringify(now[k]);
  console.log(k.padEnd(14), same?'UNCHANGED':'moved', Object.keys(now[k]).length,'entities');
}"
```

Expected exactly:

```
synthetic      UNCHANGED 155 entities
noGrid         UNCHANGED 155 entities
noGridReal     moved 113 entities
paintPreview   UNCHANGED 155 entities
real           moved 113 entities
```

`synthetic`, `noGrid` and `paintPreview` are built from `data.json` and do not read the corpus at all, so a move in any of them means the recorder did something the spec does not, not that the corpus changed. Stop and diagnose if so.

The two that moved should also lose five entities each, the ones the design spec names as leaving with AVADII:

```bash
node -e "
const fs=require('fs'),cp=require('child_process');
const old=JSON.parse(cp.execSync('git show HEAD:tests/__fixtures__/sprite-data.json').toString());
const now=JSON.parse(fs.readFileSync('tests/__fixtures__/sprite-data.json','utf8'));
for(const k of ['noGridReal','real']){
  const gone=Object.keys(old[k]).filter(n=>!(n in now[k]));
  const added=Object.keys(now[k]).filter(n=>!(n in old[k]));
  console.log(k,'gone:',gone,'added:',added);
}"
```

Expected `gone` to contain `agricultural-tower`, `heat-interface`, `lightning-rod`, `offshore-pump` and `thruster`. A sixth name leaving is a finding worth reporting, not worth silently accepting - the design spec's argument for why the loss is survivable is specific to those five, all of which have no grid-reading `draw_*` function and all of which stay covered in the synthetic halves.

- [ ] **Step 8: Fix `sprite-data.spec.ts`'s pinned blueprint count**

Line 239 of `tests/sprite-data.spec.ts`:

```typescript
// Same corpus entity-accessors.spec.ts walks - see its EXPECTED.
expect(blueprintCount).toBe(578)
expect(entitiesSeen).toBeGreaterThan(400_000)
```

becomes:

```typescript
// Same corpus entity-accessors.spec.ts walks - see its EXPECTED.
expect(blueprintCount).toBe(367)
expect(entitiesSeen).toBeGreaterThan(300_000)
```

The 400,000 floor was set against a corpus holding 408,290 entities; the new one holds 347,725, so the floor has to come down or the assertion fails for a reason that has nothing to do with sprites.

- [ ] **Step 9: Fix `entity-container-mappings.spec.ts`**

Lines 28-29:

```typescript
const BIG = 'EARN/quick-start-v22-0-11'
const SMALL = 'AVADII/Alpha Cygni Blueprints 1.3'
```

become:

```typescript
const BIG = 'EARN/quick-start-v22-0-11'
const SMALL = 'EARN/earn-v22-0-12.rev-2'
```

Line 40's message:

```typescript
if (!file) throw new Error(`test blueprint ${name} not found in wormeyman-tests/`)
```

becomes:

```typescript
if (!file) throw new Error(`test blueprint ${name} not found in test-blueprints/`)
```

Lines 72-73:

```typescript
expect(big.entities).toBe(243)
expect(small.entities).toBe(2)
```

become:

```typescript
expect(big.entities).toBe(243)
expect(small.entities).toBe(69)
```

And the comment at lines 23-27 gains the reason for the swap:

```typescript
/*
    A large and a small blueprint. Both files are books, and loadBp renders only
    a book's first blueprint, so these are the counts of entry 0 - which is why
    the big one is 243 rather than the 1636 issue #42 quotes for the whole book.

    SMALL was AVADII/Alpha Cygni Blueprints 1.3 at 2 entities until the corpus
    went public (#186) and AVADII left with it. 69 against 243 is the widest
    ratio the committed corpus offers without also moving BIG; under the #42
    leak 174 containers would be retained here, which is plenty to see.
*/
```

- [ ] **Step 10: Fix the two `wormeyman-tests/` paths in other spec error messages**

`tests/position-grid.spec.ts:22` and `tests/wire-connections.spec.ts:31` both throw a message naming the old directory. Change both occurrences of:

```typescript
not found in wormeyman-tests/
```

to:

```typescript
not found in test-blueprints/
```

- [ ] **Step 11: Run the whole Playwright suite**

```bash
npx playwright test
```

Expected: all specs pass.

**Expect this to be slower, and expect a timeout to be the first thing that goes.** Two specs render every file into the live editor rather than decoding it - `sprite-generation.spec.ts` and `overlay-container.spec.ts` - and `loadBp` renders only a book's first entry, so what matters is the largest entry 0 in the corpus. That goes from 4,245 entities (`EARN/power-blocks-v22-0-8.rev-1`) to **21,974** (`JEPAKAZOL/gleba-mall-5-planets`), with three more over 5,000 behind it. `playwright.config.ts` sets a 120s per-test timeout.

If either times out, raise `timeout` in `playwright.config.ts` and say so in the commit - that is a config change forced by a bigger corpus, not a fixture edit, and it is the honest fix. Do **not** reach for a retry: the config is `workers: 1, retries: 0` on purpose, and an intermittent spec here would have a deterministic cause worth finding. Rule the timeout in or out first by timing one spec on its own:

```bash
npx playwright test tests/overlay-container.spec.ts --reporter=list
```

`tests/sprite-generation.spec.ts` is the one that may legitimately need a further edit. If its `real blueprints generate sprites without failures` test fails, the failure names the entity. That is a **decision, not a re-record**: an entity generating no sprites on the new corpus is a real rendering hole, and adding it to `EXPECTED_FAILURES` is the same act as pinning known-broken behaviour. Report the name, say why it fails (most likely a diagonal facing reaching `util.getDirName`, which is what `railgun-turret` does at directions 2 and 14), and add it with a comment saying so.

If `railgun-turret` **stops** appearing as `"FAILED"` in the `real` and `noGridReal` halves of `sprite-data.json`, that is expected and good: it means no file in the new corpus places one diagonally. Note it in the commit message rather than treating it as a loss.

- [ ] **Step 12: Full checks**

```bash
vp check
vp test
```

Expected: `vp check` 0 errors 0 warnings; `vp test` all passing.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test: read the corpus from test-blueprints/ and re-record every pinned fixture

The nine corpus specs failed outright on a fresh clone - wormeyman-tests/ was
gitignored and undistributed, so they died on their own
expect(files.length).toBeGreaterThan(0) rather than degrading to reduced
coverage. That was 57% of the sprite-data characterization harness, and
specifically the half that reaches spriteDataBuilder's neighbour-reading
branches, which the synthetic corpus cannot reach by construction.

578 flattened blueprints become 367; 408,290 entities become 347,725. Five
entity types leave with AVADII (agricultural-tower, heat-interface,
lightning-rod, offshore-pump, thruster) and none of them has a grid-reading
draw_* function, so nothing is lost where junctions are concerned - all five
stay covered by the synthetic, noGrid and paintPreview halves, which place every
entity in data.json whatever the corpus holds. Where it counts the new corpus is
better: stone-wall 3,989 -> 6,130, gate 192 -> 240, loaders 4 -> 135. That last
one is the point of the exercise: `draw_loader` is one of the thirteen
grid-reading functions and the one family the EARN books alone did not carry, and
the old corpus held four turbo-loaders and nothing else. The new one adds
`loader`, `fast-loader` and `express-loader` as types.

Fixtures were re-recorded by a throwaway recorder that had first been proved to
reproduce the committed ones byte for byte against the corpus as it stood. The
synthetic, noGrid and paintPreview halves of sprite-data.json are unchanged,
which is the check that the recorder measures what the specs measure: those
three read data.json and never touch the corpus.

entity-container-mappings.spec.ts named an AVADII file directly and pinned its
2-entity count; SMALL is now EARN/earn-v22-0-12.rev-2 at 69.

The old corpus was moved to ~/fbe-wormeyman-tests-archive-2026-08-05 rather than
deleted - it was never committed, so rm would have been permanent.

Closes #186.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ErAwBHYHrkdJdmwYhHGGxq
EOF
)"
```

---

## Task 5: Re-measure the corpus figures quoted in prose

**Files:**

- Modify: `CONTRIBUTING.md:126-128`
- Modify: `CLAUDE.md` (lines 542, 555, 557, 584, 587, the sprite-data and blueprint-round-trip entries, and the "Every blueprint in the corpus declares 2.0.45 to 2.0.73" paragraph)
- Modify: `tests/chest-filters.spec.ts:32-40`
- Modify: `tests/paste-filter-cap.spec.ts:29-32`
- Modify: `tests/pre-2-0-shape-migrations.spec.ts:17-19,154-156`
- Modify: `tests/rail-placement-rules.spec.ts:9-11`
- Modify: `tests/name-migrations.spec.ts:11-15`
- Modify: `tests/unknown-prototypes.spec.ts:14-16`
- Modify: `tests/blueprint-round-trip.spec.ts:39-41`
- Modify: `tests/blueprint-sources.spec.ts:15`
- Modify: `tests/helpers/all-entities-blueprint.ts:9`, `tests/helpers/all-recipes-blueprint.ts:9`, `tests/helpers/encode-blueprint.ts:5`
- Modify: `tests/sprite-data.spec.ts:214-218`
- Modify: `tests/entity-accessors.spec.ts:121`

**Interfaces:**

- Consumes: the flipped corpus from Task 4.
- Produces: no code change. Comments and docs only.

**Why this is its own task:** these are measurements written as prose, not assertions, so nothing goes red when they go stale. They are also where the next person's mental model comes from. Two of them were already stale before this change, which is the argument for re-measuring rather than editing by inspection.

- [ ] **Step 1: Re-measure**

```bash
node -e "
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const dec=s=>JSON.parse(zlib.inflateSync(Buffer.from(s.slice(1),'base64')).toString());
function walk(o,out){if(o.blueprint_book){if(o.blueprint_book.version!==undefined)out.versioned++;for(const e of o.blueprint_book.blueprints??[])walk(e,out)}else if(o.blueprint){out.bps.push(o.blueprint);if(o.blueprint.version!==undefined)out.versioned++}}
const out={bps:[],versioned:0};
for(const c of fs.readdirSync('test-blueprints',{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort())
for(const f of fs.readdirSync(path.join('test-blueprints',c)).filter(x=>x.endsWith('.txt')).sort())
  walk(dec(fs.readFileSync(path.join('test-blueprints',c,f),'utf8').trim()),out);
let rfAny=0,rfArr=0,cbFilters=0,sections=0,filters=0,fq=0,rfb=0,tnr=0,second=0,max0=0,cbSec=0,si=0;
const sIdx=new Set(),cIdx=new Set();
for(const bp of out.bps) for(const e of bp.entities??[]){
  if(e.name==='stack-inserter')si++;
  const rf=e.request_filters;
  if(rf!==undefined){rfAny++;
    if(Array.isArray(rf))rfArr++;else{
      if(rf.request_from_buffers!==undefined)rfb++;
      if(rf.trash_not_requested!==undefined)tnr++;
      const secs=rf.sections??[];if(secs.length>1)second++;sections+=secs.length;
      for(const s of secs)sIdx.add(s.index);
      max0=Math.max(max0,(secs[0]?.filters??[]).length);
      for(const s of secs)for(const fl of s.filters??[]){filters++;if(fl.quality!==undefined&&fl.comparator!==undefined)fq++}}}
  const cb=e.control_behavior;
  if(cb?.filters!==undefined)cbFilters++;
  for(const s of cb?.sections?.sections??[]){cbSec++;cIdx.add(s.index)}
}
const vs=[...new Set(out.bps.map(b=>b.version).filter(v=>v!==undefined))].map(v=>{const b=BigInt(v);return \`\${b>>48n}.\${(b>>32n)&0xffffn}.\${(b>>16n)&0xffffn}\`}).sort();
console.log(JSON.stringify({flattenedBlueprints:out.bps.length,versionedBlueprintsAndBooks:out.versioned,versions:vs,
  reqFiltersAny:rfAny,reqFiltersArray:rfArr,legacyControlBehaviourFilters:cbFilters,requestFilterSections:sections,
  requestFilterSectionIndexes:[...sIdx].sort((a,b)=>a-b),filters,filtersWithQualityAndComparator:fq,
  requestFromBuffers:rfb,trashNotRequested:tnr,secondSection:second,maxSection0FilterList:max0,
  controlBehaviourSections:cbSec,controlBehaviourSectionIndexes:[...cIdx].sort((a,b)=>a-b),stackInserters:si},null,2));
"
```

Expected (measured 2026-08-05 offline, before the flip - the run above must agree):

```
flattenedBlueprints 367, versionedBlueprintsAndBooks 402,
versions 2.0.32 2.0.45 2.0.55 2.0.72 2.0.73 2.0.76 2.0.77 2.1.12,
reqFiltersAny 5995, reqFiltersArray 0, legacyControlBehaviourFilters 0,
requestFilterSections 6017, requestFilterSectionIndexes [1,2,3],
filters 4069, filtersWithQualityAndComparator 4069,
requestFromBuffers 728, trashNotRequested 36, secondSection 19,
maxSection0FilterList 19, controlBehaviourSections 1344,
controlBehaviourSectionIndexes [1..15], stackInserters 2790
```

- [ ] **Step 2: `CONTRIBUTING.md`**

Replace lines 126-128:

```markdown
And several specs load a local blueprint corpus from `wormeyman-tests/`, which
is gitignored and not distributed - without it those specs fail on an explicit
"found no blueprints" assertion, which is not something you broke.
```

with:

```markdown
And several specs load the blueprint corpus in `test-blueprints/`, which is
committed - see its README for where the blueprints come from and what the set
is chosen for. Those specs assert that they found some, so a missing corpus is a
real failure rather than an expected local condition.
```

- [ ] **Step 3: `CLAUDE.md`**

Six edits, all path or count:

- Line 542: `` blueprint `.txt` files from `wormeyman-tests/` `` becomes `` blueprint `.txt` files from `test-blueprints/` ``
- Line 555 (`entity-accessors.spec.ts` entry): `` across all 578 blueprints in `wormeyman-tests/` `` becomes `` across all 367 blueprints in `test-blueprints/` ``
- Line 557 (`blueprint-sources.spec.ts` entry): `` every file in `wormeyman-tests/` starts with `0` `` becomes `` every file in `test-blueprints/` starts with `0` ``
- Line 584: `` Discovers `.txt` files from `wormeyman-tests/{collection}/` `` becomes ``Discovers `.txt` files from `test-blueprints/{collection}/`, in sorted order - `blueprint-round-trip.spec.ts` folds the corpus into one hash in iteration order, so readdir order would make that fixture machine-specific``
- Line 587: ``**Test blueprints** are organized by collection in `wormeyman-tests/` (EARN, AVADII, etc.). Each `.txt` file contains a raw Factorio blueprint string.`` becomes ``**Test blueprints** are organized by collection in `test-blueprints/` (EARN, JEPAKAZOL), committed and public as of issue #186. Each `.txt` file contains a raw Factorio blueprint string. `test-blueprints/README.md` carries the attribution, the provenance and what the set is chosen for.``
- The `sprite-data.spec.ts` entry: ``walk every blueprint of every book (578, like `entity-accessors.spec.ts`)`` becomes ``walk every blueprint of every book (367, like `entity-accessors.spec.ts`)``

Then replace the whole paragraph beginning **Every blueprint in the corpus declares 2.0.45 to 2.0.73**:

```markdown
**Every blueprint in the corpus declares 2.0.32 to 2.1.12** - 12 files, 402 versioned blueprints and books, all post-2.0. So the corpus still cannot exercise any version-conditional branch: the pre-2.0 arms of `Blueprint.ts`'s guards and all of `nameMigrations.ts` are invisible to it, and code that is wrong for old blueprints passes the entire suite. That is what hid issue #40. Version-conditional code needs a synthetic blueprint at a chosen version - use `tests/helpers/encode-blueprint.ts`. Three other things the corpus cannot reach: a name FD does not have (every file loads clean), anything behind pointer or keyboard input, and **any pre-2.0 data shape** - no file carries `control_behavior.filters` or a flat `request_filters` array, so the shape migrations in `Blueprint.ts` are invisible to it too, whether or not they are version-gated (`tests/pre-2-0-shape-migrations.spec.ts`).
```

Also add, right after that paragraph:

```markdown
**A corpus figure quoted in a comment is a measurement with a date on it, and two were already stale before #186.** `pre-2-0-shape-migrations.spec.ts` said 1452 `control_behavior` sections where the discovered corpus held 1295 - the missing 157 were all in `wormeyman-tests/a.txt`, a stray top-level file `discoverBlueprintFiles()` never read, since it only walks directories. And `chest-filters.spec.ts` said 4631 entities carry `request_filters` where `paste-filter-cap.spec.ts` said 4639 for the same thing; 4639 was right. Neither is an assertion, so neither went red. Re-measure rather than editing by inspection; the script is in the #186 plan.
```

- [ ] **Step 4: Spec header comments - counts**

Each is prose inside a block comment. Change only what the measurement says.

`tests/chest-filters.spec.ts:32-40`, replace:

```
    The shapes here are the ones the corpus actually holds. Measured over
    wormeyman-tests/: 4631 entities carry a `request_filters` object, every
    section is at index 1 (not 0), all 3461 filters carry `quality` and
    `comparator` as well as index/name/count, 433 objects carry
    `request_from_buffers` and 54 `trash_not_requested`, and 14 have a second
    section.
```

with:

```
    The shapes here are the ones the corpus actually holds. Measured over
    test-blueprints/: 5995 entities carry a `request_filters` object, every
    section is at index 1, 2 or 3 and none at 0, all 4069 filters carry
    `quality` and `comparator` as well as index/name/count, 728 objects carry
    `request_from_buffers` and 36 `trash_not_requested`, and 19 have a second
    section.
```

`tests/paste-filter-cap.spec.ts:29-32`, replace:

```
    The corpus cannot test any of this: measured over wormeyman-tests/, 4639
    chests carry `request_filters` and the largest section-0 filter list in all
    578 blueprints is **5**. Nothing there comes within 6x of the old cap, let
    alone the real one, so both cases here are synthetic.
```

with:

```
    The corpus cannot test any of this: measured over test-blueprints/, 5995
    entities carry `request_filters` and the largest section-0 filter list in
    all 367 blueprints is **19**. Still under the old 30-slot cap and 50x under
    the real 1000, so both cases here are synthetic - but note that number went
    5 -> 19 when the corpus went public (#186), so it is closer to the old cap
    than it reads, and a corpus addition could cross it.
```

`tests/pre-2-0-shape-migrations.spec.ts:17-19`, replace `measured over wormeyman-tests/` with `measured over test-blueprints/`, and at lines 154-156 replace:

```
        1 is what the corpus says: measured over wormeyman-tests/, all 4645
        `request_filters` sections are at index 1 or 2, and all 1452
        `control_behavior` sections run 1 through 15, contiguous from 1. Nothing
        anywhere is at 0.
```

with:

```
        1 is what the corpus says: measured over test-blueprints/, all 6017
        `request_filters` sections are at index 1, 2 or 3, and all 1344
        `control_behavior` sections run 1 through 15, contiguous from 1. Nothing
        anywhere is at 0. (The 1452 this said before #186 counted
        wormeyman-tests/a.txt, a top-level file discoverBlueprintFiles never
        read - it only walks directories.)
```

`tests/rail-placement-rules.spec.ts:11`: `all 578 blueprints in wormeyman-tests/ are real` becomes `all 367 blueprints in test-blueprints/ are real`.

`tests/name-migrations.spec.ts:11-15`, replace:

```
    It needs synthetic blueprints because it cannot come from the corpus: every
    file in wormeyman-tests/ declares 2.0.45 or later, so nothing in it should be
    migrated at all. That is what made issue #40 invisible for so long - the
    renames were running on all 578 of them, and the two whose source names are
    live prototypes again quietly rewrote 9535 stack inserters.
```

with:

```
    It needs synthetic blueprints because it cannot come from the corpus: every
    file in test-blueprints/ declares 2.0.32 or later, so nothing in it should be
    migrated at all. That is what made issue #40 invisible for so long - the
    renames were running on every blueprint in the corpus of the day, and the two
    whose source names are live prototypes again quietly rewrote thousands of
    stack inserters (9,479 measured over that corpus; the current one holds
    2,790).
```

`tests/unknown-prototypes.spec.ts:15`: `every blueprint in wormeyman-tests/ loads clean today` becomes `every blueprint in test-blueprints/ loads clean today`.

`tests/blueprint-round-trip.spec.ts:40`: `wormeyman-tests/ carries a version` becomes `test-blueprints/ carries a version`.

`tests/blueprint-sources.spec.ts:15`: `Every file in wormeyman-tests/` becomes `Every file in test-blueprints/`.

`tests/entity-accessors.spec.ts:121`: `across all 578 blueprints in wormeyman-tests/` becomes `across all 367 blueprints in test-blueprints/`.

`tests/sprite-data.spec.ts:214-215`: `Books are most of wormeyman-tests/ and loading one renders` becomes `Books are most of test-blueprints/ and loading one renders`.

`tests/helpers/all-entities-blueprint.ts:9`: `The curated blueprints in wormeyman-tests/ are real bases` becomes `The curated blueprints in test-blueprints/ are real bases`.

`tests/helpers/all-recipes-blueprint.ts:9`: `The curated blueprints in wormeyman-tests/ only carry` becomes `The curated blueprints in test-blueprints/ only carry`.

`tests/helpers/encode-blueprint.ts:5`: `cannot come out of wormeyman-tests/` becomes `cannot come out of test-blueprints/`.

- [ ] **Step 5: Verify nothing still names the old corpus in live code**

```bash
git grep -n "wormeyman-tests\|AVADII" -- ':!docs/superpowers'
```

Expected: no output. `docs/superpowers/` is excluded because the historical plans and specs under it record what was true when they were written and should not be rewritten.

- [ ] **Step 6: Checks and commit**

```bash
vp check
npx playwright test
```

Expected: `vp check` clean, full suite green - the comment edits should not have touched behaviour, and this confirms it.

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs: re-measure the corpus figures quoted in comments and docs

These are measurements written as prose rather than assertions, so nothing goes
red when they go stale - and they are where the next person's mental model comes
from. Re-derived against the new corpus rather than edited by inspection, which
is what turned up that two were already wrong: pre-2-0-shape-migrations quoted
1452 control_behavior sections against a discovered corpus holding 1295, the 157
difference being wormeyman-tests/a.txt, which discoverBlueprintFiles never read;
and chest-filters quoted 4631 request_filters entities where paste-filter-cap
quoted 4639 for the same thing.

One figure is worth knowing about rather than just updating: the largest
section-0 filter list went 5 -> 19. Still under the old 30-slot cap and far
under the real 1000, so paste-filter-cap's synthetic cases stand, but it is much
closer than it was.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ErAwBHYHrkdJdmwYhHGGxq
EOF
)"
```

---

## Task 6: Delete the recorder and open the PR

**Files:**

- Delete: `playwright.recorder.config.ts`
- Delete: `tests/record-fixtures.recorder.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: the final branch state.

**Why the recorder goes:** it is a measuring instrument, not a test, the same way `tools/oracle/` probes are. Leaving it behind turns four deliberate fixed points into refreshable snapshots, which is exactly what the specs' own headers say they must not be ("There is deliberately no way to re-record it"). If the corpus ever changes again, this plan and the git history are the recipe.

- [ ] **Step 1: Delete both files**

```bash
git rm playwright.recorder.config.ts tests/record-fixtures.recorder.ts
```

- [ ] **Step 2: Verify nothing references them and nothing references the old corpus**

```bash
git grep -n "recorder\|FBE_RECORD_OUT" -- ':!docs/superpowers' | grep -v "^docs/"
git grep -n "wormeyman-tests\|AVADII" -- ':!docs/superpowers'
git status --short
```

Expected: no output from either grep, and a clean working tree apart from the staged deletions.

- [ ] **Step 3: Full verification, from clean**

With `npm run localpreview` running:

```bash
vp check
vp test
npx playwright test
```

Expected: `vp check` 0 errors 0 warnings; `vp test` all passing; every Playwright spec passing. Paste the tail of each output into the completion report - do not claim green without it.

- [ ] **Step 4: Prove a fresh clone works, which is the whole point of #186**

```bash
TMPC=$(mktemp -d)
git clone --branch public-blueprint-corpus "$(pwd)" "$TMPC/fbe"
ls "$TMPC/fbe/test-blueprints/EARN" "$TMPC/fbe/test-blueprints/JEPAKAZOL" | cat
node -e "
const fs=require('fs'),path=require('path');
let n=0;
const root=process.argv[1]+'/test-blueprints';
for(const c of fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()))
  n+=fs.readdirSync(path.join(root,c.name)).filter(f=>f.endsWith('.txt')).length;
console.log('blueprint files in a fresh clone:',n);
" "$TMPC/fbe"
rm -rf "$TMPC"
```

Expected: `blueprint files in a fresh clone: 12`. This is the assertion `expect(files.length).toBeGreaterThan(0)` was failing on.

- [ ] **Step 5: Commit and push**

```bash
git commit -m "$(cat <<'EOF'
test: remove the fixture recorder now that the corpus swap has landed

A measuring instrument, not a test - the same way tools/oracle/ treats a probe.
Leaving it would turn four deliberate fixed points into refreshable snapshots,
which is what their own headers say they must not be. If the corpus moves again,
the plan and this history are the recipe.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ErAwBHYHrkdJdmwYhHGGxq
EOF
)"
git push -u origin public-blueprint-corpus
```

- [ ] **Step 6: Open the PR**

Target `wormeyman-space-age-support`. Do not put `#186` in the title.

```bash
gh pr create --base wormeyman-space-age-support --title "Commit a public blueprint corpus so the suite works on a fresh clone" --body "$(cat <<'EOF'
Nine Playwright specs sourced their blueprints from `wormeyman-tests/`, which was
gitignored and undistributed. On a clone without it they did not degrade to
reduced coverage - they failed at their own
`expect(files.length).toBeGreaterThan(0)`. For `sprite-data.spec.ts` that was
2,095 of 3,645 digests, and specifically the half carrying the neighbour-reading
branches of `spriteDataBuilder.ts`, which the synthetic corpus cannot reach by
construction.

`test-blueprints/` replaces it, committed: the four ElderAxe books byte-identical,
plus eight blueprints by Jepakazol from factorio.school, one per planet plus a
space platform. `test-blueprints/README.md` carries the attribution, the source
links and what the set is chosen for.

## What moved

578 flattened blueprints -> 367, 408,290 entities -> 347,725, 5.75 MB -> 4.68 MB.
Five entity types leave with AVADII and none has a grid-reading `draw_*`
function, so nothing is lost where junctions are concerned; all five stay
covered by the synthetic halves. Where it counts the new corpus is better:
`stone-wall` 3,989 -> 6,130, `gate` 192 -> 240, loaders 4 -> 135. That last one
closes the one grid-reading family the EARN books alone did not carry: the old
corpus held four `turbo-loader` and no `loader`, `fast-loader` or
`express-loader` at all.

## How the fixtures were re-recorded, and why you can trust them

2,000+ digests is past hand-editing and the repo deliberately has no re-record
path, so a throwaway recorder did it and was deleted in the last commit.

It was run **first against the corpus exactly as it stood, AVADII included**, and
required to reproduce every committed fixture byte for byte. If it cannot
reproduce what is already there, nothing it produces afterwards means anything.
Only then was the corpus swapped, so every remaining diff is attributable to the
corpus change alone. A `new ⊆ old` subset check was considered and rejected -
adding blueprints introduces genuinely new digests, so the relation does not
hold.

A second check falls out of the same run: `synthetic`, `noGrid` and
`paintPreview` are built from `data.json` and never read the corpus, and all
three are unchanged.

## Two things the design spec did not cover

- `entity-container-mappings.spec.ts` named an AVADII file directly and pinned
  its 2-entity count. `SMALL` is now `EARN/earn-v22-0-12.rev-2` at 69.
- `discoverBlueprintFiles()` used raw `readdirSync` order, and
  `blueprint-round-trip`'s `serializedHash` folds the corpus in iteration order.
  That fixture was a fixed point only on the machine that recorded it, which is
  the one thing a committed corpus must not be. Sorted explicitly, verified a
  no-op on this machine so the byte-identical control still holds.

## Not in scope

Moving Playwright into CI - possible now, but its own change with its own cost.
And refreshing the EARN books to their latest versions, deliberately deferred so
that "the corpus went public" and "the corpus versions moved" stay readable as
separate diffs.

The old corpus was moved to `~/fbe-wormeyman-tests-archive-2026-08-05` rather
than deleted; it was never committed, so `rm` would have been permanent.

Closes #186.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01ErAwBHYHrkdJdmwYhHGGxq
EOF
)"
```

---

## Self-review against the spec

| Spec section                                               | Task                                            |
| ---------------------------------------------------------- | ----------------------------------------------- |
| The corpus: `test-blueprints/EARN` byte-identical          | Task 3 Step 1                                   |
| The corpus: `test-blueprints/JEPAKAZOL`, 8 files by key    | Task 3 Steps 2, 2b, 4                           |
| `AVADII/`, `a.txt`, `NILAUS/` leave, never enter history   | Task 4 Step 1 (archived, not deleted)           |
| Attribution README                                         | Task 3 Step 5                                   |
| Fixture regeneration, recorder, byte-identical control     | Task 2 (control), Task 4 (re-record)            |
| Recorder deleted in the same PR                            | Task 6                                          |
| `expect(files.length).toBeGreaterThan(0)` guards stay      | untouched by every task, verified Task 6 Step 4 |
| No synthetic junction scaffolding                          | nothing in this plan adds any                   |
| `.gitignore:10`                                            | Task 4 Step 3                                   |
| `tests/helpers/blueprint-files.ts` `TESTS_DIR`             | Task 4 Step 2                                   |
| `CONTRIBUTING.md:126-128`                                  | Task 5 Step 2                                   |
| `CLAUDE.md` paths, counts, version range                   | Task 5 Step 3                                   |
| Verification: playwright green, `vp check`, `vp test`      | Task 6 Step 3                                   |
| Verification: control reproduced fixtures byte-identically | Task 2 Step 6                                   |
| Verification: no `wormeyman-tests` or `AVADII` survives    | Task 5 Step 5, Task 6 Step 2                    |
| Out of scope: Playwright in CI, EARN version refresh       | named in the PR body, no task                   |

Added beyond the spec, both justified above: Task 1 (deterministic ordering) and the `entity-container-mappings` swap in Task 4 Step 9.
