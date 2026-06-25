# FBSR-Inspired Rendering Improvements Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve sprite rendering accuracy by adopting patterns from Factorio-FBSR (Java blueprint renderer), focusing on the highest-impact fixes that reduce rendering errors.

**Architecture:** Five independent improvements, ordered by impact. Each modifies `spriteDataBuilder.ts` and/or `EntitySprite.ts` - the two files that form the rendering pipeline. No new dependencies. Changes are additive - they improve rendering of entities that currently render incorrectly or not at all, without regressing working entities.

**Tech Stack:** TypeScript, PixiJS v8, Factorio prototype data (`data.json`)

**Reference codebase:** `/Users/ericjohnson/Documents/GitHub/Factorio-FBSR` - Java blueprint renderer with more accurate sprite rendering. Key files:
- `FactorioBlueprintStringRenderer/src/com/demod/fbsr/entity/` - per-entity rendering classes
- `FactorioBlueprintStringRenderer/src/com/demod/fbsr/fp/FPRotatedSprite.java` - multi-file spritesheet indexing
- `FactorioBlueprintStringRenderer/src/com/demod/fbsr/entity/UnknownEntityRendering.java` - unknown entity placeholders
- `FactorioBlueprintStringRenderer/src/com/demod/fbsr/entity/PipeRendering.java` - pipe adjacency rendering

**No test framework exists in this project.** Testing is manual - load blueprints in the browser and visually verify. Each task includes manual testing steps.

---

## Task 1: Fix `filenames[]` Spritesheet Indexing

**Problem:** Space Age entities use `filenames: string[]` arrays where each file holds a subset of direction frames. Our code uses `filenames[0]` as a blanket fallback in `EntitySprite.ts:141-143`, which means multi-file entities always show the first direction's sprite regardless of actual direction.

**How FBSR does it:** `FPRotatedSprite.java:96-119` computes `fileIndex = spriteIndex / (lineLength * linesPerFile)` and `tileIndex = spriteIndex % (lineLength * linesPerFile)`, then offsets x/y within the selected file. For simple directional entities (4-way cardinal), `filenames[dir/4]` selects the correct file.

**Our existing pattern:** The `draw_locomotive`, `draw_cargo_wagon`, `draw_fluid_wagon`, `draw_artillery_wagon`, and `draw_infinity_cargo_wagon` functions already do `if (l.filenames) l.filename = l.filenames[d]` where `d = data.dir / 4`. This is the correct pattern for 4-way cardinal entities. The problem is entities that fall through to the `EntitySprite.ts` fallback without direction-based file selection.

**Files:**
- Modify: `packages/editor/src/core/spriteDataBuilder.ts:1103-1111` (enhance `draw_simple_entity`)
- Modify: `packages/editor/src/containers/EntitySprite.ts:141-143` (improve fallback)

### Steps

- [ ] **Step 1: Enhance `draw_simple_entity` to handle `filenames[]` with direction**

In `packages/editor/src/core/spriteDataBuilder.ts`, the `draw_simple_entity` function currently ignores direction entirely. Update it to apply direction-based `filenames` indexing to each returned layer, matching the pattern used by `draw_locomotive` et al.

```typescript
function draw_simple_entity(e: any): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        let layers: SpriteData[]
        if (e.picture?.layers) layers = e.picture.layers.map(l => util.duplicate(l))
        else if (e.picture) layers = [util.duplicate(e.picture)]
        else if (e.pictures?.layers) layers = e.pictures.layers.map(l => util.duplicate(l))
        else if (e.animations?.layers) layers = e.animations.layers.map(l => util.duplicate(l))
        else if (e.graphics_set?.animation?.layers) layers = e.graphics_set.animation.layers.map(l => util.duplicate(l))
        else return []

        // Apply direction-based filenames indexing (same pattern as draw_locomotive)
        const d = data.dir !== undefined ? Math.floor(data.dir / 4) : 0
        for (const l of layers) {
            if ((l as any).filenames && !(l as any).filename) {
                const filenames = (l as any).filenames as string[]
                if (d < filenames.length) {
                    ;(l as any).filename = filenames[d]
                } else {
                    ;(l as any).filename = filenames[0]
                }
            }
        }
        return layers
    }
}
```

