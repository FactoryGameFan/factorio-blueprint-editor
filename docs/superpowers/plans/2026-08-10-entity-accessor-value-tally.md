# Entity Accessor Value Tally Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tests/entity-accessors.spec.ts` record the exact value distribution of the 14 accessors with small closed value sets, so a getter that starts answering a wrong number, a wrong boolean or a swapped enum moves the fixture.

**Architecture:** One Playwright spec, restructured. `TALLIED` splits into two named lists. The 11 open-set accessors keep the four-bucket tally byte-identical; the 14 closed-set ones get an exact `Record<string, number>` histogram keyed by the stringified value. Two permanent guards (every histogram covers every entity; no histogram exceeds 16 distinct keys) plus a one-time fold-back proof that the recaptured numbers are the committed fixed point at higher resolution.

**Tech Stack:** Playwright, the `window.__fbe_test` hook, `test-blueprints/` (367 blueprints, 347,725 entities).

**Spec:** `docs/superpowers/specs/2026-08-10-entity-accessor-value-tally-design.md`

## Global Constraints

- **Both dev servers must be running** for every Playwright step: `npm run localpreview` from the repo root (Vite on 8080, sprite data on 8081).
- **`~/.vite-plus/bin` must be on PATH first.** Bare `npm`/`npx` inside this repo fails with `EBADDEVENGINES` against the `devEngines` npm `^12` pin. Use `export PATH="$HOME/.vite-plus/bin:$PATH"` in any shell that runs `npx playwright` or `vp`.
- **The fixture is a fixed point, not a snapshot.** The only sanctioned reason to write new numbers into it in this plan is Task 2's fold-back proof passing 14/14. If it does not pass, stop and report rather than recording.
- **Use hyphens, never em or en dashes,** in every file touched.
- **No issue number in a commit subject.** `Closes #189` goes in the PR body only.
- Branch is `test/entity-accessor-value-tally`, already created, based on `wormeyman-space-age-support`. The design commit `d768ca11` is already on it.
- The gate before the PR is `vp check .` clean plus the full Playwright suite.

---

## File Structure

| File                                                                      | Responsibility                                                                                     | Change                          |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| `tests/entity-accessors.spec.ts`                                          | The whole deliverable: two accessor lists, the key function, both records, the guards, the fixture | Modify (293 lines today)        |
| `CLAUDE.md`                                                               | The one-line description of what this spec covers                                                  | Modify, one bullet              |
| `docs/superpowers/specs/2026-08-10-entity-accessor-value-tally-design.md` | The design                                                                                         | Already committed, not modified |

No new files. The spec file stays one file: it is a characterization harness whose data and its interpretation belong together, and splitting the fixture into `tests/__fixtures__/` would separate the numbers from the header comment that says how to treat them.

---

### Task 1: Split the tally into `shape` and `values`, and capture the histograms

**Files:**

- Modify: `tests/entity-accessors.spec.ts` (whole file)

**Interfaces:**

- Consumes: `discoverBlueprintFiles`, `readBlueprintString` from `./helpers/blueprint-files` (unchanged signatures).
- Produces: the fixture object shape `{ entityCount: number, blueprintCount: number, shape: Record<string, Tally>, values: Record<string, Record<string, number>> }`, which Tasks 2, 3 and 4 all read.

- [ ] **Step 1: Replace the `TALLIED` list with two named lists**

Replace lines 26-54 (the `TALLIED` array and the `Tally` type) with:

