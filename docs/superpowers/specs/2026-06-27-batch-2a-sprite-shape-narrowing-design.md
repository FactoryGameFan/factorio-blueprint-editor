# Batch 2a: Sprite-shape narrowing in spriteDataBuilder.ts

Date: 2026-06-27
Status: Approved (design)
Branch base: `wormeyman-space-age-support`

> **Historical note, added 2026-09-02.** The type-check gate described below no
> longer exists. #268 removed `scripts/type-check-gate.mjs`, its baseline and the
> CI step, after `strict: true` landed under #77 and brought the baseline back to
> zero. Everything below records the state at the time of writing and is left as
> written. The strict-ratchet technique itself is kept, in
> `.github/workflows/README.md`.

## Context

The editor enforces a TypeScript error budget via a CI gate
(`scripts/type-check-baseline.json`, runner `scripts/type-check-gate.mjs`). The
gate fails only when the error count exceeds the committed `maxErrors`. As
errors are fixed, `maxErrors` is ratcheted down to lock the gain.

Batch 1 (merged, PR #7) lowered the baseline 87 -> 59 by narrowing entity
prototypes to their typed-factorio subtypes via `in`-operator and `isX` type
guards instead of `as any` casts. All 59 remaining errors live in one file:
`packages/editor/src/core/spriteDataBuilder.ts` (2452 lines).

Those 59 split into two kinds of problem. Batch 2 was scoped (with the user)
into two PRs:

- **2a (this spec):** the 49 "mechanical" errors - sprite-data-structure
  union access and `draw_*` return/argument-type mismatches. These are
  genuinely narrowable from typed-factorio's existing types; no augmentation
  needed.
- **2b (separate spec, later):** the 10 judgment-call errors - the `'size'`
  key (5, needs `ExtendedSpriteData` augmentation) and genuine typed-factorio
  gaps (5: `beacon_tint`, `tier`, `horizontal_rail_base`,
  `vertical_rail_base`, `line_length`).

The intended outcome of 2a: baseline 59 -> 10, no runtime behavior change, and
a reusable unit-test home for the editor package.

## Problem detail

typed-factorio models several sprite types as `Base | Struct` unions, e.g.:

- `Sprite4Way = Sprite4WayStruct | Sprite` where the struct has optional
  `sheets`, `sheet`, `north`/`east`/`south`/`west`.
- `SpriteVariations = SpriteVariationsStruct | SpriteSheet | readonly Sprite[]`
  (the struct has `sheet`).
- `Animation4Way = Animation4WayStruct | Animation`.
- `RotatedAnimation8Way = RotatedAnimation8WayStruct | RotatedAnimation`.
- `AnimationVariations = AnimationVariationsStruct | Animation | readonly Animation[]`.
- Base `Sprite` itself has `layers?: readonly Sprite[]`.

The code reads struct-only members (`.layers`, `.sheet`, `.sheets`,
`.animation`, `.north`) directly off the whole union, producing TS2339. Related
TS2322/TS2345 errors occur where a value typed `SpriteVariations` flows into a
`readonly Sprite[]` / `Sprite` / `ExtendedSpriteData` position.

Error breakdown (the 2a subset, 49 of 59):

- TS2339 (40): `.layers` (18), `.sheet` (14), `.sheets` (4), `.animation` (3),
  `.north` (1) on the union types above.
- TS2322 (4): `draw_*` functions returning `SpriteVariations[]` /
  union arrays where `readonly Sprite[]` is expected.
- TS2345 (5): `SpriteVariations` passed where `Sprite[]` / `Sprite` /
  `ExtendedSpriteData` is expected.

(The 5 `'size'` TS2345 errors and the 5 genuine-gap TS2339 errors are 2b.)

## Approach (chosen: A - encapsulated coercion helpers)

Add a small module of pure narrowing functions. Each takes a typed-factorio
union and returns the concrete runtime shape, using `in`-operator guards
internally. Call sites in `spriteDataBuilder.ts` replace direct union-member
access with a helper call. Branching logic lives in one tested place; call
sites get shorter; no unsafe casts.

Alternatives rejected:

- **B - predicate guards only** (`hasLayers(x): x is ...`, branch at each call
  site): scatters identical `if/else` shape logic across ~48 sites and bloats
  the `draw_*` functions.
- **C - one broad structural coercer** casting through `unknown`: fewest lines
  but reintroduces unsafe casts, contradicting the Batch 1 principle.

## Design

### New module: `packages/editor/src/core/spriteShape.ts`

Pure functions, no PixiJS or FD dependency. Approximate set (final signatures
pinned during TDD - some may merge):

| Helper                    | Signature (approx)                                                                         | Covers                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `layersOf`                | `(x: SpriteVariations \| Sprite \| Animation4Way \| RotatedAnimation8Way) => SpriteData[]` | the 18 `.layers` sites; `'layers' in x ? x.layers : [x]`                                                                         |
| `sheetOf`                 | `(x: SpriteVariations \| Sprite4Way) => SpriteData`                                        | the ~14 `.sheet` sites; `'sheet' in x ? x.sheet : x`                                                                             |
| `sheetsOf`                | `(x: Sprite4Way) => SpriteData[]`                                                          | the 4 `.sheets` sites                                                                                                            |
| `baseVisualisationLayers` | `(bv: TurretBaseVisualisation \| readonly TurretBaseVisualisation[]) => SpriteData[]`      | turret `base_visualisation.animation.layers`, array or object form; replaces the existing `(e as any)` in `draw_electric_turret` |
| `fourWayAnimation`        | `(x: Animation4Way, dir: number) => SpriteData[]`                                          | the `.north`/directional `.animation` sites (pumpjack)                                                                           |
| `toSpriteArray`           | `(x: SpriteVariations) => SpriteData[]`                                                    | the TS2322 return-type and TS2345 arg-type sites (e.g. `draw_straight_rail`'s `getBaseSprites`)                                  |

Helpers operate on `SpriteData`/`ExtendedSpriteData` as already used in
`spriteDataBuilder.ts`. Note `SpriteData` is the file's alias for
typed-factorio's `Sprite` (`import { Sprite as SpriteData } from 'factorio:prototype'`,
`spriteDataBuilder.ts:24`); the new module imports it the same way.
`spriteShape.ts` lives in `core/`, so its util import is `../common/util`.

#### Helper implementation principles

These were settled against an external spec review; they constrain the
implementation:

- **No defensive null-handling.** Helpers take the typed-factorio field types
  as-is (mostly non-optional) and do **not** accept `undefined | null` or
  swallow it into `[]`. This preserves current behavior: a malformed-data
  access still throws and is caught + logged by the existing `getSpriteData`
  try/catch (`spriteDataBuilder.ts:149-160`), which returns
  `SPRITE_GENERATION_FAILED` and skips the entity with a diagnostic. Silent
  empty returns would hide that. Call sites that are already optional (e.g.
  `draw_turret`'s `e.folded_animation?.layers?.[0]`) keep handling optionality
  locally.
- **`sheetOf` returns `SpriteData`, never `SpriteData | undefined`.** Its
  results feed straight into `duplicateAndSetPropertyUsing(...)`, which requires
  non-undefined `SpriteData`; an optional return would create new type errors
  or force `!` at ~14 sites.
- **No speculative recursion / branches.** Add a union branch to a helper only
  when a real failing call site needs it (TDD-driven). Do not pre-handle shapes
  no site exercises (e.g. `layersOf` recursing through `.sheet`).
- **Coerce with the narrowest cast, not `as any`.** Where a struct member
  (`SpriteSheet`, `SpriteNWaySheet`) must become `SpriteData`, use
  `as SpriteData` (or `as unknown as SpriteData`) with a short comment. Blanket
  `as any` is the exact thing this cleanup removes.

### Call-site changes in `spriteDataBuilder.ts`

Replace direct union-member access with the helper:

- `e.platform_picture.sheet` -> `sheetOf(e.platform_picture)`
- `x.layers` -> `layersOf(x)`
- `e.base_picture.sheets[0]` -> `sheetsOf(e.base_picture)[0]`
- `structure.direction_in.sheet` -> `sheetOf(structure.direction_in)`
- `draw_electric_turret`'s `(e as any).graphics_set.base_visualisation` array
  handling -> `baseVisualisationLayers(e.graphics_set.base_visualisation)`
- `draw_straight_rail`'s `getBaseSprites(): SpriteVariations[]` -> map each
  element through `toSpriteArray`/`sheetOf` so it returns `SpriteData[]`

`draw_*` signatures stay `(data: IDrawData) => readonly SpriteData[]`. Where a
site currently uses `(e as any)` purely to dodge one of these unions, route it
through the typed helper and remove the cast. Do **not** remove `(e as any)`
casts that dodge unrelated issues (those are out of scope).

### Scope boundary (mechanical vs gap)

2a introduces **no** typed-factorio augmentation. If a site that looks
mechanical turns out to require a genuinely-absent field, defer it to 2b and
leave it as a remaining gate error rather than augmenting here. The 2a target
is 10 (the 2b errors), not a hard zero - the exact final count is whatever
remains after the mechanical sites are fixed, and `maxErrors` is set to that
measured number.

### Testing: Vitest in `packages/editor`

The editor package has no unit-test runner today (only Playwright e2e and the
gate's `scripts/**/*.test.mjs` via `node --test`). Add Vitest (Vite-native; the
project already uses Vite 8):

- `vitest` devDependency in `packages/editor/package.json` (latest stable at
  implementation time - 3.x line; pin per repo preference for current versions).
- Scripts in `packages/editor/package.json`: `"test:unit": "vitest run"`,
  `"test:unit:watch": "vitest"`. Add a root convenience script to
  `package.json`: `"test:unit": "npm --workspace=@fbe/editor run test:unit"`.
- `packages/editor/vitest.config.ts`:

    ```ts
    import { defineConfig } from 'vitest/config'

    export default defineConfig({
        test: {
            environment: 'node',
            include: ['src/**/*.test.ts'],
        },
    })
    ```

- `packages/editor/src/core/spriteShape.test.ts`: for each helper, cover every
  union branch with small inline fixtures - e.g. `layersOf` gets a
  `{ layers: [...] }` input, a bare `Sprite`, and a variations/array input;
  `sheetOf` gets a `{ sheet: {...} }` struct and a bare sheet;
  `baseVisualisationLayers` gets both array and object forms;
  `fourWayAnimation` gets a directional struct. Assert the returned shape. No
  real sprite/`.basis` files needed. (Per TDD, tests are written before each
  helper.)
- Add a unit-test step to `.github/workflows/ci.yml` in the `checks` job,
  before the type-check gate, so broken transforms fail CI:

    ```yaml
    - name: Unit tests (editor)
      if: ${{ !cancelled() }}
      run: npm run test:unit
    ```

    This becomes the editor's unit-test home, reused by 2b.

## Verification (PR done-criteria)

1. `npm run test:unit` green - every helper branch covered.
2. Type-gate: `npx tsc --noEmit -p packages/editor/tsconfig.json` error count
   drops to the measured 2a number (expected 10). Set `maxErrors` in
   `scripts/type-check-baseline.json` to exactly that number.
3. Render check: load a blueprint exercising the touched `draw_*` functions
   (rails, walls, beacon, ammo turret, electric turret, transport belt,
   pumpjack, locomotive) in the dev editor; confirm sprites still render
   unchanged.
4. `npm run format` (prettier) and `npm run lint` (eslint) clean before pushing
    - avoids the Batch 1 CI prettier miss.

## Out of scope (deferred to Batch 2b)

- The 5 `'size'` argument errors -> augment `ExtendedSpriteData` with `size`.
- Genuine typed-factorio gaps: `beacon_tint`, `tier`, `horizontal_rail_base`,
  `vertical_rail_base`, `line_length`.
- Any unrelated `(e as any)` cleanup not required to fix a 2a error.