Note: We must `util.duplicate()` layers before mutating them since the original objects come from cached `FD.entities` data and mutations would corrupt the cache.

- [ ] **Step 2: Improve the `EntitySprite.ts` fallback to use direction when available**

In `packages/editor/src/containers/EntitySprite.ts`, the fallback at line 141-143 always uses `filenames[0]`. Update it to use a direction-based index when the entity data includes direction info. This catches any sprites that slip past `draw_simple_entity`.

Currently:
```typescript
if (!data.filename && data.filenames) {
    data.filename = data.filenames[0]
}
```

Change to:
```typescript
if (!data.filename && data.filenames) {
    // Use direction-based index if entity has direction, otherwise first file
    const dirIndex = entity.direction ? Math.floor(entity.direction / 4) : 0
    const filenames = data.filenames as string[]
    data.filename = filenames[Math.min(dirIndex, filenames.length - 1)]
}
```

Note: `entity` is the `IEntityData | Entity` parameter already available in `getParts()`. The `data` variable is a `SpriteData` from the loop.

- [ ] **Step 3: Manual test**

Start dev server and static file server:
```fish
cd packages/website && npm run start
# In separate terminal:
npx serve packages/exporter/data/output -l 8081 --cors
```

Test with a blueprint containing Space Age entities that use multi-file sprites (foundry, recycler, etc.). Open browser console - verify no errors about missing textures. Compare entity appearance when rotated to different directions - each direction should now show a different sprite instead of always showing the north-facing one.

- [ ] **Step 4: Commit**

```fish
git add packages/editor/src/core/spriteDataBuilder.ts packages/editor/src/containers/EntitySprite.ts
git commit -m "fix: improve filenames[] spritesheet indexing for multi-file entities

Apply direction-based file selection in draw_simple_entity fallback and
EntitySprite.getParts, matching the pattern used by locomotive/wagon draw
functions. Fixes Space Age entities always showing first-direction sprite."
```

---

## Task 2: Render Unknown Entities as Visible Placeholders

**Problem:** When entities are present in `FD.entities` (pass schema validation) but their `draw_*` function throws an error or returns empty sprites, they render as invisible. Users see blank space where entities should be. Additionally, entities not in `FD.entities` are silently stripped in `bpString.ts:125-140` - users get no visual feedback that entities were removed.

**How FBSR does it:** `UnknownEntityRendering.java` renders a colored circle with diagonal stripes and a "?" character, plus the entity name as text. Color is deterministically generated from `name.hashCode()` so the same entity always gets the same color.

**Our approach:** Render a simple colored rectangle with the entity name using PixiJS Graphics. This is simpler than FBSR's approach but gives clear visual feedback. We'll handle two cases:
1. Entities in FD.entities whose draw function fails - show placeholder in `spriteDataBuilder.ts`
2. Entities stripped during validation - show placeholder in the Blueprint (requires changes to `bpString.ts` and `Blueprint.ts`)

For this task, we'll focus on case 1 (draw function failures) since case 2 requires deeper changes to the entity creation pipeline.

**Files:**
- Create: `packages/editor/src/containers/UnknownEntitySprite.ts`
- Modify: `packages/editor/src/containers/EntitySprite.ts:110-203` (add unknown entity rendering path)
- Modify: `packages/editor/src/core/spriteDataBuilder.ts:142-169` (tag failed sprites)

### Steps

- [ ] **Step 1: Create `UnknownEntitySprite.ts`**

Create a simple PixiJS container that renders a colored rectangle with entity name text. Uses a deterministic color from the entity name hash (same concept as FBSR).

