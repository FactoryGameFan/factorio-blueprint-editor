# Batch 2a: Sprite-shape narrowing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 49 mechanical sprite-shape/return-type TypeScript errors in `packages/editor/src/core/spriteDataBuilder.ts` by routing typed-factorio `Base | Struct` union access through a new, unit-tested pure helper module, dropping the type-check gate baseline from 59 to the measured remainder (expected 10).

**Architecture:** Add `packages/editor/src/core/spriteShape.ts` — pure functions that collapse typed-factorio sprite unions (`SpriteVariations`, `Sprite4Way`, `Animation4Way`, `RotatedAnimation8Way`, turret `base_visualisation`) to the concrete `SpriteData` runtime shape using `in`-operator narrowing. Call sites in `spriteDataBuilder.ts` replace direct struct-member access (`.layers`, `.sheet`, `.sheets`, `.animation`, `.north`) with helper calls. Helpers are unit-tested with Vitest, which is new to `packages/editor`.

**Tech Stack:** TypeScript 5.9, typed-factorio 3.35, Vitest 3.x (new), the existing `scripts/type-check-gate.mjs` CI gate.

**Reference spec:** `docs/superpowers/specs/2026-06-27-batch-2a-sprite-shape-narrowing-design.md`

## Global Constraints

These are locked principles from the spec's review reconciliation. Every task is bound by them; **do not reverse without asking the user.**

- **No defensive null-handling in helpers.** Helpers take typed-factorio field types as-is (mostly non-optional) and do **not** accept `undefined | null` or swallow it into `[]`. A malformed-data access must still throw so the existing `getSpriteData` try/catch (`spriteDataBuilder.ts:150-159`) catches it, logs, and returns `SPRITE_GENERATION_FAILED`. Silent empty returns would hide that diagnostic. Call sites that are already optional (e.g. `e.folded_animation?.layers?.[0]`) keep handling optionality locally.
- **`sheetOf` returns `SpriteData`, never `SpriteData | undefined`.** Results feed straight into `duplicateAndSetPropertyUsing(...)`, which requires non-undefined `SpriteData`.
- **No speculative recursion / branches.** Add a union branch to a helper only when a real failing call site needs it (TDD-driven). Do not pre-handle shapes no site exercises.
- **Narrowest cast, not `as any`.** Where a struct member (`SpriteSheet`, `SpriteNWaySheet`) must become `SpriteData`, use `as SpriteData` (or `as unknown as SpriteData`) with a short comment. Blanket `as any` is the exact thing this cleanup removes.
- **`SpriteData` is the file alias** for `factorio:prototype` `Sprite` (`import { Sprite as SpriteData } from 'factorio:prototype'`). The new module imports it the same way. `spriteShape.ts` lives in `core/`, so its util import is `../common/util` (not needed unless a helper uses it).
- **No typed-factorio augmentation in 2a.** If a site that looks mechanical turns out to need a genuinely-absent field, defer it to 2b and leave it as a remaining gate error. The 2a target is "whatever remains after the mechanical sites are fixed" (expected 10); `maxErrors` is set to that measured number, not a hard zero.
- **Prefer the latest stable Vitest** (3.x line) per repo's current-versions preference.

---

## File Structure

- **Create** `packages/editor/src/core/spriteShape.ts` — the six pure narrowing helpers. No PixiJS / FD dependency.
- **Create** `packages/editor/src/core/spriteShape.test.ts` — Vitest unit tests, one `describe` per helper, every union branch covered with inline fixtures.
- **Create** `packages/editor/vitest.config.ts` — Vitest config (node env, `src/**/*.test.ts`).
- **Modify** `packages/editor/package.json` — add `vitest` devDependency + `test:unit` / `test:unit:watch` scripts.
- **Modify** `package.json` (root) — add `"test:unit": "npm --workspace=@fbe/editor run test:unit"`.
- **Modify** `.github/workflows/ci.yml` — add a unit-test step before the type-check gate.
- **Modify** `packages/editor/src/core/spriteDataBuilder.ts` — convert ~49 call sites to helpers; add the `spriteShape` import.
- **Modify** `scripts/type-check-baseline.json` — ratchet `maxErrors` 59 → measured remainder.