```ts
/*
    Eleven accessors whose value set is open, so only the shape of what they
    answer can be pinned. Measured 2026-08-10 across the corpus: `filters` takes
    1018 distinct values, `recipe` 264, `combinatorConditions` 228. The three
    `accepted*` lists have few distinct values but enormous keys - one
    `acceptedFilters` value serializes to roughly 54,000 characters - and the
    only compact key for those is a hash, which names nothing when it moves.
*/
const TALLIED_SHAPE = [
    'recipe',
    'filters',
    'trainStopColor',
    'station',
    'constantCombinatorFilters',
    'displayPanelIcon',
    'modules',
    'combinatorConditions',
    'acceptedRecipes',
    'acceptedModules',
    'acceptedFilters',
] as const

/*
    Fourteen accessors whose value set is small and closed, recorded exactly.

    This is issue #189. The four-bucket tally cannot see a value, so 0 and 9 both
    read as `value` - which is the structural reason #186's splitter bug survived
    a 578-blueprint corpus. Worse, eight of these are total functions (never
    undefined, never throwing, never an array), so their old tally was pinned at
    exactly entityCount and could not move at all.

    Measured maximum is 10 distinct values (`inserterStackSize`); the whole group
    is 52 fixture entries, replacing the 56 bucket numbers it used to occupy.

    `possibleRotations` is here despite being an array because its keys are short
    and readable, unlike the `accepted*` lists above. The line between the two
    lists is "small closed value set", which only measurement establishes - note
    `recipe` is a scalar and belongs in the other list.
*/
const TALLIED_VALUES = [
    'directionType',
    'railLayer',
    'filterSlots',
    'splitterInputPriority',
    'splitterOutputPriority',
    'filterMode',
    'moduleSlots',
    'inserterStackSize',
    'possibleRotations',
    'canBeRotated',
    'maxWireDistance',
    'generateConnector',
    'assemblerHasFluidInputs',
    'mayCraftWithFluid',
] as const

type Tally = { value: number; empty: number; nothing: number; threw: number }
type Histogram = Record<string, number>
```

- [ ] **Step 2: Rewrite the in-page collection to build both records**

Replace the body of the `page.evaluate` call (lines 71-113 today) with:

```ts
const tally = await page.evaluate(
    async ({
        strings,
        shapeKeys,
        valueKeys,
    }: {
        strings: string[]
        shapeKeys: string[]
        valueKeys: string[]
    }) => {
        const api = (window as any).__fbe_test
        const shape: Record<string, Tally> = {}
        const values: Record<string, Histogram> = {}

        const bumpShape = (key: string, field: keyof Tally): void => {
            shape[key] ??= { value: 0, empty: 0, nothing: 0, threw: 0 }
            shape[key][field] += 1
        }

        const bumpValue = (key: string, bucket: string): void => {
            values[key] ??= {}
            values[key][bucket] = (values[key][bucket] ?? 0) + 1
        }

        /*
                One key function for every recorded accessor. `undefined` and
                `null` are distinct on purpose - inserterStackSize answers null
                where every other optional answers undefined, and collapsing them
                would hide a getter changing which one it uses.
            */
        const keyOf = (v: unknown): string =>
            v === undefined
                ? 'undefined'
                : v === null
                  ? 'null'
                  : typeof v === 'object'
                    ? JSON.stringify(v)
                    : String(v)

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

                    for (const key of shapeKeys) {
                        let v: unknown
                        try {
                            v = e[key]
                        } catch {
                            // some accessors throw on pre-2.0 shapes; that is behaviour too
                            bumpShape(key, 'threw')
                            continue
                        }
                        if (v === undefined || v === null) bumpShape(key, 'nothing')
                        else if (Array.isArray(v) && v.length === 0) bumpShape(key, 'empty')
                        else bumpShape(key, 'value')
                    }

                    for (const key of valueKeys) {
                        let v: unknown
                        try {
                            v = e[key]
                        } catch {
                            bumpValue(key, 'THREW')
                            continue
                        }
                        bumpValue(key, keyOf(v))
                    }
                }
            }
        }

        return { entityCount, blueprintCount, shape, values }
    },
    { strings: sources, shapeKeys: [...TALLIED_SHAPE], valueKeys: [...TALLIED_VALUES] }
)
```

- [ ] **Step 3: Point the fixture type at the new shape and empty the `values` record**

Replace the `EXPECTED` declaration's type (lines 134-141 today) with:

```ts
const EXPECTED: {
    entityCount: number
    blueprintCount: number
    shape: Record<string, Tally>
    values: Record<string, Histogram>
} = {
    entityCount: 347725,
    blueprintCount: 367,
    shape: {},
    values: {},
}
```