```typescript
import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { IPoint } from '../types'

function hashStringToColor(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash)
        hash = hash & hash // Convert to 32-bit int
    }
    // Generate a hue from hash, fixed saturation and lightness for visibility
    const hue = Math.abs(hash % 360)
    // Convert HSL to RGB (s=60%, l=40%)
    const s = 0.6
    const l = 0.4
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
    const m = l - c / 2
    let r: number, g: number, b: number
    if (hue < 60) { r = c; g = x; b = 0 }
    else if (hue < 120) { r = x; g = c; b = 0 }
    else if (hue < 180) { r = 0; g = c; b = x }
    else if (hue < 240) { r = 0; g = x; b = c }
    else if (hue < 300) { r = x; g = 0; b = c }
    else { r = c; g = 0; b = x }
    const ri = Math.round((r + m) * 255)
    const gi = Math.round((g + m) * 255)
    const bi = Math.round((b + m) * 255)
    return (ri << 16) | (gi << 8) | bi
}

export class UnknownEntitySprite extends Container {
    public __zIndex = 0
    public zOrder = 0
    public readonly entityPos: IPoint

    constructor(entityName: string, position: IPoint, tileWidth = 1, tileHeight = 1) {
        super()

        this.entityPos = position
        this.position.set(position.x, position.y)

        const color = hashStringToColor(entityName)
        const pxW = tileWidth * 32
        const pxH = tileHeight * 32

        const rect = new Graphics()
        rect.rect(-pxW / 2, -pxH / 2, pxW, pxH)
        rect.fill({ color, alpha: 0.5 })
        rect.stroke({ color, alpha: 0.8, width: 2 })
        this.addChild(rect)

        const style = new TextStyle({
            fontFamily: 'monospace',
            fontSize: 8,
            fill: 0xffffff,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: pxW - 4,
        })
        const label = new Text({ text: entityName, style })
        label.anchor.set(0.5, 0.5)
        this.addChild(label)
    }
}
```

- [ ] **Step 2: Export a marker from `spriteDataBuilder.ts` for failed sprite generation**

In `packages/editor/src/core/spriteDataBuilder.ts`, add an exported constant that marks failed generation, and update `getSpriteData` to return it when sprite generation fails (instead of empty array).

Add after the `ExtendedSpriteData` interface (after line 138):

```typescript
export const SPRITE_GENERATION_FAILED = Symbol('SPRITE_GENERATION_FAILED')
```

Then update the `getSpriteData` function. Change the error catch block (lines 162-164) from:
```typescript
} catch (err) {
    console.warn(`Error generating sprites for '${data.name}' (type: ${entity.type}):`, err)
    return []
}
```
To:
```typescript
} catch (err) {
    console.warn(`Error generating sprites for '${data.name}' (type: ${entity.type}):`, err)
    return SPRITE_GENERATION_FAILED as any
}
```

And update the entity-not-found case (lines 149-152) similarly:
```typescript
if (!entity) {
    console.warn(`Entity '${data.name}' not found in FD.entities`)
    const failedGenerator = () => SPRITE_GENERATION_FAILED as any
    generatorCache.set(data.name, failedGenerator)
    return failedGenerator()
}
```

- [ ] **Step 3: Handle `SPRITE_GENERATION_FAILED` in `EntitySprite.getParts()`**

In `packages/editor/src/containers/EntitySprite.ts`, import the marker and `UnknownEntitySprite`, and add handling after the `getSpriteData` call.

Update the existing import from `spriteDataBuilder` to include `SPRITE_GENERATION_FAILED`:
```typescript
import { getSpriteData, ExtendedSpriteData, SPRITE_GENERATION_FAILED } from '../core/spriteDataBuilder'
```

Add new imports:
```typescript
import { UnknownEntitySprite } from './UnknownEntitySprite'
import FD, { ColorWithAlpha, getColor, getEntitySize } from '../core/factorioData'
```

Note: `getEntitySize` is already exported from `factorioData.ts` (line 505). Its signature is `getEntitySize(e: EntityWithOwnerPrototype, dir: number = 0): IPoint` - it takes an entity prototype object, not a name string, and returns `{ x, y }` (tile dimensions), not `{ width, height }`.

