# Exact value recording for closed-set Entity accessors

Closes #189.

## The problem

`tests/entity-accessors.spec.ts` walks every entity in every corpus blueprint and
tallies each accessor into four buckets: `value`, `empty`, `nothing`, `threw`. That
is the right instrument for what it was built for - catching a getter that starts
returning `[]` where it returned `undefined` - but it records that something came
back and never what.

The issue frames this as a numeric problem: `0` and `9` both land in `value`.
Measuring it makes the statement sharper and worse.

**Eight of the twenty-five tallied accessors are pinned at exactly `entityCount`,
with zero in every other bucket.** All eight are total functions - never
`undefined`, never throwing, never an array - so their four-bucket tally is not
merely coarse, it is a _constant_. It cannot move unless the accessor starts
throwing or returning nothing.

| Accessor                                                                            | Type         | Committed tally |
| ----------------------------------------------------------------------------------- | ------------ | --------------- |
| `filterSlots`, `maxWireDistance`, `moduleSlots`                                     | `number`     | `value: 347725` |
| `assemblerHasFluidInputs`, `canBeRotated`, `generateConnector`, `mayCraftWithFluid` | `boolean`    | `value: 347725` |
| `filterMode`                                                                        | `FilterMode` | `value: 347725` |

So 32% of the instrument measures nothing about behaviour.

**And the hole is wider than the numerics the issue names.** Five enum-valued
accessors have the same defect, because every non-empty value buckets as `value`:
a wholesale swap of `left` and `right` in `splitterOutputPriority` moves no number
in the fixture. Neither does inverting `directionType`.

This is not hypothetical. It is the structural reason the splitter bug in #186
survived a 578-blueprint corpus: with `splitter` missing from `getMaxWireDistance`
every splitter answered `0` instead of `9`, and both bucket as `value`. When #189
was filed, deleting `case 'splitter':` left 175 of 176 Playwright tests, all
vitest tests and `vp check` green.