Delete the old `accessors: { ... }` block entirely. It is restored, split in two, in Steps 5 and 6.

- [ ] **Step 4: Add a temporary recorder line, then run to capture**

Immediately before `expect(tally).toEqual(EXPECTED)`, add:

```ts
console.log('CAPTURE ' + JSON.stringify({ shape: tally.shape, values: tally.values }, null, 4))
```

Run:

```bash
export PATH="$HOME/.vite-plus/bin:$PATH"
npx playwright test tests/entity-accessors.spec.ts --reporter=line 2>&1 | tee /tmp/capture.txt
```

Expected: FAIL on the `toEqual`, with the full capture printed above the failure. The `toEqual` diff alone is not the capture mechanism - Playwright truncates large diffs, which is why the explicit log is here.

- [ ] **Step 5: Paste the 11 `shape` entries, and verify they are unchanged**

These must equal the committed values from before this change, byte for byte. Do not copy them from the capture without comparing - the point is that this half did not move.

```ts
    shape: {
        acceptedFilters: { value: 54004, empty: 293721, nothing: 0, threw: 0 },
        acceptedModules: { value: 18771, empty: 328954, nothing: 0, threw: 0 },
        acceptedRecipes: { value: 14366, empty: 333359, nothing: 0, threw: 0 },
        combinatorConditions: { value: 2656, empty: 0, nothing: 345069, threw: 0 },
        constantCombinatorFilters: { value: 988, empty: 346737, nothing: 0, threw: 0 },
        displayPanelIcon: { value: 523, empty: 0, nothing: 347202, threw: 0 },
        filters: { value: 16605, empty: 4258, nothing: 326862, threw: 0 },
        modules: { value: 17476, empty: 330249, nothing: 0, threw: 0 },
        recipe: { value: 9345, empty: 0, nothing: 338380, threw: 0 },
        station: { value: 195, empty: 0, nothing: 347530, threw: 0 },
        trainStopColor: { value: 2717, empty: 0, nothing: 345008, threw: 0 },
    },
```

Confirm against the pre-change file:

```bash
git show HEAD:tests/entity-accessors.spec.ts | grep -A5 "acceptedFilters:"
```

Expected: the same four numbers. If any differ, stop - something other than this refactor changed behaviour.

- [ ] **Step 6: Paste the 14 `values` histograms**

These are the measured capture. They are reproduced here so the engineer does not have to trust a transcription, and Task 2 proves them against the committed buckets.

```ts
    values: {
        assemblerHasFluidInputs: { false: 344517, true: 3208 },
        canBeRotated: { false: 103215, true: 244510 },
        directionType: { input: 14246, output: 14265, undefined: 319214 },
        filterMode: { blacklist: 139, whitelist: 347586 },
        filterSlots: { '0': 293721, '1': 5910, '5': 44861, '30': 3233 },
        generateConnector: { false: 314925, true: 32800 },
        inserterStackSize: {
            '1': 408,
            '2': 28,
            '3': 30441,
            '4': 8,
            '5': 1,
            '7': 444,
            '8': 113,
            '10': 4,
            '12': 13279,
            null: 302999,
        },
        mayCraftWithFluid: { false: 342259, true: 5466 },
        maxWireDistance: {
            '0': 118354,
            '7.5': 1178,
            '9': 225198,
            '10': 8,
            '18': 1513,
            '32': 1474,
        },
        moduleSlots: { '0': 330249, '2': 10337, '3': 1718, '4': 5167, '5': 221, '8': 33 },
        possibleRotations: {
            '[]': 90879,
            '[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]': 4621,
            '[0,2,4,6,8,10,12,14]': 39730,
            '[0,4]': 517,
            '[0,4,8,12]': 211978,
        },
        railLayer: { elevated: 749, undefined: 346976 },
        splitterInputPriority: { left: 164, right: 129, undefined: 347432 },
        splitterOutputPriority: { left: 726, right: 874, undefined: 346125 },
    },
```