In `getParts()`, after `const spriteData = getSpriteData(...)` (line 131), add:

```typescript
if (spriteData === SPRITE_GENERATION_FAILED || spriteData.length === 0) {
    const fdEntity = FD.entities[entity.name]
    const size = fdEntity ? getEntitySize(fdEntity, entity.direction || 0) : { x: 1, y: 1 }
    const unknown = new UnknownEntitySprite(
        entity.name,
        position || entity.position || { x: 0, y: 0 },
        size.x || 1,
        size.y || 1
    )
    return [unknown as any]
}
```

Note: We return `UnknownEntitySprite` cast through `any` because the return type expects `EntitySprite[]`, but `UnknownEntitySprite` has the same shape (`__zIndex`, `zOrder`, `entityPos`, extends Container). The `compareFn` in `EntitySprite` will still work because it only accesses these shared properties. When the entity is not in `FD.entities` (was not stripped but draw failed), we fall back to 1x1 tile size.

- [ ] **Step 4: Add `SPRITE_GENERATION_FAILED` to the export list in `spriteDataBuilder.ts`**

At the bottom of `packages/editor/src/core/spriteDataBuilder.ts` (line 2274), update the export statement:

From:
```typescript
export { getSpriteData, getBeltWireConnectionIndex }
```
To:
```typescript
export { getSpriteData, getBeltWireConnectionIndex, SPRITE_GENERATION_FAILED }
```

- [ ] **Step 5: Manual test**

Load a blueprint containing a mix of known and unknown entities (e.g., a modded blueprint with entities not in vanilla+Space Age data). Verify:
- Known entities render normally (no regression)
- Unknown/failed entities show as colored rectangles with name text
- Console warnings still appear for unknown entities
- The placeholder doesn't crash when clicking or hovering

- [ ] **Step 6: Commit**

```fish
git add packages/editor/src/containers/UnknownEntitySprite.ts packages/editor/src/containers/EntitySprite.ts packages/editor/src/core/spriteDataBuilder.ts
git commit -m "feat: render unknown entities as colored placeholders instead of invisible

Entities whose draw function fails or returns empty sprites now render as
colored rectangles with the entity name, matching FBSR's unknown entity
rendering concept. Color is deterministic per entity name."
```

---

## Task 3: Improve Layer Z-Ordering

**Problem:** We use only ~6 z-index values (-10 to 2), leading to incorrect overlap ordering. FBSR uses 80+ explicit render layers that match Factorio's own layer system.

**Our approach:** We can't adopt FBSR's full 80-layer system without major refactoring, but we can add more z-index granularity for commonly-overlapping entity types. The key insight from FBSR is that entity types should have consistent layer assignments rather than relying on sprite index position.

**Files:**
- Modify: `packages/editor/src/containers/EntitySprite.ts:155-196` (z-index assignment logic)

### Steps

- [ ] **Step 1: Create a layer constants object and refactor z-index assignment**

Replace the ad-hoc z-index assignments in `EntitySprite.getParts()` with a structured layer system. Add this before the `EntitySprite` class definition:

```typescript
/** Z-index layer assignments inspired by Factorio's render layer ordering.
 *  Lower values render behind higher values. */
const LAYER = {
    RAIL_STONE: -10,
    RAIL_TIE: -9,
    RAIL_SIGNAL: -8,
    RAIL_METAL: -7,
    TRANSPORT_BELT: -6,
    TRANSPORT_BELT_ABOVE: -5,
    FLOOR_ENTITY: -4,        // pipes, underground belt entrances
    PIPE: -3,
    ENTITY_BASE: 0,
    CIRCUIT_CONNECTOR: 1,
    ARTILLERY_BARREL: 2,
    INSERTER: 3,             // inserters should render above most entities
    ELEVATED_RAIL_STONE: 4,
    ELEVATED_RAIL_TIE: 5,
    ELEVATED_RAIL_METAL: 6,
} as const
```