## Helper interfaces (the shared contract)

Every conversion task consumes these. Signatures are pinned during TDD but should land as:

```ts
// packages/editor/src/core/spriteShape.ts
import { Sprite as SpriteData } from 'factorio:prototype'
import type {
    SpriteVariations,
    Sprite4Way,
    Animation4Way,
    RotatedAnimation8Way,
    TurretBaseVisualisation,
} from 'factorio:prototype'

// 'layers' in x ? x.layers : [x]
export function layersOf(
    x: SpriteVariations | SpriteData | Animation4Way | RotatedAnimation8Way
): readonly SpriteData[]

// 'sheet' in x ? x.sheet : x   (struct member coerced `as SpriteData`)
export function sheetOf(x: SpriteVariations | Sprite4Way): SpriteData

// 'sheets' in x ? x.sheets : [x]
export function sheetsOf(x: Sprite4Way): readonly SpriteData[]

// directional Animation4Way -> that direction's layers
export function fourWayAnimation(x: Animation4Way, dir: number): readonly SpriteData[]

// resolve array|object base_visualisation, return its animation layers;
// pass dir for the directional (fluid-turret) form
export function baseVisualisationLayers(
    bv: TurretBaseVisualisation | readonly TurretBaseVisualisation[],
    dir?: number
): readonly SpriteData[]

// SpriteVariations -> SpriteData[] for return/arg-type positions
export function toSpriteArray(x: SpriteVariations): readonly SpriteData[]
```

> The exact member type names (`TurretBaseVisualisation`, the `Animation4Way` direction keys) must be confirmed against the installed `typed-factorio` `.d.ts` during Task 1 — adjust imports to the real exported names. Use `util.getDirName(dir)` from `../common/util` inside `fourWayAnimation` for the direction key, matching existing call-site usage.

---

### Task 1: Vitest infrastructure + first helper (`layersOf`)

Stands up the editor's unit-test home and delivers the first helper end-to-end (TDD). Folds all Vitest scaffolding into the task whose deliverable needs it.

**Files:**

- Create: `packages/editor/vitest.config.ts`
- Create: `packages/editor/src/core/spriteShape.ts`
- Create: `packages/editor/src/core/spriteShape.test.ts`
- Modify: `packages/editor/package.json`
- Modify: `package.json` (root)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Produces: `layersOf(x): readonly SpriteData[]` — `'layers' in x ? x.layers : [x]`.

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev --workspace=@fbe/editor vitest
```

Expected: `vitest` (3.x) added to `packages/editor/package.json` devDependencies; lockfile updated.

- [ ] **Step 2: Add Vitest config**

Create `packages/editor/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
})
```

- [ ] **Step 3: Add unit-test scripts**

In `packages/editor/package.json`, add to `scripts` (create the block if absent):

```json
"scripts": {
    "test:unit": "vitest run",
    "test:unit:watch": "vitest"
}
```

In root `package.json` `scripts`, add:

```json
"test:unit": "npm --workspace=@fbe/editor run test:unit"
```

- [ ] **Step 4: Write the failing test for `layersOf`**

Create `packages/editor/src/core/spriteShape.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { layersOf } from './spriteShape'