- [ ] **Step 7: Remove the temporary recorder line and run to green**

Delete the `console.log('CAPTURE ...')` line added in Step 4.

Run:

```bash
export PATH="$HOME/.vite-plus/bin:$PATH"
npx playwright test tests/entity-accessors.spec.ts --reporter=line
```

Expected: PASS, 1 test.

- [ ] **Step 8: Commit**

```bash
git add tests/entity-accessors.spec.ts
git commit -m "test: record exact values for the fourteen closed-set accessors

The four-bucket tally cannot see a value, so 0 and 9 both read as 'value'.
Eight of the twenty-five accessors are total functions and were pinned at
exactly entityCount, so their tally was a constant that could not move.

TALLIED splits into TALLIED_SHAPE (11 open-set accessors, unchanged) and
TALLIED_VALUES (14 closed-set, exact histograms). 52 histogram entries replace
56 bucket numbers.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Prove the recapture folds back to the committed fixed point

**Files:**

- Create then delete: `/tmp/foldback.mjs` (never committed)

**Interfaces:**

- Consumes: the `values` record committed in Task 1, and the four-bucket numbers from `git show d768ca11~1:tests/entity-accessors.spec.ts`.
- Produces: the proof text pasted into the PR body in Task 5 and the file header comment in Task 5.

This is the gate. The file header forbids blindly re-recording the fixture and the original recorder was deleted, so the justification for new numbers is that folding each histogram into four buckets reproduces the committed ones exactly.

- [ ] **Step 1: Write the fold-back script**

```js
// /tmp/foldback.mjs
import { readFileSync } from 'fs'

// The 14 histograms exactly as committed in Task 1.
const HIST = JSON.parse(readFileSync('/tmp/hist.json', 'utf-8'))
// The four-bucket numbers for those same 14, from the pre-change file.
const COMMITTED = JSON.parse(readFileSync('/tmp/committed.json', 'utf-8'))
const ENTITY_COUNT = 347725

const fold = h => {
    const t = { value: 0, empty: 0, nothing: 0, threw: 0 }
    for (const [k, n] of Object.entries(h)) {
        if (k === 'undefined' || k === 'null') t.nothing += n
        else if (k === 'THREW') t.threw += n
        else if (k === '[]') t.empty += n
        else t.value += n
    }
    return t
}

let bad = 0
for (const [key, h] of Object.entries(HIST)) {
    const got = fold(h)
    const want = COMMITTED[key]
    const ok = ['value', 'empty', 'nothing', 'threw'].every(f => got[f] === want[f])
    const total = Object.values(h).reduce((a, b) => a + b, 0)
    if (!ok || total !== ENTITY_COUNT) bad++
    console.log(
        `${ok && total === ENTITY_COUNT ? 'ok  ' : 'FAIL'} ${key.padEnd(24)} ` +
            `folded ${JSON.stringify(got)} total ${total}` +
            (ok ? '' : ` != committed ${JSON.stringify(want)}`)
    )
}
console.log(`\n${Object.keys(HIST).length - bad}/${Object.keys(HIST).length} fold back exactly`)
process.exit(bad === 0 ? 0 : 1)
```

- [ ] **Step 2: Extract both inputs**

Write `/tmp/hist.json` by copying the `values` object from the committed
`tests/entity-accessors.spec.ts` and converting it to JSON (quote every key,
`false`/`true`/`null` become `"false"`/`"true"`/`"null"`).

Write `/tmp/committed.json` from the pre-change fixture:

```bash
git show d768ca11~1:tests/entity-accessors.spec.ts | sed -n '/^const EXPECTED/,/^}/p' > /tmp/old-fixture.txt
```

Take the 14 entries named in `TALLIED_VALUES` out of it.

- [ ] **Step 3: Run the proof**

```bash
node /tmp/foldback.mjs
```

Expected, exactly:

```
ok   filterSlots              folded {"value":347725,"empty":0,"nothing":0,"threw":0} total 347725
ok   maxWireDistance          folded {"value":347725,"empty":0,"nothing":0,"threw":0} total 347725
ok   moduleSlots              folded {"value":347725,"empty":0,"nothing":0,"threw":0} total 347725
ok   inserterStackSize        folded {"value":44726,"empty":0,"nothing":302999,"threw":0} total 347725
ok   assemblerHasFluidInputs  folded {"value":347725,"empty":0,"nothing":0,"threw":0} total 347725
ok   canBeRotated             folded {"value":347725,"empty":0,"nothing":0,"threw":0} total 347725
ok   generateConnector        folded {"value":347725,"empty":0,"nothing":0,"threw":0} total 347725
ok   mayCraftWithFluid        folded {"value":347725,"empty":0,"nothing":0,"threw":0} total 347725
ok   filterMode               folded {"value":347725,"empty":0,"nothing":0,"threw":0} total 347725
ok   railLayer                folded {"value":749,"empty":0,"nothing":346976,"threw":0} total 347725
ok   directionType            folded {"value":28511,"empty":0,"nothing":319214,"threw":0} total 347725
ok   splitterInputPriority    folded {"value":293,"empty":0,"nothing":347432,"threw":0} total 347725
ok   splitterOutputPriority   folded {"value":1600,"empty":0,"nothing":346125,"threw":0} total 347725
ok   possibleRotations        folded {"value":256846,"empty":90879,"nothing":0,"threw":0} total 347725