Then update the z-index assignment logic in `getParts()` to use these constants. Replace the if/else chain inside the `for` loop (lines 155-196) - keep the `let foundMainBelt = false` declaration at line 136 intact:

```typescript
if (data.filename.includes('circuit-connector')) {
    sprite.__zIndex = LAYER.CIRCUIT_CONNECTOR
} else if (entity.type === 'artillery-turret' && i > 0) {
    sprite.__zIndex = LAYER.ARTILLERY_BARREL
} else if (
    (entity.type === 'rail-signal' || entity.type === 'rail-chain-signal') &&
    i === 0
) {
    sprite.__zIndex = LAYER.RAIL_SIGNAL
} else if (
    entity.type === 'legacy-straight-rail' ||
    entity.type === 'straight-rail' ||
    entity.type === 'half-diagonal-rail' ||
    entity.type === 'legacy-curved-rail' ||
    entity.type === 'curved-rail-a' ||
    entity.type === 'curved-rail-b'
) {
    if (i < 2) {
        sprite.__zIndex = LAYER.RAIL_STONE
    } else if (i < 4) {
        sprite.__zIndex = LAYER.RAIL_TIE
    } else {
        sprite.__zIndex = LAYER.RAIL_METAL
    }
} else if (
    entity.type === 'elevated-straight-rail' ||
    entity.type === 'elevated-curved-rail-a' ||
    entity.type === 'elevated-curved-rail-b' ||
    entity.type === 'elevated-half-diagonal-rail'
) {
    if (i < 2) {
        sprite.__zIndex = LAYER.ELEVATED_RAIL_STONE
    } else if (i < 4) {
        sprite.__zIndex = LAYER.ELEVATED_RAIL_TIE
    } else {
        sprite.__zIndex = LAYER.ELEVATED_RAIL_METAL
    }
} else if (entity.type === 'transport-belt' || entity.type === 'heat-pipe') {
    sprite.__zIndex = i === 0 ? LAYER.TRANSPORT_BELT : LAYER.TRANSPORT_BELT_ABOVE
    if (data.filename.includes('connector') && !data.filename.includes('back-patch')) {
        sprite.__zIndex = LAYER.ENTITY_BASE
    }
} else if (
    entity.type === 'splitter' ||
    entity.type === 'underground-belt' ||
    entity.type === 'loader'
) {
    if (!foundMainBelt && data.filename.includes('transport-belt')) {
        foundMainBelt = true
        sprite.__zIndex = LAYER.TRANSPORT_BELT
    }
} else if (entity.type === 'pipe' || entity.type === 'infinity-pipe') {
    sprite.__zIndex = LAYER.PIPE
} else if (entity.type === 'inserter') {
    sprite.__zIndex = LAYER.INSERTER
} else {
    sprite.__zIndex = LAYER.ENTITY_BASE
}
```

Key changes from current code:
- Elevated rails get their own higher z-index values (render above ground entities)
- Pipes get `LAYER.PIPE` (-3) so they render below entities but above belts
- Inserters get `LAYER.INSERTER` (3) so they render above entities they're inserting into
- Named constants make the intent clear

- [ ] **Step 2: Manual test**

Test with blueprints that have overlapping entities:
- Inserters next to assembling machines - inserters should render on top
- Belts under entities - belts should render behind
- Elevated rails over ground entities - elevated rails should render on top
- Pipes near other entities - should render at appropriate depth

- [ ] **Step 3: Commit**

```fish
git add packages/editor/src/containers/EntitySprite.ts
git commit -m "fix: improve z-index layer ordering for entity rendering

Add named layer constants and more granular z-index assignments. Elevated
rails now render above ground entities, inserters above machines, and
pipes at an appropriate depth between belts and entities."
```

---

## Task 4: Enhance `draw_simple_entity` Fallback with More Prototype Patterns

**Problem:** `draw_simple_entity` only tries 5 property paths. Many Space Age entities that fall through the `default` case in `generateGraphics()` have graphics in different structures that `draw_simple_entity` doesn't check. This causes them to render as invisible (empty array).