describe('layersOf', () => {
    it('returns the layers array when the value has a layers property', () => {
        const a = { filename: 'a.png' }
        const b = { filename: 'b.png' }
        const input = { layers: [a, b] }
        expect(layersOf(input as never)).toEqual([a, b])
    })

    it('wraps a bare sprite (no layers) into a single-element array', () => {
        const bare = { filename: 'c.png' }
        expect(layersOf(bare as never)).toEqual([bare])
    })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm run test:unit --workspace=@fbe/editor`
Expected: FAIL — `layersOf` is not exported / module `./spriteShape` not found.

- [ ] **Step 6: Implement `layersOf`**

Create `packages/editor/src/core/spriteShape.ts`:

```ts
import { Sprite as SpriteData } from 'factorio:prototype'
import type { SpriteVariations, Animation4Way, RotatedAnimation8Way } from 'factorio:prototype'

/**
 * Sprite-shape narrowing helpers.
 *
 * typed-factorio models several sprite types as `Base | Struct` unions. The
 * runtime data from data.json is always one concrete shape; these helpers
 * collapse the union to `SpriteData` using `in`-operator guards. No defensive
 * null-handling: malformed data still throws and is caught + logged by
 * getSpriteData's try/catch in spriteDataBuilder.ts.
 */

/** `'layers' in x ? x.layers : [x]` */
export function layersOf(
    x: SpriteVariations | SpriteData | Animation4Way | RotatedAnimation8Way
): readonly SpriteData[] {
    return 'layers' in x ? (x.layers as readonly SpriteData[]) : [x as SpriteData]
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run test:unit --workspace=@fbe/editor`
Expected: PASS (2 tests).

- [ ] **Step 8: Add the CI unit-test step**

In `.github/workflows/ci.yml`, insert before the `Type-check gate` step:

```yaml
- name: Unit tests (editor)
  if: ${{ !cancelled() }}
  run: npm run test:unit
```

- [ ] **Step 9: Commit**

```bash
git add packages/editor/vitest.config.ts packages/editor/src/core/spriteShape.ts \
  packages/editor/src/core/spriteShape.test.ts packages/editor/package.json \
  package.json package-lock.json .github/workflows/ci.yml
git commit -m "test(editor): add Vitest + layersOf sprite-shape helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018WQod3TsJZkoYZPzL6k8MS"
```

---

### Task 2: Convert `.layers` call sites via `layersOf`

Routes every `.layers`-on-union TS2339 site through `layersOf` and removes any `(e as any)` used purely to dodge that union. ~18 + the two RotatedAnimation8Way `.layers` sites.

**Files:**

- Modify: `packages/editor/src/core/spriteDataBuilder.ts`

**Interfaces:**

- Consumes: `layersOf` (Task 1).

- [ ] **Step 1: Add the import**

Near the top of `spriteDataBuilder.ts`, add (group with existing local-core imports):

```ts
import { layersOf } from './spriteShape'
```

- [ ] **Step 2: Convert the representative sites**

Examples (apply the same transform to every `.layers`-on-union site `tsc` flags):

`draw_ammo_turret` (lines ~848-849):

```ts
duplicateAndSetPropertyUsing(layersOf(e.folded_animation)[0], 'y', 'height', data.dir / 4),
duplicateAndSetPropertyUsing(layersOf(e.folded_animation)[1], 'y', 'height', data.dir / 4),
```

`draw_artillery_turret` `base_picture.layers` (line ~927):

```ts
return [...layersOf(e.base_picture), barrel, base]
```

`draw_assembling_machine` `idle_animation.layers` (line ~959):

```ts
return layersOf(e.graphics_set.idle_animation)
```

`draw_*` SpriteVariations `.layers` (line ~2114) and the RotatedAnimation8Way `.layers` (lines ~2227, ~2230): wrap each in `layersOf(...)`.

- [ ] **Step 3: Recompile to confirm only `.layers` errors cleared**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: count dropped by the number of `.layers` sites converted; no new errors introduced. Spot-check `grep "layers" ` of the tsc output is empty for converted sites.

- [ ] **Step 4: Run unit tests**

Run: `npm run test:unit`
Expected: PASS (still green — no helper change).

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/core/spriteDataBuilder.ts
git commit -m "refactor(editor): route .layers union access through layersOf

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018WQod3TsJZkoYZPzL6k8MS"
```

---

### Task 3: `sheetOf` helper + `.sheet` call sites

Delivers `sheetOf` (TDD) and converts the ~14 `.sheet` TS2339 sites plus the beacon-module `SpriteVariations -> ExtendedSpriteData` TS2345 sites that resolve to a single sprite.

**Files:**

- Modify: `packages/editor/src/core/spriteShape.ts`
- Modify: `packages/editor/src/core/spriteShape.test.ts`
- Modify: `packages/editor/src/core/spriteDataBuilder.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `sheetOf(x): SpriteData` — `'sheet' in x ? x.sheet : x`, struct member coerced `as SpriteData`.

- [ ] **Step 1: Write the failing test**

Append to `spriteShape.test.ts`:

```ts
import { sheetOf } from './spriteShape'

describe('sheetOf', () => {
    it('returns the sheet when the value is a struct with a sheet', () => {
        const sheet = { filename: 's.png', width: 1, height: 1 }
        expect(sheetOf({ sheet } as never)).toBe(sheet)
    })

    it('returns the value itself when it is a bare sheet/sprite', () => {
        const bare = { filename: 'bare.png', width: 1, height: 1 }
        expect(sheetOf(bare as never)).toBe(bare)
    })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit --workspace=@fbe/editor`
Expected: FAIL — `sheetOf` not exported.

- [ ] **Step 3: Implement `sheetOf`**

Add to `spriteShape.ts` (extend the `Sprite4Way` import):

```ts
/** `'sheet' in x ? x.sheet : x` — struct member coerced to SpriteData. */
export function sheetOf(x: SpriteVariations | Sprite4Way): SpriteData {
    // SpriteSheet/SpriteNWaySheet are structurally SpriteData at runtime.
    return 'sheet' in x ? (x.sheet as unknown as SpriteData) : (x as SpriteData)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit --workspace=@fbe/editor`
Expected: PASS.

- [ ] **Step 5: Convert the `.sheet` call sites**

Examples — apply to every `.sheet`-on-union site `tsc` flags:

`draw_locomotive` `platform_picture.sheet` (line ~1670):

```ts
duplicateAndSetPropertyUsing(sheetOf(e.platform_picture), 'x', 'width', ((data.dir + 8) % 16) / 4),
```

`draw_gate` (line ~1819, two occurrences on one line): wrap each `*.sheet` in `sheetOf(...)`.

Foundry/locomotive `SpriteVariations.sheet` / `AnimationVariations.sheet` (lines ~2043, ~2053, ~2208, ~2216) and `Sprite4Way.sheet` (line ~2311): wrap in `sheetOf(...)`.

beacon module pictures `util.duplicate(slot.pictures)` (lines ~1022, ~1029 TS2345): change `slot.pictures` to `sheetOf(slot.pictures)` so the duplicated value is `SpriteData` (resolves the `SpriteVariations -> ExtendedSpriteData` argument error). Confirm with tsc that these two specific TS2345 lines clear; the neighbouring `module.tier` (line ~1018) and `module.beacon_tint` (line ~1025) are **2b — leave them erroring.**

Add the import line for `sheetOf` (extend the existing `./spriteShape` import).

- [ ] **Step 6: Recompile + unit tests**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: count dropped by the `.sheet` sites; `tier`/`beacon_tint` still present.
Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/core/spriteShape.ts packages/editor/src/core/spriteShape.test.ts \
  packages/editor/src/core/spriteDataBuilder.ts
git commit -m "refactor(editor): add sheetOf and route .sheet union access through it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018WQod3TsJZkoYZPzL6k8MS"
```

---

### Task 4: `sheetsOf` helper + `.sheets` call sites

`sheetsOf` (TDD) and the 4 `.sheets`-on-`Sprite4Way` sites (pumpjack `base_picture.sheets[0]`, transport-belt structures).

**Files:**

- Modify: `packages/editor/src/core/spriteShape.ts`, `spriteShape.test.ts`, `spriteDataBuilder.ts`

**Interfaces:**

- Produces: `sheetsOf(x): readonly SpriteData[]` — `'sheets' in x ? x.sheets : [x]`.

- [ ] **Step 1: Failing test**

```ts
import { sheetsOf } from './spriteShape'

describe('sheetsOf', () => {
    it('returns the sheets array from a struct', () => {
        const s0 = { filename: 's0.png' }
        expect(sheetsOf({ sheets: [s0] } as never)).toEqual([s0])
    })

    it('wraps a bare sprite into a single-element array', () => {
        const bare = { filename: 'b.png' }
        expect(sheetsOf(bare as never)).toEqual([bare])
    })
})
```

- [ ] **Step 2: Run to verify it fails** — `npm run test:unit --workspace=@fbe/editor` → FAIL.

- [ ] **Step 3: Implement**

```ts
/** `'sheets' in x ? x.sheets : [x]` */
export function sheetsOf(x: Sprite4Way): readonly SpriteData[] {
    return 'sheets' in x && x.sheets
        ? (x.sheets as unknown as readonly SpriteData[])
        : [x as SpriteData]
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Convert call sites**

`draw_mining_drill` pumpjack (line ~1857):

```ts
duplicateAndSetPropertyUsing(sheetsOf(e.base_picture)[0], 'x', 'width', data.dir / 4),
```

Transport-belt `.sheets` sites (lines ~2154, ~2157): wrap in `sheetsOf(...)`. Extend the `./spriteShape` import.

- [ ] **Step 6: Recompile + unit tests** — count drops by the `.sheets` sites; `npm run test:unit` PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/core/spriteShape.ts packages/editor/src/core/spriteShape.test.ts \
  packages/editor/src/core/spriteDataBuilder.ts
git commit -m "refactor(editor): add sheetsOf and route .sheets union access through it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018WQod3TsJZkoYZPzL6k8MS"
```

---

### Task 5: `fourWayAnimation` helper + directional `.animation`/`.north` sites

`fourWayAnimation` (TDD) for the directional `Animation4Way` sites: pumpjack `graphics_set.animation.north.layers` (line ~1858) and the `Animation4Way` `.layers` sites that are actually directional (lines ~927 family if directional, ~959). Confirm per site whether the animation is directional (struct with `north`/`east`/...) or flat (`layers`) — flat ones already went through `layersOf` in Task 2; only directional ones use `fourWayAnimation`.

**Files:**

- Modify: `packages/editor/src/core/spriteShape.ts`, `spriteShape.test.ts`, `spriteDataBuilder.ts`

**Interfaces:**

- Produces: `fourWayAnimation(x, dir): readonly SpriteData[]` — directional struct → `layersOf(x[dirName(dir)])`.

- [ ] **Step 1: Failing test**

```ts
import { fourWayAnimation } from './spriteShape'

describe('fourWayAnimation', () => {
    it('returns the layers for the resolved direction', () => {
        const n0 = { filename: 'n.png' }
        const input = {
            north: { layers: [n0] },
            east: { layers: [] },
            south: { layers: [] },
            west: { layers: [] },
        }
        expect(fourWayAnimation(input as never, 0)).toEqual([n0])
    })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** (uses `util.getDirName`)

```ts
import util from '../common/util'
// ...
/** Resolve a directional Animation4Way to its layers for `dir`. */
export function fourWayAnimation(x: Animation4Way, dir: number): readonly SpriteData[] {
    const directional = x as Record<string, unknown>
    return layersOf(directional[util.getDirName(dir)] as never)
}
```

> Confirm `util.getDirName` returns the lowercase `north`/`east`/`south`/`west` keys these structs use; it is already used for this exact purpose at call sites like line ~1853.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Convert call sites**

pumpjack (line ~1858):

```ts
...fourWayAnimation(e.graphics_set.animation, 0),
```

(`north` == dir 0.) Any other directional `Animation4Way` site `tsc` still flags: route through `fourWayAnimation(anim, data.dir)`.

- [ ] **Step 6: Recompile + unit tests** — count drops; `npm run test:unit` PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/core/spriteShape.ts packages/editor/src/core/spriteShape.test.ts \
  packages/editor/src/core/spriteDataBuilder.ts
git commit -m "refactor(editor): add fourWayAnimation for directional animation access

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018WQod3TsJZkoYZPzL6k8MS"
```

---

### Task 6: `baseVisualisationLayers` helper + turret base-visualisation sites

`baseVisualisationLayers` (TDD) replacing the `(e as any)` array/object handling in `draw_electric_turret` (lines ~1335-1336), and the `base_visualisation.animation.layers` TS2339 in `draw_ammo_turret` (line ~847) and the directional `draw_fluid_turret` (line ~1376).

**Files:**

- Modify: `packages/editor/src/core/spriteShape.ts`, `spriteShape.test.ts`, `spriteDataBuilder.ts`

**Interfaces:**

- Consumes: `layersOf`, `fourWayAnimation`.
- Produces: `baseVisualisationLayers(bv, dir?): readonly SpriteData[]`.

- [ ] **Step 1: Failing test**

```ts
import { baseVisualisationLayers } from './spriteShape'

describe('baseVisualisationLayers', () => {
    const layer = { filename: 'base.png' }

    it('handles the object form (non-directional animation)', () => {
        expect(baseVisualisationLayers({ animation: { layers: [layer] } } as never)).toEqual([
            layer,
        ])
    })

    it('handles the array form by taking the first element', () => {
        expect(baseVisualisationLayers([{ animation: { layers: [layer] } }] as never)).toEqual([
            layer,
        ])
    })

    it('handles the directional form when dir is provided', () => {
        const bv = {
            animation: {
                north: { layers: [layer] },
                east: { layers: [] },
                south: { layers: [] },
                west: { layers: [] },
            },
        }
        expect(baseVisualisationLayers(bv as never, 0)).toEqual([layer])
    })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
import type { TurretBaseVisualisation } from 'factorio:prototype'
// ...
/**
 * Resolve a turret base_visualisation (array or object form) to its animation
 * layers. Pass `dir` for the directional (fluid-turret) animation form.
 */
export function baseVisualisationLayers(
    bv: TurretBaseVisualisation | readonly TurretBaseVisualisation[],
    dir?: number
): readonly SpriteData[] {
    const base = Array.isArray(bv) ? bv[0] : bv
    const anim = (base as TurretBaseVisualisation).animation
    return dir === undefined ? layersOf(anim as never) : fourWayAnimation(anim as never, dir)
}
```

> Confirm the real exported name for the base-visualisation element type and `animation` member against the installed typed-factorio `.d.ts`; adjust the import/cast if it differs.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Convert call sites**

`draw_ammo_turret` (line ~847):

```ts
...baseVisualisationLayers(e.graphics_set.base_visualisation),
```

`draw_electric_turret` (lines ~1335-1336) — remove the `(e as any)` + `Array.isArray` dance:

```ts
const baseLayers = baseVisualisationLayers(e.graphics_set.base_visualisation)
return [
    ...baseLayers,
    duplicateAndSetPropertyUsing(layersOf(e.folded_animation)[0], 'y', 'height', data.dir / 4),
    duplicateAndSetPropertyUsing(layersOf(e.folded_animation)[2], 'y', 'height', data.dir / 4),
]
```

`draw_fluid_turret` (line ~1376):

```ts
...baseVisualisationLayers(e.graphics_set.base_visualisation, data.dir),
```

> Leave `draw_railgun_turret` (lines ~855-856) as-is — it uses `(e as any)` with optional chaining and is **not** in the 49-error set; converting it is out of scope.

- [ ] **Step 6: Recompile + unit tests** — count drops; `npm run test:unit` PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/core/spriteShape.ts packages/editor/src/core/spriteShape.test.ts \
  packages/editor/src/core/spriteDataBuilder.ts
git commit -m "refactor(editor): add baseVisualisationLayers for turret base visualisation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018WQod3TsJZkoYZPzL6k8MS"
```

---

### Task 7: `toSpriteArray` helper + return/arg-type sites

`toSpriteArray` (TDD) for the TS2322 `draw_*` return-type mismatches and TS2345 arg-type mismatches where a `SpriteVariations`-typed value flows into a `readonly Sprite[]` / `Sprite[]` position — the rail `getBaseSprites` (lines ~1701, ~1711, ~1713) and the `util.getRandomItem(...)` args at lines ~1533, ~1535.

**Files:**

- Modify: `packages/editor/src/core/spriteShape.ts`, `spriteShape.test.ts`, `spriteDataBuilder.ts`

**Interfaces:**

- Produces: `toSpriteArray(x): readonly SpriteData[]`.

- [ ] **Step 1: Failing test**

```ts
import { toSpriteArray } from './spriteShape'

describe('toSpriteArray', () => {
    it('returns an array unchanged', () => {
        const arr = [{ filename: 'a.png' }, { filename: 'b.png' }]
        expect(toSpriteArray(arr as never)).toEqual(arr)
    })

    it('wraps a single sprite into an array', () => {
        const one = { filename: 'a.png' }
        expect(toSpriteArray(one as never)).toEqual([one])
    })

    it('returns the sheet struct member wrapped in an array', () => {
        const sheet = { filename: 's.png' }
        expect(toSpriteArray({ sheet } as never)).toEqual([sheet])
    })
})
```

> Pin the branches to exactly the runtime shapes the rail/getRandomItem sites produce — do not add a `.sheet` branch unless a real site needs it (Global Constraint: no speculative branches). Trim the third test if no site exercises the struct form.

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** (start minimal; add branches only as sites demand)

```ts
/** Coerce a SpriteVariations value to a SpriteData[] for return/arg positions. */
export function toSpriteArray(x: SpriteVariations): readonly SpriteData[] {
    if (Array.isArray(x)) return x as readonly SpriteData[]
    if ('sheet' in x) return [(x as { sheet: unknown }).sheet as SpriteData]
    return [x as SpriteData]
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Convert call sites**

`draw_straight_rail` `getBaseSprites` (lines ~1713-1719): change the return type to `SpriteData[]` and map each entry through the right helper so the function returns `readonly SpriteData[]`. Each `ps.*` is a `SpriteVariations`; flatten:

```ts
function getBaseSprites(): readonly SpriteData[] {
    let ps = e.pictures[util.getDirName8Way(dir)]
    if (Object.entries(ps).length === 0) {
        ps = e.pictures[util.getDirName8Way(dir % 8)]
    }
    return [
        ...toSpriteArray(ps.stone_path_background),
        ...toSpriteArray(ps.stone_path),
        ...toSpriteArray(ps.ties),
        ...toSpriteArray(ps.backplates),
        ...toSpriteArray(ps.metals),
    ]
}
```

> Verify against the existing `draw_rail` runtime behavior (line ~1707 returns the bare `ps.*` values as elements). If each `ps.*` is a single sprite (not variations), `toSpriteArray` yields a one-element array per entry and the flattened result matches the original 5-element list — confirm with the render check in Task 8. If they are genuinely single sprites, a narrower `sheetOf`/`as SpriteData` per entry may read better; choose whichever keeps the rendered output identical.

`util.getRandomItem(getOpt())` / `getRandomItem(e.connection_sprites.single)` (lines ~1533, ~1535): wrap the `SpriteVariations` arg so it matches `getRandomItem`'s `Sprite[]` parameter — `util.getRandomItem(toSpriteArray(getOpt()))`. Confirm `getRandomItem`'s signature in `../common/util` and that wrapping preserves the prior random-pick behavior.

The `draw_*` return-type TS2322 errors (lines ~1003, ~1345, ~1701, ~1711) clear once their inner arrays are `SpriteData[]`.

- [ ] **Step 6: Recompile + unit tests** — count drops; `npm run test:unit` PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/core/spriteShape.ts packages/editor/src/core/spriteShape.test.ts \
  packages/editor/src/core/spriteDataBuilder.ts
git commit -m "refactor(editor): add toSpriteArray for return/arg-type sprite coercion

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018WQod3TsJZkoYZPzL6k8MS"
```

---

### Task 8: Ratchet the gate, verify rendering, open the PR

Measure the final error count, lock it into the gate, run the full local CI surface, render-check the touched entities, and open the PR.

**Files:**

- Modify: `scripts/type-check-baseline.json`

- [ ] **Step 1: Measure remaining errors**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: ~10. Confirm the remainder is exactly the 2b set — `'size'` (×5), `tier`, `beacon_tint`, `horizontal_rail_base`, `vertical_rail_base`, `line_length`:
Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep "error TS"`
Expected: every line matches a 2b item. **If any non-2b error remains, it is an unconverted 2a site — go back and convert it before ratcheting.** If a site turned out to need augmentation, leave it and note it for 2b (the measured number absorbs it).

- [ ] **Step 2: Set the baseline to the measured number**

Edit `scripts/type-check-baseline.json` — set `"maxErrors"` to the exact count from Step 1:

```json
{
    "project": "packages/editor/tsconfig.json",
    "maxErrors": 10
}
```

- [ ] **Step 3: Run the gate and the full check surface**

```bash
npm run type-check:gate
npm run test:unit
npm run test:scripts
npm run lint
npm run format
```

Expected: gate PASSES at the new ceiling; unit + script tests green; eslint clean; prettier reports no formatting issues. If prettier flags files, run `npm run format:fix` and re-stage (avoids the Batch 1 CI prettier miss).

- [ ] **Step 4: Render check in the dev editor**

Start both dev servers (see CLAUDE.md): `cd packages/website && npm run start` and `npx serve packages/exporter/data/output -l 8081 --cors`. Load a blueprint exercising the touched `draw_*` functions and confirm sprites render unchanged:

- rails (straight + elevated), walls, beacon, ammo turret, electric turret, fluid turret, transport belt, pumpjack, locomotive.

Use a known Space Age blueprint from `wormeyman-tests/` or factorio.school. Confirm no new console errors and no `SPRITE_GENERATION_FAILED` placeholders for these entities.

- [ ] **Step 5: Commit the ratchet**

```bash
git add scripts/type-check-baseline.json
git commit -m "chore(editor): lower type-check baseline 59 -> 10 after Batch 2a

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018WQod3TsJZkoYZPzL6k8MS"
```

- [ ] **Step 6: Push and open the PR against the fork**

```bash
git push -u origin fix/editor-type-errors-batch-2a
gh pr create --base wormeyman-space-age-support \
  --title "fix(editor): Batch 2a — narrow sprite-shape unions in spriteDataBuilder" \
  --body "$(cat <<'EOF'
## Summary
Batch 2a of the editor type-error cleanup. Introduces `packages/editor/src/core/spriteShape.ts`, a unit-tested module of pure narrowing helpers that collapse typed-factorio `Base | Struct` sprite unions to `SpriteData`. Call sites in `spriteDataBuilder.ts` now route union access through these helpers instead of reading struct-only members off the union. Lowers the type-check gate baseline 59 -> 10 with no runtime behavior change.

Helpers: `layersOf`, `sheetOf`, `sheetsOf`, `fourWayAnimation`, `baseVisualisationLayers`, `toSpriteArray`. Adds Vitest to `packages/editor` as the editor's unit-test home (new CI step before the gate).

Remaining 10 errors are the Batch 2b judgment calls (the `'size'` key + 5 genuine typed-factorio gaps).

## Verification
- `npm run test:unit` green (every helper branch covered)
- type-check gate passes at maxErrors 10; remaining errors are all 2b items
- prettier + eslint clean
- render check: rails, walls, beacon, ammo/electric/fluid turret, transport belt, pumpjack, locomotive render unchanged in the dev editor

Design spec: `docs/superpowers/specs/2026-06-27-batch-2a-sprite-shape-narrowing-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Verification (PR done-criteria summary)

1. `npm run test:unit` green — every helper branch covered.
2. `npx tsc --noEmit -p packages/editor/tsconfig.json` error count is the measured 2a remainder (expected 10); `scripts/type-check-baseline.json` `maxErrors` set to exactly that; `npm run type-check:gate` passes.
3. Render check: rails, walls, beacon, ammo/electric/fluid turret, transport belt, pumpjack, locomotive render unchanged in the dev editor; no new `SPRITE_GENERATION_FAILED`.
4. `npm run format` and `npm run lint` clean before pushing.

## Out of scope (Batch 2b)

- The 5 `'size'` argument errors → augment `ExtendedSpriteData` with `size`.
- Genuine typed-factorio gaps: `beacon_tint`, `tier`, `horizontal_rail_base`, `vertical_rail_base`, `line_length`.
- Any unrelated `(e as any)` cleanup not required to fix a 2a error (e.g. `draw_railgun_turret`).