14/14 fold back exactly
```

**If any line says FAIL, stop and report.** A mismatch means the recapture is not the committed fixed point at higher resolution, and the numbers must not be committed on the strength of "the test passes with them".

- [ ] **Step 4: Save the output and delete the script**

```bash
node /tmp/foldback.mjs > /tmp/foldback-output.txt
rm /tmp/foldback.mjs
```

Nothing is committed by this task. The output is used in Task 5.

---

### Task 3: Add the two permanent guards

**Files:**

- Modify: `tests/entity-accessors.spec.ts`

**Interfaces:**

- Consumes: `tally.values` and `tally.entityCount` from Task 1.
- Produces: nothing later tasks read.

- [ ] **Step 1: Add both guards before the `toEqual`**

Insert immediately above `expect(tally).toEqual(EXPECTED)`:

```ts
/*
        Two guards on the histograms, before the fixture comparison so that a
        structural problem is named rather than arriving as a diff.

        Every histogram must account for every entity. That is free and always
        true, and it catches a recording bug that silently skips an accessor -
        which the toEqual would otherwise report as an unexplained diff in a
        fixture nobody wants to re-record.

        And no histogram may exceed 16 distinct keys. The measured maximum is 10
        (inserterStackSize). An accessor that turns open-set - which is what
        would happen if one of these started answering a name or a recipe - then
        fails by name here instead of dumping a thousand-line toEqual diff and
        inviting someone to paste it in.
    */
for (const [key, hist] of Object.entries(tally.values)) {
    const total = Object.values(hist).reduce((a, b) => a + b, 0)
    expect(total, `${key} histogram does not cover every entity`).toBe(tally.entityCount)
    expect(
        Object.keys(hist).length,
        `${key} has more distinct values than a closed set should - ` +
            `move it to TALLIED_SHAPE or find out why it changed`
    ).toBeLessThanOrEqual(16)
}
```

- [ ] **Step 2: Run to verify still green**

```bash
export PATH="$HOME/.vite-plus/bin:$PATH"
npx playwright test tests/entity-accessors.spec.ts --reporter=line
```

Expected: PASS.

- [ ] **Step 3: Verify the coverage guard actually fires**

Temporarily change the loop in Step 1 of Task 1's Step 2 collection so one accessor is skipped: in the `for (const key of valueKeys)` loop, add as the first line of the body:

```ts
if (key === 'railLayer' && entityCount % 2 === 0) continue
```

Run the spec.

Expected: FAIL with `railLayer histogram does not cover every entity`.

Then remove that line and re-run to green.

- [ ] **Step 4: Verify the cap guard actually fires**

Temporarily lower the cap from `16` to `1`. Run the spec.

Expected: FAIL naming an accessor with the "more distinct values than a closed set should" message.

Restore `16` and re-run to green.

- [ ] **Step 5: Commit**

```bash
git add tests/entity-accessors.spec.ts
git commit -m "test: guard that every histogram covers every entity and stays closed