**#188 has since closed that one hole, and does not close this one.**
`tests/wire-switch-completeness.test.ts` (PR #205) now catches exactly that
deletion. But it works by asking whether every prototype declaring
`circuit_wire_max_distance` in `data.json` gets a non-default answer, so it can
only ever cover accessors backed by a declared prototype field. Nothing in it
sees `canBeRotated`, `possibleRotations`, `filterSlots` or `inserterStackSize`,
whose values are computed. The tally is still the only instrument that watches
those, and it still cannot see a value.

## What was measured before deciding

A throwaway recorder (appendix below) ran over all 25 accessors against
`test-blueprints/` on 2026-08-10: 367 blueprints, 347,725 entities. Its
`entityCount` reproduces the committed fixture exactly, which is the control that
it is reading the same thing.

**The issue's stated reason for preferring a cheap fix is refuted.** It says
recording exact values would churn because "`inserterStackSize` and `moduleSlots`
would add churn if recorded exactly". Measured, every closed-set accessor is tiny:

| Accessor                  | Distinct | Distribution                                                        |
| ------------------------- | -------- | ------------------------------------------------------------------- |
| `maxWireDistance`         | 6        | 9→225198, 0→118354, 18→1513, 32→1474, 7.5→1178, 10→8                |
| `moduleSlots`             | 6        | 0→330249, 2→10337, 4→5167, 3→1718, 5→221, 8→33                      |
| `inserterStackSize`       | 10       | null→302999, 3→30441, 12→13279, 7→444, 1→408, and five more         |
| `filterSlots`             | 4        | 0→293721, 5→44861, 1→5910, 30→3233                                  |
| `possibleRotations`       | 5        | `[0,4,8,12]`→211978, `[]`→90879, `[0,2,...,14]`→39730, and two more |
| `directionType`           | 3        | undefined→319214, output→14265, input→14246                         |
| `splitterOutputPriority`  | 3        | undefined→346125, right→874, left→726                               |
| `splitterInputPriority`   | 3        | undefined→347432, left→164, right→129                               |
| `railLayer`               | 2        | undefined→346976, elevated→749                                      |
| `filterMode`              | 2        | whitelist→347586, blacklist→139                                     |
| `canBeRotated`            | 2        | true→244510, false→103215                                           |
| `generateConnector`       | 2        | false→314925, true→32800                                            |
| `mayCraftWithFluid`       | 2        | false→342259, true→5466                                             |
| `assemblerHasFluidInputs` | 2        | false→344517, true→3208                                             |

Fifty-two histogram entries in place of the fifty-six bucket numbers those
fourteen accessors occupy today. The fixture gets **smaller** while going from
shape-only to exact distribution, so the trade-off the issue was weighing does not
exist.

**The line between the two groups is sharp**, which is what makes an explicit
split defensible rather than arbitrary. The other eleven accessors are open sets:

| Accessor                    | Distinct |
| --------------------------- | -------- |
| `filters`                   | 1018     |
| `recipe`                    | 264      |
| `combinatorConditions`      | 228      |
| `constantCombinatorFilters` | 156      |
| `displayPanelIcon`          | 147      |
| `modules`                   | 79       |
| `station`                   | 36       |
| `trainStopColor`            | 16       |
| `acceptedRecipes`           | 14       |
| `acceptedModules`           | 7        |
| `acceptedFilters`           | 2        |

`acceptedFilters` and `acceptedModules` have few distinct values but are excluded
anyway: their keys are the serialized arrays, and `acceptedFilters` has a single
key roughly 54,000 characters long. The only compact key for those is a hash, and
a hash that moves names nothing about what changed, which is the opposite of what
this fixture is for.

## Decisions

### The split: two lists, two records

`TALLIED` becomes two explicit `const` arrays, and the fixture two records under
the same single `toEqual`:

```ts
const TALLIED_VALUES = [...] // 14 accessors -> exact histogram
const TALLIED_SHAPE = [...]  // 11 accessors -> four-bucket tally, unchanged

const EXPECTED = {
    entityCount: 347725,
    blueprintCount: 367,
    values: { maxWireDistance: { '9': 225198, '0': 118354, ... }, ... },
    shape: { filters: { value: 16605, empty: 4258, nothing: 326862, threw: 0 }, ... },
}
```

`values` holds the thirteen closed-set scalars plus `possibleRotations`. `shape`
holds the eleven open-set accessors, byte-identical to what is committed today.

**Two hand-written lists rather than a runtime type test.** The tempting rule is
"histogram anything scalar", and it is wrong: `recipe` is a scalar with 264
distinct values. The criterion is "small closed value set", which only measurement
can establish, so it is written down with the measurement beside it. Adding an
accessor to the spec forces a choice between the two lists rather than defaulting
into either.

### Key derivation

One function, applied uniformly:

| Value          | Key                 |
| -------------- | ------------------- |
| `undefined`    | `'undefined'`       |
| `null`         | `'null'`            |
| accessor threw | `'THREW'`           |
| object / array | `JSON.stringify(v)` |
| anything else  | `String(v)`         |

This is why `possibleRotations` qualifies and the `accepted-*` arrays do not - the
rule is the same for all of them, and only the resulting key length differs.

### Two guards

**Permanent: every histogram sums to `entityCount`.** Free, always true, and it
catches a recording bug that silently skips an accessor - which the `toEqual`
alone would report as an unexplained diff.

**Permanent: at most 16 distinct keys per histogram.** The measured maximum is 10.
An accessor that turns open-set then fails by name instead of dumping a
thousand-line `toEqual` diff.

**Transition only: the fold-back proof.** The file's header forbids blindly
re-recording the fixed point, and the recorder that produced it was deleted. The
justification for the recapture is that each new histogram folds back into the
committed four buckets exactly - `undefined`/`null` to `nothing`, `THREW` to
`threw`, `[]` to `empty`, everything else to `value`. Verified for all fourteen:

```
ok   filterSlots              folded {"value":347725,...}          total 347725
ok   inserterStackSize        folded {"value":44726,"nothing":302999} total 347725
ok   splitterOutputPriority   folded {"value":1600,"nothing":346125}  total 347725
ok   possibleRotations        folded {"value":256846,"empty":90879}   total 347725
...
14/14 accessors fold back exactly
```

So the new numbers are not a fresh unvalidated snapshot; they are the committed
fixed point at higher resolution. This proof goes in the PR body and as a comment
in the spec file, replacing the deleted recorder as the audit trail.

### What does not change

Playwright rather than vitest, because `Entity` needs `FD` loaded. The corpus,
`entityCount`, `blueprintCount`, the eleven `shape` tallies, and the fixed-point
rule in the file header.

## Verification

`vp check` clean and the full Playwright suite unchanged except for this spec.
Mutation-checked, each mutation expected to fail this spec and be named by it:

| Mutation                                           | This spec today | Expected after                                       |
| -------------------------------------------------- | --------------- | ---------------------------------------------------- |
| Delete `case 'splitter'` from `getMaxWireDistance` | green\*         | `maxWireDistance` moves, splitters shift 9 → 0       |
| Swap `left`/`right` in `splitterOutputPriority`    | green           | `{right:874,left:726}` inverts                       |
| `canBeRotated` always returns true                 | green           | `{true:347725}` against `{true:244510,false:103215}` |
| `moduleSlots` always returns 0                     | green           | six keys collapse to one                             |
| A change touching none of the fourteen             | green           | green - the control                                  |

\* caught elsewhere as of #205, by `wire-switch-completeness.test.ts`. It is kept
in the table because it is the bug that motivated the issue, and because two
independent detectors of it is the point rather than a redundancy - that one reads
`data.json`, this one reads what entities actually answered.

The control matters for the same reason it does in `rail-placement-rules.spec.ts`:
a change that made every histogram a single key would satisfy four of these five.

## What this deliberately does not do

**It does not check that any value is correct.** This is a fixed point: it detects
change, not truth. A wrong-but-stable number stays wrong, and the fixture will
happily pin it. What it buys is that the _next_ change to a closed-set accessor
cannot land silently, which is exactly the property #186 needed and did not have.

**It does not record values for the eleven open-set accessors.** A cheap partial
would be a distinct-count per accessor, catching a wholesale collapse such as
`recipe` answering the same value for every entity. Twelve extra numbers, and it
is not done here: `filters` at 1018 and `combinatorConditions` at 228 are
sensitive to incidental serialization detail, and a fixed point that moves for
uninteresting reasons trains people to re-record it blind - which the header
spends a paragraph warning against.

## Appendix: the recorder

The measurements above came from a throwaway Playwright spec, deleted rather than
committed, on the principle that a measuring instrument is not a test. The recipe,
so it does not have to be reinvented if the corpus moves:

```ts
// tests/zz-probe-accessor-values.spec.ts, run with both dev servers up
const result = await page.evaluate(
    async ({ strings, accessors }) => {
        const api = (window as any).__fbe_test
        const dist: Record<string, Record<string, number>> = {}
        const bump = (key: string, v: unknown): void => {
            dist[key] ??= {}
            const k =
                v === undefined
                    ? 'undefined'
                    : v === null
                      ? 'null'
                      : typeof v === 'object'
                        ? JSON.stringify(v)
                        : String(v)
            dist[key][k] = (dist[key][k] ?? 0) + 1
        }
        let entityCount = 0
        for (const str of strings) {
            const loaded = await api.getBlueprintOrBookFromSource(str)
            const isBook = typeof loaded.selectBlueprint === 'function'
            const count = isBook ? loaded.lastBookIndex + 1 : 1
            for (let i = 0; i < count; i++) {
                const bp = isBook ? loaded.selectBlueprint(i) : loaded
                for (const e of bp.entities.values()) {
                    entityCount += 1
                    for (const key of accessors) {
                        try {
                            bump(key, e[key])
                        } catch {
                            bump(key, 'THREW')
                        }
                    }
                }
            }
        }
        return { entityCount, dist }
    },
    { strings: sources, accessors: [...PROBED] }
)
```

Note the `EBADDEVENGINES` trap when running it: bare `npm`/`npx` inside this repo
fails against the `devEngines` npm `^12` pin, so `~/.vite-plus/bin` has to be on
PATH first.