**How FBSR does it:** Each entity type has a dedicated rendering class with specific property access. We can't match that granularity, but we can add more fallback property paths that cover common Space Age prototype patterns.

**Files:**
- Modify: `packages/editor/src/core/spriteDataBuilder.ts:1103-1112` (expand `draw_simple_entity`)

### Steps

- [ ] **Step 1: Research which property paths Space Age entities use**

Check the FBSR entity rendering classes and Factorio prototype definitions to identify common graphics property paths beyond the 5 we already check. Look at entity types that currently fail in our renderer.

Run this in the browser console while the editor is loaded, to see which entity types hit the default case:

```javascript
// Paste into browser console with a Space Age blueprint loaded
// to see which entities fall through to draw_simple_entity
```

Or grep data.json for entities whose type isn't in our switch statement:

```fish
# From repo root - find entity types in data.json not handled by our switch
cd packages/exporter/data/output && cat data.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
handled = {'accumulator','agricultural-tower','ammo-turret','arithmetic-combinator','artillery-turret','artillery-wagon','assembling-machine','asteroid-collector','beacon','boiler','burner-generator','cargo-bay','cargo-landing-pad','cargo-wagon','constant-combinator','container','decider-combinator','display-panel','electric-energy-interface','electric-pole','electric-turret','elevated-curved-rail-a','elevated-curved-rail-b','elevated-half-diagonal-rail','elevated-straight-rail','fluid-turret','fluid-wagon','furnace','fusion-generator','fusion-reactor','gate','generator','heat-interface','heat-pipe','infinity-cargo-wagon','infinity-container','inserter','lab','lamp','land-mine','lane-splitter','curved-rail-a','curved-rail-b','legacy-curved-rail','half-diagonal-rail','straight-rail','legacy-straight-rail','lightning-attractor','linked-belt','linked-container','loader-1x1','loader','locomotive','logistic-container','mining-drill','offshore-pump','pipe','infinity-pipe','pipe-to-ground','power-switch','programmable-speaker','proxy-container','pump','radar','rail-ramp','rail-signal','rail-chain-signal','rail-support','reactor','roboport','rocket-silo','selector-combinator','solar-panel','space-platform-hub','splitter','storage-tank','thruster','train-stop','transport-belt','turret','underground-belt','valve','wall','market','simple-entity-with-owner','simple-entity-with-force','temporary-container'}
for name, ent in data.get('entities', {}).items():
    t = ent.get('type', '')
    if t not in handled:
        print(f'{t}: {name}')
" 2>/dev/null || echo "data.json not found or python3 not available"
```

- [ ] **Step 2: Expand `draw_simple_entity` with additional property paths**

Based on common Factorio prototype patterns (from FBSR source and typed-factorio definitions), add more fallback paths:

```typescript
function draw_simple_entity(e: any): (data: IDrawData) => readonly SpriteData[] {
    return (data: IDrawData) => {
        let layers: SpriteData[]

        // Try various property paths that Factorio prototypes use for graphics
        if (e.picture?.layers) {
            layers = e.picture.layers.map(l => util.duplicate(l))
        } else if (e.picture) {
            layers = [util.duplicate(e.picture)]
        } else if (e.pictures?.layers) {
            layers = e.pictures.layers.map(l => util.duplicate(l))
        } else if (e.pictures && Array.isArray(e.pictures)) {
            // Array of sprite variants (e.g., SpriteVariations) - pick first
            const first = e.pictures[0]
            layers = first?.layers
                ? first.layers.map(l => util.duplicate(l))
                : [util.duplicate(first)]
        } else if (e.animations?.layers) {
            layers = e.animations.layers.map(l => util.duplicate(l))
        } else if (e.animations && !e.animations.layers) {
            // 4-way animation - use direction
            const dirName = util.getDirName(data.dir || 0)
            const anim = e.animations[dirName] || e.animations.north || e.animations
            layers = anim?.layers
                ? anim.layers.map(l => util.duplicate(l))
                : [util.duplicate(anim)]
        } else if (e.graphics_set?.animation?.layers) {
            layers = e.graphics_set.animation.layers.map(l => util.duplicate(l))
        } else if (e.graphics_set?.animation) {
            // 4-way animation in graphics_set
            const anim = e.graphics_set.animation
            const dirName = util.getDirName(data.dir || 0)
            if (anim[dirName]) {
                const dirAnim = anim[dirName]
                layers = dirAnim.layers
                    ? dirAnim.layers.map(l => util.duplicate(l))
                    : [util.duplicate(dirAnim)]
            } else if (anim.layers) {
                layers = anim.layers.map(l => util.duplicate(l))
            } else {
                layers = [util.duplicate(anim)]
            }
        } else if (e.graphics_set?.picture?.layers) {
            layers = e.graphics_set.picture.layers.map(l => util.duplicate(l))
        } else if (e.graphics_set?.picture && Array.isArray(e.graphics_set.picture)) {
            // Flat array of pictures (e.g., cargo-bay)
            layers = e.graphics_set.picture.flatMap(p =>
                p.layers ? p.layers.map(l => util.duplicate(l)) : [util.duplicate(p)]
            )
        } else if (e.chargable_graphics?.picture?.layers) {
            layers = e.chargable_graphics.picture.layers.map(l => util.duplicate(l))
        } else if (e.folded_animation?.layers) {
            layers = e.folded_animation.layers.map(l => util.duplicate(l))
        } else {
            return []
        }

        // Apply direction-based filenames indexing
        const d = data.dir !== undefined ? Math.floor(data.dir / 4) : 0
        for (const l of layers) {
            if ((l as any).filenames && !(l as any).filename) {
                const filenames = (l as any).filenames as string[]
                ;(l as any).filename = filenames[Math.min(d, filenames.length - 1)]
            }
        }
        return layers
    }
}
```

Note: This subsumes the changes from Task 1 Step 1. If Task 1 was already completed, this replaces the `draw_simple_entity` from Task 1.

- [ ] **Step 3: Manual test**

Load blueprints with various entity types. Check browser console for `Missing draw function` warnings - those entities should now be more likely to render something. Compare before/after by temporarily reverting the change.

- [ ] **Step 4: Commit**

```fish
git add packages/editor/src/core/spriteDataBuilder.ts
git commit -m "fix: expand draw_simple_entity fallback to handle more prototype patterns

Add fallback paths for SpriteVariations arrays, 4-way animations,
graphics_set.picture arrays, chargable_graphics, and folded_animation.
Handles direction-aware sprite selection for entities without dedicated
draw functions."
```

---

## Task 5: Improve Pipe Window Variant Selection

**Problem:** Our pipe rendering already handles the 16 adjacency variants correctly (via `draw_pipe` at lines 1741-1799). However, FBSR has a more accurate window variant selection for straight pipes: it only shows the window variant when the pipe is part of a continuous straight run (both neighbors are also straight pipes with the same orientation). Our code uses simple position parity (`% 2`) which shows window variants even on short 2-pipe segments.

**How FBSR does it:** `PipeRendering.java:56-84` checks that both forward and reverse neighbors also have the same straight adjacency code before applying the window variant. Only if both neighbors are also straight pipes in the same orientation does it apply the checkerboard window pattern.

**Files:**
- Modify: `packages/editor/src/core/spriteDataBuilder.ts` (the `draw_pipe` function, lines 1741-1799)

### Steps

- [ ] **Step 1: Update `draw_pipe` to check neighbor adjacency for window variants**

The window variant logic is in the vertical and horizontal straight pipe sections. Currently:

```typescript
if (conn[0] && conn[2]) {
    return Math.floor(data.position.y) % 2 === 0
        ? [pictures.straight_vertical]
        : [pictures.vertical_window_background, pictures.straight_vertical_window]
}
if (conn[1] && conn[3]) {
    return Math.floor(data.position.x) % 2 === 0
        ? [pictures.straight_horizontal]
        : [pictures.horizontal_window_background, pictures.straight_horizontal_window]
}
```