Both verified to fire: skipping half of railLayer's entities fails the coverage
guard by name, and lowering the cap to 1 fails the closed-set guard by name.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Mutation-check five ways

**Files:**

- Temporarily modify then revert: `packages/editor/src/core/factorioData.ts`, `packages/editor/src/core/Entity.ts`
- No commit from this task except the results, which go into Task 5's PR body.

Each mutation is applied, the spec run, the result recorded, and the mutation reverted with `git checkout --` before the next. Run each with:

```bash
export PATH="$HOME/.vite-plus/bin:$PATH"
npx playwright test tests/entity-accessors.spec.ts --reporter=line
```

- [ ] **Mutation 1: delete `case 'splitter'` from `getMaxWireDistance`**

Delete line 559 of `packages/editor/src/core/factorioData.ts` (the `case 'splitter':` inside `getMaxWireDistance`, which starts at line 516). Note there are four `case 'splitter':` lines in that file - 223 in `isTransportBeltConnectable`, 328 in `getCircuitConnector`, 559 here, and 698 in `getPossibleRotations`. Delete only 559.

Expected: FAIL on `values.maxWireDistance`, with the four splitter types' entities moving from the `9` key to the `0` key.

Revert: `git checkout -- packages/editor/src/core/factorioData.ts`

- [ ] **Mutation 2: swap left and right in `splitterOutputPriority`**

In `packages/editor/src/core/Entity.ts`, change the getter at line 662 to:

```ts
    public get splitterOutputPriority(): FilterPriority | undefined {
        const p = this.m_rawEntity.output_priority
        return p === 'left' ? 'right' : p === 'right' ? 'left' : p
    }
```

Expected: FAIL on `values.splitterOutputPriority`, `{left: 726, right: 874}` arriving as `{left: 874, right: 726}`.

Revert: `git checkout -- packages/editor/src/core/Entity.ts`

- [ ] **Mutation 3: `canBeRotated` always true**

In `packages/editor/src/core/Entity.ts`, replace the body of the getter at line 1205 with `return true`.

Expected: FAIL on `values.canBeRotated`, `{false: 103215, true: 244510}` arriving as `{true: 347725}`.

Revert: `git checkout -- packages/editor/src/core/Entity.ts`

- [ ] **Mutation 4: `moduleSlots` always 0**

In `packages/editor/src/core/Entity.ts`, replace the body of the getter at line 400 with `return 0`.

Expected: FAIL on `values.moduleSlots`, six keys collapsing to `{0: 347725}`.

Revert: `git checkout -- packages/editor/src/core/Entity.ts`

- [ ] **Mutation 5: the control - a change touching none of the fourteen**

In `packages/editor/src/core/Entity.ts`, change the `station` getter at line 1020 to `return this.m_rawEntity.station ?? undefined`, which is behaviour-preserving, and separately confirm a real change to an open-set accessor does not silently pass: change it instead to `return this.m_rawEntity.station === undefined ? undefined : String(this.m_rawEntity.station) + 'x'`.

Expected: the behaviour-preserving version PASSES. The `+ 'x'` version also PASSES, because `station` is in `TALLIED_SHAPE` and its bucket counts do not change.

This is the control and its result is a **deliberate negative**: it documents that the 11 open-set accessors are still only shape-checked, so nobody reads this spec as covering them. Record both outcomes in the PR body.

Revert: `git checkout -- packages/editor/src/core/Entity.ts`

- [ ] **Step 6: Confirm the tree is clean**

```bash
git status --short
```

Expected: empty. If any mutation survives into the commit, the fixture no longer describes the real accessors.

---

### Task 5: Update the file header and CLAUDE.md, then open the PR

