# Editor Type-Errors Cleanup - Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 28 TypeScript errors across 7 smaller editor files (and the 2 Vite `?url` import errors) by narrowing `EntityWithOwnerPrototype` via type guards, dropping the editor type-check baseline from 87 to 59.

**Architecture:** `FD.entities` is typed `Record<string, EntityWithOwnerPrototype>` (the base prototype), but call sites read subtype-only fields (e.g. `roboport.construction_radius`, `underground-belt.max_distance`). typed-factorio already defines those subtypes. We extend the existing `isInserter`/`isCraftingMachine`/`isTrainStop` type-guard pattern in `factorioData.ts` with new guards, then narrow at each call site. Two non-entity errors are fixed locally: a `*?url` ambient module declaration (Editor.ts) and widening `objectHasOwnProperty`'s parameter to `unknown` (History.ts). No `typed-factorio` augmentation is needed in this batch - every field already exists on a subtype.

**Tech Stack:** TypeScript, typed-factorio (`factorio:prototype`), PixiJS. Verification via `npx tsc --noEmit -p packages/editor/tsconfig.json` and the CI gate `npm run type-check:gate`.

## Global Constraints

- Verification command for error counts: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"` (run from repo root `/Users/ericjohnson/GitHub/factorio-blueprint-editor`).
- The CI gate compares the count to `scripts/type-check-baseline.json` `maxErrors`. Only the FINAL task lowers `maxErrors` (to 59). Intermediate tasks must never raise the count.
- Approach is NARROW-via-type-guards. Do NOT add `as any`/`as <Subtype>` casts to fix entity-field access; add/extend a type guard instead. The only permitted non-guard edits are the two explicitly specified: the `*?url` ambient declaration and the `objectHasOwnProperty` parameter widening.
- Preserve runtime behavior exactly. Where a guard is logically equivalent to an existing `name ===`/`type ===` check, keep the original condition and add the guard with `&&` (belt-and-suspenders) rather than replacing it, EXCEPT where a step explicitly says to replace.
- Use hyphens (`-`), never em/en dashes, in any prose or comments.
- Commit after each task with the exact message given. Co-author trailers are added by the commit tooling; do not hand-add them.

## Type-Guard Reference (discriminants verified against typed-factorio 2.0.75)

| Guard | Narrows to | `e.type` discriminant |
| --- | --- | --- |
| `isMiningDrill` | `MiningDrillPrototype` | `"mining-drill"` |
| `isBeacon` | `BeaconPrototype` | `"beacon"` |
| `isRoboport` | `RoboportPrototype` | `"roboport"` |
| `isElectricPole` | `ElectricPolePrototype` | `"electric-pole"` |
| `isUndergroundBelt` | `UndergroundBeltPrototype` | `"underground-belt"` |
| `isLoader` | `LoaderPrototype` | `"loader"` \| `"loader-1x1"` |
| `isLogisticContainer` | `LogisticContainerPrototype` | `"logistic-container"` \| `"infinity-container"` |
| `isTransportBeltConnectable` | `TransportBeltConnectablePrototype` | belt/underground-belt/splitter/loader/loader-1x1/linked-belt/lane-splitter |

Already present in `factorioData.ts`: `isInserter` (`InserterPrototype`), `isCraftingMachine` (`assembling-machine`/`furnace`/`rocket-silo`), `isTrainStop`.

---

### Task 1: Vite `*?url` ambient module declaration

**Files:**
- Modify: `packages/editor/src/global.d.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: ambient `declare module '*?url'` so `import x from './foo.js?url'` resolves to `string`.

Fixes `Editor.ts(11,31)` and `Editor.ts(12,33)` TS2307 (`./basis/transcoder.1.16.4.js?url`, `.wasm?url`).

- [ ] **Step 1: Confirm the two failing errors exist**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep "TS2307"`
Expected: two lines referencing `Editor.ts` and `?url`.

- [ ] **Step 2: Add the ambient declaration**

Append to `packages/editor/src/global.d.ts`:

```typescript
// Vite resolves `?url` imports to a string URL at build/dev time.
// See https://vite.dev/guide/assets#explicit-url-imports
declare module '*?url' {
    const src: string
    export default src
}
```