Update to check that neighbors are also straight pipes before applying window variant:

```typescript
if (conn[0] && conn[2]) {
    // Only show window variant in continuous straight runs (3+ pipes)
    let useWindow = false
    if (data.positionGrid) {
        const above = { x: data.position.x, y: Math.floor(data.position.y) - 1 }
        const below = { x: data.position.x, y: Math.floor(data.position.y) + 1 }
        const aboveConn = getFluidConnections(above, data.positionGrid)
        const belowConn = getFluidConnections(below, data.positionGrid)
        // Both neighbors must also be vertical straight pipes
        const aboveIsStraightV = aboveConn[0] && aboveConn[2] && !aboveConn[1] && !aboveConn[3]
        const belowIsStraightV = belowConn[0] && belowConn[2] && !belowConn[1] && !belowConn[3]
        if (aboveIsStraightV && belowIsStraightV) {
            useWindow = Math.floor(data.position.y) % 2 !== 0
        }
    }
    return useWindow
        ? [pictures.vertical_window_background, pictures.straight_vertical_window]
        : [pictures.straight_vertical]
}
if (conn[1] && conn[3]) {
    let useWindow = false
    if (data.positionGrid) {
        const left = { x: Math.floor(data.position.x) - 1, y: data.position.y }
        const right = { x: Math.floor(data.position.x) + 1, y: data.position.y }
        const leftConn = getFluidConnections(left, data.positionGrid)
        const rightConn = getFluidConnections(right, data.positionGrid)
        const leftIsStraightH = leftConn[1] && leftConn[3] && !leftConn[0] && !leftConn[2]
        const rightIsStraightH = rightConn[1] && rightConn[3] && !rightConn[0] && !rightConn[2]
        if (leftIsStraightH && rightIsStraightH) {
            useWindow = Math.floor(data.position.x) % 2 !== 0
        }
    }
    return useWindow
        ? [pictures.horizontal_window_background, pictures.straight_horizontal_window]
        : [pictures.straight_horizontal]
}
```

Note: `getFluidConnections` is already defined at line 313 and available in scope. It returns `boolean[]` with indices [north, east, south, west]. The extra neighbor lookups add some cost but pipes are not typically performance-critical.

- [ ] **Step 2: Manual test**

Test with blueprints containing:
- Short pipe segments (2 pipes) - should NOT have window variants
- Long straight pipe runs (3+ pipes) - middle pipes should alternate with window variants
- T-junctions and corners - should not be affected
- Single pipes - should not be affected

- [ ] **Step 3: Commit**

```fish
git add packages/editor/src/core/spriteDataBuilder.ts
git commit -m "fix: only show pipe window variants in continuous straight runs

Match FBSR behavior: pipe window textures now only appear when both
neighbors are also straight pipes with the same orientation, preventing
window sprites on short 2-pipe segments."
```

---

## Execution Order & Dependencies

Tasks 2, 3, and 5 are fully independent and can run in parallel.

**Tasks 1 and 4 overlap:** Task 4's `draw_simple_entity` is a strict superset of Task 1 Step 1's version. When executing both:
- **Skip Task 1 Step 1 entirely** (Task 4 Step 2 replaces it)
- **Do Task 1 Step 2** (EntitySprite.ts fallback) - this is independent of Task 4
- **Do Task 4 Steps 1-4** as written

**Recommended execution order:**

1. **Task 4** (expanded fallback) - broadest impact, covers more entity types
2. **Task 1 Step 2 only** (EntitySprite.ts filenames fallback) - safety net for anything Task 4 misses
3. **Task 2** (unknown entity placeholders) - high user-facing impact
4. **Task 3** (z-ordering) - visual polish
5. **Task 5** (pipe windows) - visual accuracy, lowest priority

Tasks 2, 3, and 5 can be parallelized with each other and with Tasks 1/4.