**Files:**

- Modify: `tests/entity-accessors.spec.ts` (header comment only)
- Modify: `CLAUDE.md` (one bullet)

- [ ] **Step 1: Rewrite the file header comment**

Replace the comment at lines 4-24 and the fixture provenance comment (lines 119-133 today) so they describe two records rather than one. The provenance comment must carry the fold-back proof, because that is what replaces the deleted recorder as the audit trail. Add, in the provenance comment:

```
    The fourteen `values` histograms were recaptured on 2026-08-10 (issue #189).
    That recapture is not a blind re-record, which the rule above forbids: each
    histogram folds back into the four buckets this file committed before the
    change - undefined/null to `nothing`, THREW to `threw`, [] to `empty`,
    everything else to `value` - and all fourteen reproduce the committed numbers
    exactly. splitterOutputPriority's {left:726, right:874} folds to value 1600
    against a committed value of 1600; inserterStackSize's null:302999 folds to
    nothing 302999 against a committed 302999. So these are the same fixed point
    at higher resolution, not a new snapshot.
```

- [ ] **Step 2: Update the CLAUDE.md bullet**

Find the bullet beginning `` `tests/entity-accessors.spec.ts` - Tallies what every `Entity` accessor returns `` and replace it with:

```
- `tests/entity-accessors.spec.ts` - What every `Entity` accessor answers across all 367 blueprints, in two records. The eleven open-set accessors are tallied by **shape** (a value, an empty list, nothing, or threw), which is what catches a getter returning `[]` where it returned `undefined`. The fourteen with a small closed value set are recorded as **exact histograms** (issue #189), because the shape tally cannot see a value: `0` and `9` both bucket as `value`, and eight accessors are total functions whose four-bucket tally was pinned at exactly `entityCount` and so could not move at all. That is the structural reason #186's splitter bug survived the corpus. Two guards keep it honest - every histogram must cover every entity, and none may exceed 16 distinct keys, so an accessor that turns open-set says so instead of dumping a thousand-line diff. Fixed point, not a refreshable snapshot: the sanctioned way to move a histogram is to prove it folds back to the previous four buckets, which is how the #189 recapture was justified.
```

- [ ] **Step 3: Run the whole gate**

```bash
export PATH="$HOME/.vite-plus/bin:$PATH"
vp check .
vp test
npx playwright test
```

Expected: `vp check` clean; `vp test` 154 passing across 12 files; Playwright 176 passed across 40 files.

- [ ] **Step 4: Commit and push**

```bash
git add tests/entity-accessors.spec.ts CLAUDE.md
git commit -m "docs: describe the two-record accessor tally and its fold-back rule

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin test/entity-accessor-value-tally
```

- [ ] **Step 5: Open the PR**

Base `wormeyman-space-age-support`. The body must carry the fold-back output from Task 2 Step 4, the mutation table from Task 4 including the control's deliberate negative, and `Closes #189`. No issue number in the title.

---

## Self-Review

**Spec coverage.** Two lists (Task 1 Step 1), key derivation (Task 1 Step 2), the `values`/`shape` records (Task 1 Steps 3-6), sum-to-entityCount and 16-key guards (Task 3), the fold-back proof (Task 2), the five mutations including the control (Task 4), the header and CLAUDE.md (Task 5). The spec's "what this deliberately does not do" section maps to Task 4 Mutation 5, which turns the open-set gap into a recorded result rather than an unstated limitation.

**Types.** `Tally` and `Histogram` are declared once in Task 1 Step 1 and used unchanged in Steps 2 and 3 and in Task 3. The fixture keys `entityCount`, `blueprintCount`, `shape`, `values` are identical in the collection code, the `EXPECTED` type, and both guards.

**One risk worth naming.** Task 1 Step 6's histograms are transcribed from a probe run, and a transcription error would produce a spec that passes against wrong numbers. Task 2 is precisely the check for that: a mistyped count breaks the fold-back, since the buckets it must reproduce are independently committed. Run Task 2 before trusting Task 1.