- [ ] **Step 3: Verify the count dropped to 85**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `85`

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/global.d.ts
git commit -m "fix(editor): declare Vite *?url module type to resolve transcoder imports"
```

---

### Task 2: Add entity type guards to factorioData.ts

**Files:**
- Modify: `packages/editor/src/core/factorioData.ts` (import block lines 17-68; guards after the existing `isTrainStop` at ~line 133)

**Interfaces:**
- Consumes: `EntityWithOwnerPrototype` and the subtype prototypes from `factorio:prototype`.
- Produces (all exported from `./factorioData`):
  - `isMiningDrill(e: EntityWithOwnerPrototype): e is MiningDrillPrototype`
  - `isBeacon(e: EntityWithOwnerPrototype): e is BeaconPrototype`
  - `isRoboport(e: EntityWithOwnerPrototype): e is RoboportPrototype`
  - `isElectricPole(e: EntityWithOwnerPrototype): e is ElectricPolePrototype`
  - `isUndergroundBelt(e: EntityWithOwnerPrototype): e is UndergroundBeltPrototype`
  - `isLoader(e: EntityWithOwnerPrototype): e is LoaderPrototype`
  - `isLogisticContainer(e: EntityWithOwnerPrototype): e is LogisticContainerPrototype`
  - `isTransportBeltConnectable(e: EntityWithOwnerPrototype): e is TransportBeltConnectablePrototype`

`MiningDrillPrototype`, `BeaconPrototype`, `RoboportPrototype`, `ElectricPolePrototype`, `LoaderPrototype` are already imported. `UndergroundBeltPrototype`, `LogisticContainerPrototype`, `TransportBeltConnectablePrototype` are NOT - add them.

- [ ] **Step 1: Add the three missing prototype imports**

In the `from 'factorio:prototype'` import block (the one ending at line 69, starting `import {` at line 3), add these three names alongside the existing prototype imports (e.g. right after `TransportBeltPrototype,` on line 65):

```typescript
    TransportBeltConnectablePrototype,
    UndergroundBeltPrototype,
    LogisticContainerPrototype,
```

- [ ] **Step 2: Add the eight guards after `isTrainStop`**

Insert immediately after the closing brace of `isTrainStop` (currently line 133):

```typescript
export function isMiningDrill(e: EntityWithOwnerPrototype): e is MiningDrillPrototype {
    const type: MiningDrillPrototype['type'] = 'mining-drill'
    return e.type === type
}
export function isBeacon(e: EntityWithOwnerPrototype): e is BeaconPrototype {
    const type: BeaconPrototype['type'] = 'beacon'
    return e.type === type
}
export function isRoboport(e: EntityWithOwnerPrototype): e is RoboportPrototype {
    const type: RoboportPrototype['type'] = 'roboport'
    return e.type === type
}
export function isElectricPole(e: EntityWithOwnerPrototype): e is ElectricPolePrototype {
    const type: ElectricPolePrototype['type'] = 'electric-pole'
    return e.type === type
}
export function isUndergroundBelt(e: EntityWithOwnerPrototype): e is UndergroundBeltPrototype {
    const type: UndergroundBeltPrototype['type'] = 'underground-belt'
    return e.type === type
}
export function isLoader(e: EntityWithOwnerPrototype): e is LoaderPrototype {
    return e.type === 'loader' || e.type === 'loader-1x1'
}
export function isLogisticContainer(e: EntityWithOwnerPrototype): e is LogisticContainerPrototype {
    return e.type === 'logistic-container' || e.type === 'infinity-container'
}
export function isTransportBeltConnectable(
    e: EntityWithOwnerPrototype
): e is TransportBeltConnectablePrototype {
    switch (e.type) {
        case 'transport-belt':
        case 'underground-belt':
        case 'splitter':
        case 'loader':
        case 'loader-1x1':
        case 'linked-belt':
        case 'lane-splitter':
            return true
        default:
            return false
    }
}
```

- [ ] **Step 3: Verify the count is still 85 (no new errors, guards are unused-but-exported so no TS6133)**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `85`

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/core/factorioData.ts
git commit -m "feat(editor): add entity subtype guards (drill/beacon/roboport/pole/underground/loader/logistic/belt)"
```

---

### Task 3: UnderlayContainer.ts visualization radii

**Files:**
- Modify: `packages/editor/src/containers/UnderlayContainer.ts` (import line 2; `getDataForVisualizationArea` lines 34-89)

**Interfaces:**
- Consumes: `isRoboport`, `isElectricPole`, `isBeacon`, `isMiningDrill` from `../core/factorioData`.

Fixes 5 errors: `construction_radius` (41), `logistics_radius` (47), `supply_area_distance` (61, 71), `resource_searching_radius` (81).

- [ ] **Step 1: Extend the factorioData import**

Change line 2 from:

```typescript
import FD, { getEnergySource, hasModuleFunctionality } from '../core/factorioData'
```

to:

```typescript
import FD, {
    getEnergySource,
    hasModuleFunctionality,
    isRoboport,
    isElectricPole,
    isBeacon,
    isMiningDrill,
} from '../core/factorioData'
```

- [ ] **Step 2: Guard each branch**

In `getDataForVisualizationArea` (`const ed = FD.entities[name]`), make these four edits. Keep the original `name ===` checks and add the guard with `&&` so behavior is unchanged.

Line 37 - change `if (name === 'roboport') {` to:

```typescript
        if (name === 'roboport' && isRoboport(ed)) {
```

Line 57 - change `if (ed.type === 'electric-pole') {` to:

```typescript
        if (isElectricPole(ed)) {
```

Line 67 - change `if (name === 'beacon') {` to:

```typescript
        if (name === 'beacon' && isBeacon(ed)) {
```

Line 77 - change `if (name === 'electric-mining-drill') {` to:

```typescript
        if (name === 'electric-mining-drill' && isMiningDrill(ed)) {
```

The property reads inside each block (`ed.construction_radius`, `ed.logistics_radius`, `ed.supply_area_distance`, `ed.resource_searching_radius`) now narrow correctly and need no further change.

- [ ] **Step 3: Verify the count dropped to 80**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `80`

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/containers/UnderlayContainer.ts
git commit -m "fix(editor): narrow entity prototypes in UnderlayContainer visualization radii"
```

---

### Task 4: OverlayContainer.ts and PaintEntityContainer.ts (underground-belt + mining-drill)

**Files:**
- Modify: `packages/editor/src/containers/OverlayContainer.ts` (import lines 3-9; lines 285-291, 440-478)
- Modify: `packages/editor/src/containers/PaintEntityContainer.ts` (import line 3; lines 85-94)

**Interfaces:**
- Consumes: `isMiningDrill`, `isUndergroundBelt` from `../core/factorioData`.

Fixes 5 errors: OverlayContainer `vector_to_place_result` (289, 290), `max_distance` (447), `underground_sprite` (478); PaintEntityContainer `max_distance` (94).

- [ ] **Step 1: Extend OverlayContainer's factorioData import**

Add `isMiningDrill,` and `isUndergroundBelt,` to the named imports in the `import FD, { ... } from '../core/factorioData'` block (lines 3-9), e.g. after `isCraftingMachine,`:

```typescript
    isMiningDrill,
    isUndergroundBelt,
```

- [ ] **Step 2: Narrow the mining-drill arrow block (OverlayContainer 285-296)**

Replace:

```typescript
        if (entity.type === 'mining-drill' && entity.name !== 'pumpjack') {
            const arrows = new Container()
            arrows.addChild(
                createArrow({
                    x: entity.entityData.vector_to_place_result[0] * 64,
                    y: entity.entityData.vector_to_place_result[1] * 64 + 18,
                })
            )
```

with:

```typescript
        const drillData = entity.entityData
        if (entity.type === 'mining-drill' && entity.name !== 'pumpjack' && isMiningDrill(drillData)) {
            const arrows = new Container()
            arrows.addChild(
                createArrow({
                    x: drillData.vector_to_place_result[0] * 64,
                    y: drillData.vector_to_place_result[1] * 64 + 18,
                })
            )
```

- [ ] **Step 3: Narrow `max_distance` (OverlayContainer 447)**

Inside the `if (fd.type === 'underground-belt' || fd.type === 'pipe-to-ground')` block, replace the argument `fd.max_distance || 10` (line 447) with:

```typescript
                    (isUndergroundBelt(fd) ? fd.max_distance : undefined) || 10
```

(For `pipe-to-ground`, `isUndergroundBelt(fd)` is false, yielding `undefined || 10 === 10` - identical to the original runtime value since `pipe-to-ground` has no `max_distance`.)

- [ ] **Step 4: Narrow `underground_sprite` (OverlayContainer 475-478)**

Replace:

```typescript
                    const data =
                        fd.type === 'pipe-to-ground'
                            ? FD.utilitySprites.underground_pipe_connection
                            : fd.underground_sprite
```

with:

```typescript
                    const data = isUndergroundBelt(fd)
                        ? fd.underground_sprite
                        : FD.utilitySprites.underground_pipe_connection
```

(`fd` is `underground-belt | pipe-to-ground` here; `isUndergroundBelt` true selects `underground_sprite`, otherwise the pipe-to-ground sprite - identical behavior.)

- [ ] **Step 5: Extend PaintEntityContainer's factorioData import**

Change line 3 from:

```typescript
import FD, { getEntitySize, getPossibleRotations } from '../core/factorioData'
```

to:

```typescript
import FD, { getEntitySize, getPossibleRotations, isUndergroundBelt } from '../core/factorioData'
```

- [ ] **Step 6: Narrow `max_distance` (PaintEntityContainer 85)**

Change line 85 from `if (fd.type === 'underground-belt') {` to:

```typescript
        if (isUndergroundBelt(fd)) {
```

The `fd.max_distance` read on line 94 now narrows. (`isUndergroundBelt(fd)` is equivalent to `fd.type === 'underground-belt'`.)

- [ ] **Step 7: Verify the count dropped to 75**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `75`

- [ ] **Step 8: Commit**

```bash
git add packages/editor/src/containers/OverlayContainer.ts packages/editor/src/containers/PaintEntityContainer.ts
git commit -m "fix(editor): narrow underground-belt/mining-drill prototypes in overlay/paint containers"
```

---

### Task 5: Entity.ts filter slots and underground-belt max_distance

**Files:**
- Modify: `packages/editor/src/core/Entity.ts` (import block lines 16-30; `filterSlots` getter lines 372-386; `rotate` lines 857-867)

**Interfaces:**
- Consumes: `isInserter` (already imported), `isLoader`, `isMiningDrill`, `isLogisticContainer`, `isRoboport`, `isUndergroundBelt` from `./factorioData`.

Fixes 5 errors: `filter_count` (375 x2), `max_logistic_slots` (376, 377), `max_distance` (865).

- [ ] **Step 1: Extend the factorioData import**

In the `import FD, { ... } from './factorioData'` block (lines 16-30), add:

```typescript
    isLoader,
    isMiningDrill,
    isLogisticContainer,
    isRoboport,
    isUndergroundBelt,
```

(`isInserter` is already imported - do not duplicate it.)

- [ ] **Step 2: Narrow the `filterSlots` getter**

Replace the getter body (lines 373-385):

```typescript
    public get filterSlots(): number {
        if (this.type === 'splitter') return 1
        if (this.entityData.filter_count !== undefined) return this.entityData.filter_count
        if (this.entityData.max_logistic_slots !== undefined) {
            return this.entityData.max_logistic_slots
        }
        if (this.name === 'buffer-chest' || this.name === 'requester-chest') {
```

with:

```typescript
    public get filterSlots(): number {
        if (this.type === 'splitter') return 1
        const ed = this.entityData
        if (
            (isInserter(ed) || isLoader(ed) || isMiningDrill(ed)) &&
            ed.filter_count !== undefined
        ) {
            return ed.filter_count
        }
        if ((isLogisticContainer(ed) || isRoboport(ed)) && ed.max_logistic_slots !== undefined) {
            return ed.max_logistic_slots
        }
        if (this.name === 'buffer-chest' || this.name === 'requester-chest') {
```

(`filter_count` lives on inserter/loader/mining-drill; `max_logistic_slots` on logistic-container/roboport. The original read these defensively on the base type; the guards restore type safety while preserving the "first defined wins" behavior.)

- [ ] **Step 3: Narrow `max_distance` in `rotate` (line 865)**

In the `if (this.type === 'underground-belt' || this.type === 'loader')` block, the call to `getOpposingEntity` passes `this.entityData.max_distance` as its last argument. Replace that argument (line 865) with:

```typescript
                        isUndergroundBelt(this.entityData) ? this.entityData.max_distance : undefined
```

(`max_distance` exists only on `underground-belt`, not `loader`; for `loader` the original value was `undefined` at runtime, which this preserves.)

- [ ] **Step 4: Verify the count dropped to 70**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `70`

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/core/Entity.ts
git commit -m "fix(editor): narrow prototypes for Entity filterSlots and underground-belt rotate"
```

---

### Task 6: EntityInfoPanel.ts beacon/crafting/inserter/belt details

**Files:**
- Modify: `packages/editor/src/UI/EntityInfoPanel.ts` (import line 2; lines 108, 133-161, 236-271, 280-290)

**Interfaces:**
- Consumes: `isBeacon`, `isCraftingMachine`, `isInserter`, `isTransportBeltConnectable` from `../core/factorioData`.

Fixes 10 errors: `distribution_effectivity` (141, 146, 153), `crafting_speed` (159), `energy_usage` (161), `rotation_speed` (239, 255), `speed` (256, 270), `supply_area_distance` (290).

- [ ] **Step 1: Extend the factorioData import**

Change line 2 from:

```typescript
import FD, { getModule } from '../core/factorioData'
```

to:

```typescript
import FD, {
    getModule,
    isBeacon,
    isCraftingMachine,
    isInserter,
    isTransportBeltConnectable,
} from '../core/factorioData'
```

- [ ] **Step 2: Narrow the assembling-machine block (lines 108, 159-161)**

Change line 108 from `if (entity.entityData.type === 'assembling-machine') {` to:

```typescript
        const machineData = entity.entityData
        if (machineData.type === 'assembling-machine' && isCraftingMachine(machineData)) {
```

Then within that block change line 159 from:

```typescript
            const newCraftingSpeed = entity.entityData.crafting_speed * (1 + speed)
```

to:

```typescript
            const newCraftingSpeed = machineData.crafting_speed * (1 + speed)
```

and lines 160-161 from:

```typescript
            const newEnergyUsage =
                parseInt(entity.entityData.energy_usage.slice(0, -2)) * (1 + consumption)
```

to:

```typescript
            const newEnergyUsage =
                parseInt(machineData.energy_usage.slice(0, -2)) * (1 + consumption)
```

- [ ] **Step 3: Narrow the beacon loop (lines 133-153)**

Change line 133 region. Replace:

```typescript
            for (const beacon of this.findNearbyBeacons(entity)) {
                for (const module of beacon.modules) {
                    if (!module) continue
```

with:

```typescript
            for (const beacon of this.findNearbyBeacons(entity)) {
                const beaconData = beacon.entityData
                if (!isBeacon(beaconData)) continue
                for (const module of beacon.modules) {
                    if (!module) continue
```

Then replace the three reads of `beacon.entityData.distribution_effectivity` (lines 141, 146, 153) with `beaconData.distribution_effectivity`.

- [ ] **Step 4: Narrow the inserter block (lines 236-258)**

Change line 236 from `if (entity.entityData.type === 'inserter') {` to:

```typescript
        const inserterData = entity.entityData
        if (isInserter(inserterData)) {
```

Replace `entity.entityData.rotation_speed` on line 239 with `inserterData.rotation_speed`.

Replace the belt-target sub-block (lines 253-259):

```typescript
            if (to && isBelt(to)) {
                speed = containerToBelt(
                    entity.entityData.rotation_speed,
                    to.entityData.speed,
                    entity.inserterStackSize
                )
            }
```

with:

```typescript
            const toData = to?.entityData
            if (to && isBelt(to) && toData && isTransportBeltConnectable(toData)) {
                speed = containerToBelt(
                    inserterData.rotation_speed,
                    toData.speed,
                    entity.inserterStackSize
                )
            }
```

- [ ] **Step 5: Narrow the belt block (lines 267-272)**

Replace:

```typescript
        if (isBelt(entity)) {
            // Details for belts
            this.m_entityInfo.text = `Speed: ${roundToTwo(
                getBeltSpeed(entity.entityData.speed)
            )} items/s`
            this.m_entityInfo.position.set(10, nextY)
        }
```

with:

```typescript
        const beltData = entity.entityData
        if (isBelt(entity) && isTransportBeltConnectable(beltData)) {
            // Details for belts
            this.m_entityInfo.text = `Speed: ${roundToTwo(
                getBeltSpeed(beltData.speed)
            )} items/s`
            this.m_entityInfo.position.set(10, nextY)
        }
```

- [ ] **Step 6: Narrow `supply_area_distance` in `findNearbyBeacons` (line 290)**

Replace line 290:

```typescript
            beaconAura.pad(FD.entities.beacon.supply_area_distance + 1)
```

with:

```typescript
            const beaconProto = FD.entities.beacon
            beaconAura.pad((isBeacon(beaconProto) ? beaconProto.supply_area_distance : 0) + 1)
```

- [ ] **Step 7: Verify the count dropped to 60**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `60`

- [ ] **Step 8: Commit**

```bash
git add packages/editor/src/UI/EntityInfoPanel.ts
git commit -m "fix(editor): narrow entity prototypes in EntityInfoPanel detail rendering"
```

---

### Task 7: History.ts generic-constraint fix

**Files:**
- Modify: `packages/editor/src/common/util.ts` (line 168)

**Interfaces:**
- Consumes/Produces: none new. Widens `objectHasOwnProperty`'s first parameter so the generic `GetValue<T, ...>` in History.ts compiles without rippling a `T extends object` constraint up through `updateValue` and all its callers.

Fixes `History.ts(338,39)` TS2345.

- [ ] **Step 1: Widen the parameter type**

Change line 168 from:

```typescript
const objectHasOwnProperty = (obj: object, key: PropertyKey): boolean =>
```

to:

```typescript
const objectHasOwnProperty = (obj: unknown, key: PropertyKey): boolean =>
```

The body `Object.prototype.hasOwnProperty.call(obj, key)` accepts any value, so widening is safe and all existing callers still type-check.

- [ ] **Step 2: Verify the count dropped to 59**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `59`

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/common/util.ts
git commit -m "fix(editor): widen objectHasOwnProperty param to unknown for generic GetValue"
```

---

### Task 8: Lower the baseline and run the gate

**Files:**
- Modify: `scripts/type-check-baseline.json`

**Interfaces:**
- Consumes: the now-59 error count.

- [ ] **Step 1: Confirm the current count is 59**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `59`

- [ ] **Step 2: Lower `maxErrors` to 59**

Edit `scripts/type-check-baseline.json` - change `"maxErrors": 87` to:

```json
    "maxErrors": 59
```

- [ ] **Step 3: Run the gate (must PASS)**

Run: `npm run type-check:gate`
Expected: PASS (count 59 equals baseline 59).

- [ ] **Step 4: Run the gate's own unit tests (must PASS)**

Run: `npm run test:scripts`
Expected: all tests pass.

- [ ] **Step 5: Verify all 28 Batch-1 errors are gone (spriteDataBuilder's 59 remain, deferred)**

Run: `npx tsc --noEmit -p packages/editor/tsconfig.json 2>&1 | grep "error TS" | grep -vc "spriteDataBuilder"`
Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add scripts/type-check-baseline.json
git commit -m "chore(editor): lower type-check baseline 87 -> 59 after Batch 1 cleanup"
```

---

## Self-Review

**Spec coverage** - every Batch-1 error is mapped to a task:
- Editor.ts TS2307 x2 -> Task 1
- Guards foundation -> Task 2
- UnderlayContainer.ts (5) -> Task 3
- OverlayContainer.ts (4) + PaintEntityContainer.ts (1) -> Task 4
- Entity.ts (5) -> Task 5
- EntityInfoPanel.ts (10) -> Task 6
- History.ts (1) -> Task 7
- Baseline lock -> Task 8
Total: 2 + 5 + 5 + 5 + 10 + 1 = 28, plus the 2 TS2307. Count 87 -> 59. Matches scope.

**Placeholder scan** - no TBD/TODO/"handle edge cases"; every code step shows exact before/after.

**Type consistency** - guard names and signatures defined in Task 2 are used verbatim in Tasks 3-6. `isInserter`/`isCraftingMachine` are reused from existing exports (already imported in Entity.ts; added to EntityInfoPanel/OverlayContainer imports). `isTransportBeltConnectable` is the only multi-type guard and is used only for the `.speed` reads in Task 6. No task references a guard not produced in Task 2.

**Behavior preservation** - every replaced condition is logically equivalent to its guard (type-keyed), and `||`/ternary fallbacks reproduce the original runtime values for non-matching subtypes (`max_distance`, `underground_sprite`, `supply_area_distance`).
