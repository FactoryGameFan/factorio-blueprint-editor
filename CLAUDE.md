# Factorio Blueprint Editor - Development Guide

## Project Overview

Web-based Factorio blueprint viewer/editor using PixiJS. Fork adding Space Age DLC support on branch `wormeyman-space-age-support`. Upstream repo: `teoxoy/factorio-blueprint-editor`, tracking issue #268.

## Monorepo Structure

- `packages/editor/` - Core editor library (PixiJS rendering, blueprint parsing, entity logic)
- `packages/exporter/` - Extracts entity data and sprites from Factorio install
- `packages/website/` - Vite-based web frontend that hosts the editor
- `packages/worker/` - Cloudflare Worker for deploying the editor as a static site

## Key Commands

```fish
# Both dev servers at once, from the repo root - Vite on 8080 and the sprite
# data on 8081. Checks both ports by name before spawning anything, and one
# Ctrl-C stops the pair. This is the way to start them.
npm run localpreview

# ...or run them by hand in two terminals, if you want them separate.
# Terminal 1, from packages/website/:
vp dev --port 8080 --strictPort
# Terminal 2, from the repo root:
npx serve packages/exporter/data/output -l 8081 --cors

# Build
cd packages/website && vp build

# Format + lint + type check, every package, one command. This is the one to
# run before pushing, and it is what CI runs. `lint.options.typeCheck` is true
# in vite.config.ts, which it could not be until packages/website's 15 type
# errors were cleared (issue #78). `--fix` applies the format and lint fixes.
#
# This is the type check, and it is a real one - measured, it reports plain tsc
# diagnostics (a `const x: number = 'nope'` comes back as typescript(TS2322)),
# not only type-aware lint rules, and it covers tests/ as well as src. It
# resolves each file against the tsconfig that owns it, so editor files are
# checked under packages/editor/tsconfig.json rather than the root one.
#
# There is deliberately no root `tsc` script any more. The root tsconfig is a
# base to extend - no `include`, no `lib`, and `node` in `types` for the
# Playwright specs - so running bare `tsc` against it compiled the whole tree
# under settings no package builds with and reported 5 errors that neither a
# build nor `vp check` sees: editor code checked against node's fetch types
# (`r.json()` gives `unknown`, not `any`) and website code against node
# globals. Every package is at 0 under its own project. To check one package
# on its own, name its project - that is what the gate below does:
#
#   npx tsc --noEmit -p packages/editor/tsconfig.json
#
# Prefer it over `vp fmt --check` plus `vp lint`: it ends with an error and
# warning count, so a tailed log still shows a failure. Tailing `vp lint` and
# missing its single error line is a mistake that has reached CI here.
vp check
vp check --fix

# The flag must come BEFORE any path. `vp check --fix .` works; `vp check . --fix`
# fails with `no such flag: --fix, did you mean --init?`, which points nowhere near
# the real cause and reads as a broken toolchain rather than a wrong argument
# order. Reachable, because CI itself passes a path (`vp check .`).

# CI type-check gate: fails only if the error count exceeds the committed
# baseline in scripts/type-check-baseline.json. Kept alongside `vp check` because
# the two answer different questions - vp check asks whether the code type-checks
# under the flags that are on, the gate asks whether the count has risen above a
# committed baseline. Redundant again now that `strict: true` has landed and the
# baseline is back to 0 against packages/editor/tsconfig.json - it earns its keep
# at the next flag flip, and #77 is the worked example of how to run one.
#
# The shape to copy: turn the new flag on in a *second* project that nothing
# compiles with and only scripts/type-check-gate.mjs reads, point the baseline at
# that, and ratchet it down. #77 used packages/editor/tsconfig.strict.json, now
# deleted, to go 24 -> 0 across four PRs with CI green throughout.
#
# What does not work, which this note used to assert flatly: turning the flag on
# in the root tsconfig and raising the baseline. `vp check` runs before the gate
# and tolerates nothing, so it exits non-zero on the first commit and the gate
# never runs - the baseline is irrelevant. The ratchet cannot be used against the
# *same* project vp check reads. Against a second one it can.
# Covers packages/editor only.
npm run type-check:gate

# Unit tests (editor + gate) - gate tests now run under vp test
vp test

# Run Playwright blueprint diagnostic tests (requires dev servers running)
vp run test:e2e

# List discovered test blueprints without running
vp run test:e2e -- --list

# Bundle size analysis (from packages/website/) - opens treemap in browser
# Note: bare `npm`/`npx` must resolve to vp's managed npm (~/.vite-plus/bin on
# PATH); the root devEngines pins npm `^12`, which system npm may not satisfy.
cd packages/website && npm run build:analyze
```

## Vite+ Toolchain

`vp` is the unified CLI for this project (check, lint, format, test, build). Configuration lives in the root `vite.config.ts` (`lint`, `fmt`, and `test` blocks); `lint.options.typeCheck` is true, which is what makes `vp check` a type check as well as a lint. The commands `npm run lint` and `npm run format` delegate to `vp` and require it on PATH - install with `VP_VERSION=0.2.6 VP_NODE_MANAGER=yes curl -fsSL https://vite.plus | bash` and add `~/.vite-plus/bin` to PATH.

## Dev Server Setup

Vite dev server runs on port 8080. In dev mode, `/data` is proxied to `http://127.0.0.1:8081` (the static file server serving sprite data). In production builds, `vite-plugin-static-copy` copies sprite data into the build output. Vite 8's dev server requires `optimizeDeps.include` for pixi.js subpath imports (e.g. `pixi.js/app`) - these are configured in `vite.config.js`.

## Architecture

### Data Flow

1. `packages/exporter/` extracts entity definitions and sprites from Factorio
2. Output goes to `packages/exporter/data/output/` - includes `data.json` (entity/item/recipe/signal definitions) and `.basis` texture files
3. `packages/editor/src/core/factorioData.ts` loads `data.json` at runtime as `FD` (FD.entities, FD.items, FD.fluids, FD.signals, FD.recipes, FD.tiles). It also holds the shape-tolerant readers for data that does not match its declared type - `recipeIngredients`/`recipeResults`/`localisedName`, see Space Age Specifics. Reading any `FD` property before `loadData` has run throws naming the property (issue #109) - see the dev-server note under Playwright Blueprint Diagnostics
4. `packages/editor/src/core/bpString.ts` decodes blueprint strings, validates against schema, creates Blueprint/Book objects
5. `packages/editor/src/core/spriteDataBuilder.ts` maps entity types to sprite data via `generateGraphics()` switch statement and per-type `draw_*` functions

### Key Files

- `packages/editor/src/core/spriteDataBuilder.ts` - Entity rendering logic. Each entity type has a `draw_*` function that returns sprite layers. This is where you add rendering for new entity types.
- `packages/editor/src/core/bpString.ts` - Blueprint string decode/encode, AJV schema validation. Validation is lenient - warns on unknown items/signals, and `stripUnknownPrototypes` drops entities _and_ tiles that FD does not have, reporting the two kinds separately. Tiles were added in issue #46: they were left in, and an unknown one then threw in `TileContainer` on `FD.tiles[name].variants`, taking the whole load down while an unknown entity merely warned.
- `packages/editor/src/core/blueprintSchema.json` - AJV schema for blueprint validation. Signal types enum must include Space Age types.
- `packages/editor/src/core/nameMigrations.ts` - Legacy prototype renames, grouped by the Factorio version that introduced each and applied to the parsed object, scoped to the version each blueprint declares. They used to be a regex pass over the raw JSON with the version conditions written as comments, so every rename hit every blueprint - which silently rewrote `stack-inserter` and `fusion-reactor-equipment`, both live prototypes again in 2.0 (issue #40). The textual form could not be fixed in place: the version to test lives inside the string being rewritten. A blueprint with no version is treated as older than every threshold. Note this is _not_ the same call as `Blueprint.ts`'s version guards - see the `Partial<IBlueprint>` note there.
- `packages/editor/src/core/Book.ts` - A book addresses its blueprints by a _flattened_ index (a nested book contributes its contents, not itself) while the `active_index` it serializes is a _top-level entry_ index, each nested book carrying its own. Three functions convert between the two, and only `selectBlueprint` is observable through the editor - the other two produce nothing but `active_index`, which decides nothing about which entities come back, so `tests/book-serialize.spec.ts` exists to read it. `saveBlueprint` answers a two-case union rather than the `[number, number]` tuple it used to, where the answer sat in whichever slot was not undefined and `newI === undefined` silently meant "saved".
- `packages/editor/src/common/globals.ts` - The `G` object, whose properties `Editor.init` assigns on its way up. Its shape is a declared `Globals` interface with the literal cast to it; it used to be five never-assigned `let` placeholders that existed only to carry types, which meant the literal captured five undefineds and needed an oxlint-disable to say so.
- `packages/editor/src/common/util.ts` - Pure, FD-free helpers, unit tested in `util.test.ts`. Two things worth knowing before touching them: `areArraysEquivalent(undefined, undefined)` is **false**, which `Entity`'s setters depend on by returning early on both-undefined _before_ calling; and `rotatePointBasedOnDir` has no `default` arm, so a diagonal direction returns the origin rather than throwing the way `getDirName` does. `sumprod`'s `coef` is `number | undefined` because undefined is a value there - "no weight pending" - not a missing one. A third: `duplicate` is `JSON.parse(JSON.stringify(x))`, which **throws** on `undefined` rather than answering it, so `util.duplicate(maybeUndefined) || {}` does not work - the `||` never runs. Handle the undefined before the copy; that pattern is what made `requestFromBufferChest` crash on a chest with no `request_filters` (issue #64).
- `packages/editor/src/core/factorioVersion.ts` - `getFactorioVersion(main, major, minor)`, packing a version the way Factorio does. On its own so `nameMigrations.ts` can compare versions without pulling FD into a unit test; `Blueprint.ts` re-exports it.
- `packages/editor/src/core/Blueprint.ts` - Blueprint data model, entity creation, wire connections. The constructor takes `Partial<IBlueprint>` on purpose: `PaintBlueprintContainer` builds one from just `entities` + `wires` for copy/paste, with no `version`. That is why the version checks read `data.version !== undefined && data.version < X` rather than `(data.version ?? 0) < X` - the latter would call a version-less blueprint pre-2.0 and try to parse `connections`/`neighbours` that a 2.0 paste does not have.
- `packages/editor/src/core/History.ts` - Undo/redo. `updateMap`/`updateValue` take and return `V | undefined`: undefined is a supported value meaning "delete this key", and `Action` swaps old and new on undo, so a callback can legitimately receive undefined at either end. `openTransaction` is the named invariant for "startTransaction() has run", same pattern as `PositionGrid.entityAt()`.
- `packages/editor/src/core/PositionGrid.ts` - Spatial index behind placement, overlap rules and neighbour lookups. It stores entity numbers, not entities: `setTileData`/`removeTileData` keep it in lockstep with `Blueprint.entities` via `onCreateOrRemoveEntity`, and `entityAt()` throws if the two ever drift. `isAreaAvailable`'s rail rules are **permissive by stated policy, with measured exceptions** (issue #95): the grid keys integer tiles and Factorio does not - a `curved-rail-a` is a 2x6 rectangle here holding a curve and a `half-diagonal-rail` a 2x2 square against a box spanning roughly 1.5x4.5. So it accepts more than the game does rather than modelling geometry it cannot hold, **except** where a permissive answer writes a blueprint the game will not build back - measured, not reasoned, because reasoning gets the prototype grouping backwards. The four `elevated-*` types are a **layer**, not a geometry, and are modelled properly as of issue #133: `canCollide` drops from the area everything that cannot collide with what is being placed, which is a filter that only ever removes, so every measured rule after it sees exactly what it always did. The nine rail-versus-rail arms are measured too as of #133 item 5, through `railOccupiesTheSameCells` - and that measurement found **nothing to tighten**, the only part of this function where the permissive answer was already safe everywhere. Full rules under Space Age Specifics
- `packages/editor/src/core/generators/` - Oil outpost generators (pipe, beacon, pole). Untested geometry until recently; `generators.test.ts` pins their output against a committed fixture, so a diff there means a refactor changed generated layouts.
- `packages/editor/src/core/WireConnections.ts` - Wire data model. A connection point is either `IEntityConnectionPoint` (anchored to an entity) or `ILooseConnectionPoint` (a bare position, produced only by `PaintWireContainer` for the end following the cursor). `IConnection` has two anchored ends and is what gets stored, hashed and serialized; `IDrawableConnection` is the wider type `WiresContainer.add` accepts. `hash()` sorts `cps` in place on purpose - that normalisation is load-bearing.
- `packages/editor/src/core/Entity.ts` - Wraps a raw blueprint entity. Most accessors are getters over `m_rawEntity`, and because the blueprint format has those fields optional, most of them return `| undefined` - a splitter with no priority, an assembler with no recipe. Don't "fix" one by returning `[]` or `0` instead; `tests/entity-accessors.spec.ts` pins the difference. `Entity.getItemName` is undefined for the 20 entities with no `minable.result`. The `request_filters` writers - `logisticChestFilters` and `requestFromBufferChest` - share one field and are the awkward pair: `Entity.filters` only ever sees section 0's filter list, so the rest of that object (`request_from_buffers`, `trash_not_requested`, any second section, and each filter's `quality`/`comparator`) is invisible to the model and has to be carried across by hand on every write. `tests/chest-filters.spec.ts` asserts that against the serialized output, since nothing in the model can see it.
- `packages/editor/src/core/WireConnectionMap.ts` - Stores wires twice: hash -> connection, plus an entity number -> hashes index. `get`/`getEntityConnections` throw if the two drift, same signal `PositionGrid.entityAt` gives. Note a self-connection is indexed once, not twice.
- `packages/editor/src/core/spriteShape.ts` - Narrowing helpers for the sprite unions typed-factorio models as `Base | Struct`. Deliberately does no null handling: a throw is caught by `getSpriteData` and logged, and a silent empty return would hide that. `layers` is optional on both `Sprite` and `Animation` because a value is allowed to be a bare sprite that is itself the only layer - that is what `layersOf` is for, and `dirLayers(x, dirName)` is `dirEntry` followed by `layersOf`, which is how nearly every directional read uses it. Reading `.layers` directly is what strictNullChecks flags there.
- `packages/editor/src/core/need.ts` - `need(obj, 'a', 'b')` reads a prototype field that the data always has for the types reaching the call but that typed-factorio marks optional, throwing with the field path rather than returning undefined. Used by `spriteDataBuilder.ts` and `OverlayContainer.ts`, both of which have a try/catch above them that turns the throw into a named log line and a missing sprite or overlay. Only for fields that are genuinely always present - one that is legitimately absent sometimes wants a default or a guard, since a throw costs the caller everything else it was drawing. **Before adding a `need()`, find the nearest try/catch above the read.** If there is none, `need()` is the wrong tool no matter how reliable the field looks: `TileContainer.generateSprite` is called straight from `initBP`, so a throw there loses the entire blueprint rather than one sprite - measured, and it takes the tiles that were fine down with it (issues #46 and #54). Where nothing is catching, the question is what to draw instead, and to say so in a warning that names the thing.
- `packages/editor/src/core/railSignalSnapping.ts` and `railSignalSpots.ts` - Snapping a held rail signal onto a position the game will accept (issue #133 item 2). `railSignalSpots.ts` is **generated** from `tools/oracle/fixtures/rail-signal-spots.json` by `tools/oracle/generate-rail-signal-spots.mjs` and is 152 measured placements across 38 rail orientations - regenerate it, never edit it. The snapping itself is pure and FD-free, so it is unit tested rather than driven through a browser, which is true of almost nothing else about placement. Three things worth knowing. It snaps **direction as well as position**: each spot is legal at exactly one facing, so a snap that moved the signal and left the facing alone would land it on a correct tile still pointing a way the game refuses - which is also why `R` steps around the rail's spots instead of rotating on the spot. It picks the rail with the **nearest legal spot, not the nearest rail**, which is not the same thing, since every `curved-rail-a` spot sits at least 2.1 tiles from its rail's own position. And `snapRailSignal` returns the chosen rail's key alongside the position because there used to be a second function answering that separately, with its own copy of the distance test: mutation-checking found that breaking one of the two limits left the other silently in charge, so the editor behaved identically and only the unit tests noticed. **Two limits that must agree are one limit** - the same reason `RAIL_SEARCH_WINDOW` is derived here from the snap distance and the table's own reach rather than written down in `PaintEntityContainer`, where it was a hardcoded 9 that quietly dropped every rail 4.5 to 7.5 tiles out. A search window that is too narrow fails by finding nothing, so it looks like no snap rather than like a bug. Two more numbers here are **feel** decisions that were measured by driving the editor rather than by reading it, and no passing test could have shown either, since both are about how far something moves rather than whether it is correct (issue #133 item 2, PR #143). `SNAP_MAX_DISTANCE` **is** the worst-case gap between pointer and signal - a snap radius and a yank radius are the same quantity from either end - and at its original 4 the signal sat up to 3.8 tiles from the cursor on a straight rail and 4.0 on a curve, about 390px. It is 2.5, bounded below by measurement: a snap has to still fire while the pointer is over a rail's own centre, which needs 1.58 tiles for a `straight-rail` and 2.12 for a `curved-rail-a`, so anything under 2.12 kills the curve. And the generated table is ordered **by angle around the rail**, not by `dir`/`dx`/`dy`, because that order is what `R` steps through: the old sort grouped a straight rail's two left-hand spots together, so a press from `(1.5, 0.5)` landed on the **diagonal** opposite and read as teleporting. Note `R`'s offset persists as the pointer moves around the same rail and resets only on a different rail, which is deliberate and only became predictable once the order was spatial.
- `packages/editor/src/containers/OverlayContainer.ts` - The overlay drawn on top of entities (recipe icon, fluid arrows, module and filter icons, combinator signals, splitter priority). `createEntityInfo` returns `Container | undefined` - undefined is the normal case, most entities draw nothing. `tests/overlay-container.spec.ts` pins child counts per entity, because the instance method's try/catch means a broken overlay degrades to a missing one silently.
- `packages/editor/src/containers/EntitySprite.ts` - Creates PixiJS sprites from sprite data. `getParts()` is the main entry point; `getDrawData()` builds the `IDrawData` it feeds `getSpriteData` and is split out so `tests/sprite-data.spec.ts` can digest generated sprite data without loading textures. `getDrawData` is also where `IEntityData`'s optional fields get their defaults - `dir ?? 0`, `generateConnector ?? false`, `modules ?? []` - because `IDrawData` keeps those required so the draw functions can do plain arithmetic. Only `PaintEntityContainer` reaches them; everything else passes an `Entity`, which supplies every field. `getParts` skips falsy entries in the sprite list and assigns `zOrder = i` from the pre-skip index, so a generator that stops emitting an `undefined` placeholder shifts every later `zOrder` down by one - harmless, since `compareFn` only ever compares them relatively.
- `packages/editor/src/containers/BlueprintContainer.ts` - Main rendering container. `spawnPaintContainer()` handles entity placement from inventory. `hoverContainer` and `paintContainer` are both `| undefined` - they are absent in most modes and are assigned undefined to clear them - but nearly every read is behind a `mode === EditorMode.EDIT`/`PAINT` check that already implies the matching one exists, which TypeScript cannot see. Read those through `hovered`/`painting`, which throw naming the invariant; read the fields directly only where absence is the real answer, as `Editor.ts` and `OverlayContainer` do with `?.` and `!== undefined`.
- `packages/editor/src/containers/EntityContainer.ts` - Per-entity container, calls `EntitySprite.getParts()` in `redraw()`. `containerOf(entityNumber)` is the lookup for callers holding a live entity - `initBP` builds a container for every entity, the constructor is the only write and that entity's `destroy` the only delete, so a miss means drift and it throws, same signal as `PositionGrid.entityAt()`. The `mappings` map itself stays public for the lookups where absence is a real answer, such as `OverlayContainer` asking about `entityForCopyData`, which outlives its entity. The map is static, and each container now removes its own entry on its `BlueprintContainer`'s `destroyed` - but only where the map still points at itself (issue #42). That identity check is load-bearing: `Editor.loadBlueprint` runs the incoming blueprint's `initBP()` _before_ destroying the outgoing container, so the new containers have already claimed the entity numbers the two share, and a blanket `clear()` would delete the entries just written. `cursorBox` takes `keyof CursorBoxSpecification | undefined`, where undefined removes the box; that is what every hover-out and copy/delete mode exit sends.
- `packages/editor/src/core/throughput.ts` - Belt and inserter items/s for the info panel, moved out of `EntityInfoPanel.ts` so it could be tested at all. Only `beltThroughput` is exact - it reproduces Factorio's published 15/30/45/60 from `speed` alone, which is the one external check in the file. The inserter ones are the editor's own approximations and run a little high (a fast inserter's real chest-to-chest rate is nearer 2.31/s than the 2.4 this gives), because the model counts swings and the game also spends ticks picking up and dropping. `beltToContainer` is deliberately a **bound**, `min(swing rate, belt rate)`, not a curve: both ceilings are real, and saying where between them the truth sits would mean measuring the game.
- `packages/editor/src/UI/InventoryDialog.ts` - Inventory panel (press E). Filters items by what's in FD.entities. Also the item picker a filter slot opens, via `G.UI.createInventory` with an `itemsFilter` - in that mode it stacks as a second dialog on top of the editor that opened it and closes itself on a pick.
- `packages/editor/src/UI/editors/factory.ts` - `createEditor` maps an entity name to its dialog, answering `undefined` for the many entities that have none. That undefined is the normal case, not a failure; the sole caller is already an `if (editor)`. Adding an entity here is what makes its editor reachable at all - the chest one sat commented out for two releases (issue #87).

### Sprite Data Patterns (in spriteDataBuilder.ts)

Common patterns for `draw_*` functions:

| Pattern                | Description                                                                | Example                               |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------- |
| Static layers          | `return () => e.picture.layers`                                            | `draw_container`                      |
| 4-way animation        | `return (data) => getAnimation(e.graphics_set.animation, data.dir).layers` | `draw_burner_mining_drill`            |
| Direction-indexed      | `return (data) => e.sprites[util.getDirName(data.dir)].layers`             | `draw_constant_combinator`            |
| X-offset sheet         | `duplicateAndSetPropertyUsing(layer, 'x', 'width', data.dir / 4)`          | `draw_electric_pole`                  |
| Y-offset sheet         | `duplicateAndSetPropertyUsing(layer, 'y', 'height', data.dir / 4)`         | `draw_ammo_turret`                    |
| Multi-file (filenames) | `l.filename = l.filenames[data.dir / 4]`                                   | `draw_locomotive`, `draw_cargo_wagon` |
| Rail 8-way             | `e.pictures[util.getDirName8Way(dir)]` then pick layer keys                | `draw_rail`                           |
| Flatten picture array  | `e.graphics_set.picture.flatMap(p => p.layers)`                            | `draw_cargo_bay`                      |
| Chargable graphics     | `e.chargable_graphics.picture.layers`                                      | `draw_accumulator`                    |

### Space Age Specifics

- **Multi-file sprites**: Space Age entities (especially foundry) use `filenames: string[]` instead of single `filename`. `EntitySprite.getParts` handles this with a `filenames[0]` fallback.
- **Non-directional pipe_picture**: Foundry's `pipe_picture` is a single sprite object, not a `{north, east, south, west}` map. `spriteDataBuilder.ts` handles this with a fallback.
- **Signal types**: Space Age adds `space-location`, `asteroid-chunk`, `quality` signal types beyond the base `item`, `virtual`, `fluid`, `recipe`, `entity`.
- **Array-form base_visualisation**: Some Space Age turrets (tesla-turret) have `graphics_set.base_visualisation` as an array instead of a direct object. `draw_electric_turret` handles both formats.
- **Blueprint validation**: Made lenient to handle Space Age content. Unknown entity names are stripped; other validation failures (unknown signals, new enum values) are logged as warnings but don't block loading.
- **An empty list in `data.json` is `{}`, not `[]`.** The exporter writes Lua tables out as JSON and an empty Lua table cannot say whether it was a list or a map, so it encodes as an object. A field typed `readonly X[] | undefined` therefore has a third runtime shape that is neither - and `{}` survives a `!== undefined` guard and a `?? []` untouched, then throws "is not iterable" in the first `for-of` downstream. Read such fields through an `Array.isArray` accessor, not `?? []`. `recipeIngredients`/`recipeResults` in `factorioData.ts` are the ones that exist so far: `recipe-unknown` and `biter-egg` hold `{}`, and the ten `parameter-N` placeholders a parametrised blueprint uses omit both fields. Assume any other list-typed prototype field can do the same, and probe `data.json` before trusting the type.
- **`localised_name` is already resolved in `data.json`.** typed-factorio types it as `LocalisedString`, the nested form Factorio resolves at runtime (`['item-name.iron-plate']`), but the exporter resolves it first, so all 1352 in the current output are plain strings. That difference is only a type error at the one site that assigns it to a pixi `Text`; the sites that interpolate it into a template literal compile and would silently render `[object Object]` for any other shape. Read it through `localisedName()` in `factorioData.ts`, which joins the nested form rather than dropping it, so one that ever does arrive looks wrong on screen instead of vanishing.
- **`draw_*` functions that switch on `e.name` need a `default`**: falling off the end returns `undefined`, and `getSpriteData` then calls it, so the entity fails with `graphicsFn is not a function` - which names neither the entity nor the real problem, and is swallowed by the try/catch into a placeholder box. Throw instead, naming the entity. `draw_mining_drill` had this and `big-mining-drill` rendered as an unknown entity for it (issue #29). Switching on `e.name` at all is a Space Age hazard: the DLC adds new members to existing entity types.
- **`always_draw` working visualisations come in two shapes**: directional (`north_animation` and friends, absent for facings the visualisation does not apply to) and a single non-directional `animation` drawn the same whichever way the entity points. Read `vis[animDir] ?? vis.animation` - reading only the directional key silently drops the second kind, which cost `big-mining-drill` its drill head and scorch mark. The `??` order matters: a directional entry that omits the current facing must stay dropped, not fall back.
- **`EnergySource` is a discriminated union on `type`, but `getEnergySource` can also answer `undefined`,** and `undefined` has no `type` for the check to narrow through. `if (es.type === 'heat')` therefore narrows nothing and `.connections` / `.pipe_covers` stay unreadable - the guard has to be `if (es && es.type === 'heat')`.
- **The same layer key is not uniformly present across a family of entities.** Ground rails carry all five picture layers for every non-empty direction; elevated rails have no `ties`, `rail-ramp` has no `backplates` or `metals`, and `heating-tower` is a reactor with no `lower_layer_picture`. So `draw_rail` can use `need()` and `draw_elevated_rail` has to filter - probe `data.json` per entity rather than per type.
- **Rail placement rules do not group the way the prototype names do.** The same warning one level up: `isAreaAvailable` sorts rails into straight, half-diagonal and curved, and for the question "may a signal sit on this rail's own tiles" that grouping is **wrong in both directions**. Measured across every orientation of every type (`tools/oracle/fixtures/rail-placement.json`): `straight-rail`, `half-diagonal-rail` and `legacy-curved-rail` have no legal signal position overlapping their tiles, while `curved-rail-a` has one per orientation, `curved-rail-b` two or three, and `legacy-straight-rail` one at each of its four **diagonal** orientations and none at its cardinals. So a legacy straight rail behaves like a curved one here and a legacy curved rail like a straight one. Gates split by orientation rather than by prototype: a `straight-rail` takes one only at directions 0 and 4, a `legacy-straight-rail` at all six of its orientations, a `half-diagonal-rail` at none. Ask the oracle per prototype and per direction; do not generalise from one of either.
- **"Which tiles does this entity occupy" is not a property of the entity.** Collision is continuous and tiles are not, so the answer depends on the size of the box being asked about - measured, a `small-electric-pole` fits on cells a `wooden-chest` is refused on and a `transport-belt` is refused on cells the chest is not, over 28 and 24 of 38 rail orientations. That is why `PositionGrid`'s rectangle cannot simply be replaced by a per-rail cell set, and it generalises past rails: any future "occupancy shape" work has to name the reference size it is calibrated for. See `tools/oracle/fixtures/rail-occupancy.json`
- **Rail direction normalisation is per prototype, and the modulus is load-bearing in both directions.** How many orientations the game keeps is not uniform: `straight-rail` and `half-diagonal-rail` fold mod 8 down to four, the three curved types keep all eight, and `legacy-straight-rail` keeps **six** - it folds 8 to 0 and 12 to 4 while leaving 10 and 14 distinct from 2 and 6. The four elevated types fold exactly as their ground namesakes do. So a blanket `direction % 8` conflates two legacy orientations the game separates, and dropping it entirely conflates nothing but stops catching a straight rail rotated to direction 8 over one at 0 - which is reachable, since `getPossibleRotations` gives every rail `[0,2,4,6,8,10,12,14]` while the game stores only four of them. Measured over all sixteen directions of all ten prototypes in `tools/oracle/fixtures/rail-on-rail.json`. And the discriminator for whether two rails may share tiles is **not** the prototype name: two _cardinal_ 2x2 rails fill their shared tiles completely whichever prototypes they are, so `legacy-straight-rail` at 0 may not go on `straight-rail` at 0, while the same pair at a _diagonal_ orientation is accepted
- **The elevated rails are a collision layer, not a geometry, and the list of what they collide with is short and specific.** All four carry `collision_mask = {layers={elevated_rail=true}}` and nothing else, so they pass over every ordinary ground entity - which is why a placement rule keyed on tiles alone refused the one thing an elevated rail is for. What they _do_ collide with is everything else carrying that layer: `rail-ramp`, and about a dozen tall buildings. That list is keyed by **name and not by type** - `oil-refinery` carries it and no other assembling machine does, `big-electric-pole` does and no other pole does - so a type key refuses far more than the game. `rail-support` deliberately does **not** carry it, since a support holds a rail up and must overlap one. Measured in `tools/oracle/fixtures/elevated-rail-collision.json`, and note `data.json` does **not** export `collision_mask`, so the editor's copy of this list is hardcoded in `PositionGrid.ts` and has to be re-derived from the fixture rather than read at runtime.

## Asking the real game (tools/oracle/)

When the editor has to agree with Factorio and the answer is not in the data,
ask the game rather than reasoning about it. `tools/oracle/` runs the real binary
headless - a throwaway mod imports a blueprint string with `import_stack`, dumps
`get_blueprint_entities()` as JSON and `error()`s out - against an isolated
config so it never touches the real install. See its README for the gotchas;
the method is borrowed from `/Users/ericjohnson/GitHub/FactorioMapWebUI/test/oracle/`.

**Try the sources in this order**: the Lua prototypes in
`github.com/wube/factorio-data` (a git tag per release - check out the version
you target, not the newest), then the oracle, then the unstripped binary. Most
questions stop at the first. Grep the **definition site**
(`name *= *"<thing>"`), not a bare name.

Fixtures live in `tools/oracle/fixtures/` and carry their provenance, including
the binary version they came from - the installed game is 2.1.12 while this
editor targets 2.0.45 to 2.0.73, so a capture is evidence about 2.1 unless
stated otherwise. Never hand-edit a fixture to make something pass; a mismatch is
a finding. Nothing under `tests/` needs Factorio - the committed fixtures do the
asserting, so CI stays offline.

What it has settled so far: a `LogisticSection` at `index: 0` makes the **whole
blueprint string fail to import** (issue #91), which is why both pre-2.0 shape
migrations in `Blueprint.ts` number from 1. And that a settings copy between two
locomotives carries the **schedule** - records, interrupts and group - replacing
whatever the target was on, and **clearing** it when the source has none (issue
#115). That last one is the case no successful-paste test can see.

Two things the schedule probe added to the method, both in its README: `help()`
is gone in 2.1, and the install's own `doc-html/runtime-api.json` is a better
source than either it or `strings`; and a probe wants a control for **itself**,
not only for the behaviour - `create_blueprint` merges a train's locomotives into
one `schedules` entry unprompted, so without a no-copy case that merge would have
read as a successful copy.

And the rail placement rules behind `isAreaAvailable` (issue #95), which is the
case where reasoning would have produced the wrong answer twice. A signal has
**4 legal positions per rail**, 5 on `curved-rail-b` and only 2 on a
`legacy-straight-rail` at a diagonal, each at one fixed direction - 152 across
the 38 rail orientations, complete table in
`tools/oracle/fixtures/rail-signal-spots.json`. Whether any of them lands on the rail's own tiles splits **per
prototype and not by the straight/curved grouping the editor uses**:
`straight-rail`, `half-diagonal-rail` and `legacy-curved-rail` have none, while
`curved-rail-a`, `curved-rail-b` and `legacy-straight-rail`-at-a-diagonal do.
Gates go on a straight rail only at its **cardinal** orientations - 128 accepted
placements each at directions 0 and 4, zero at 2 and 6 - and on a half-diagonal
rail at none of its four. See `tools/oracle/fixtures/rail-placement.json`.

**One number in that fixture is incomplete, and the way it was found is the
lesson.** It swept a **+/-3 tile window**, and `legacy-curved-rail`'s legal
signal spots reach 3.5, so it lost one or two of the four at every orientation
and reported 2 or 3. Re-measured at +/-7 (`rail-signal-spots.json`, issue #133
item 2), which sweeps every orientation at **both** window sizes so that the
control is "does a wider window find anything the narrower one missed" - it does,
16 sweeps of 76, all of them `legacy-curved-rail`. The rule built on the clipped
number, `canHoldASignalOnItsTiles`, was re-checked against the complete table and
**agrees on all 38 orientations**, because the missing spots sit outside the
rail's rectangle too. The conclusion was right and the number under it was not,
which is only knowable by re-measuring. A sweep window is part of the answer,
the same way a probe entity is.

That complete table is the one the editor ships, generated into
`packages/editor/src/core/railSignalSpots.ts` and used to **snap** a held signal
onto a position the game accepts - #133 item 2 as rescoped, after the original
"make the arm exact" was costed and found to make signals close to unplaceable
on its own. And the sweep-window lesson repeated itself one level up, in code
rather than in a probe: `PaintEntityContainer` searched a hardcoded 9-tile window
for rails before asking the snapping module, which applies its own 4-tile limit,
and 9 is too narrow for a rail whose spots reach 3.5 - so the outer number was
silently in charge and a mutation deleting the inner one changed nothing a
browser could see. The window is derived from the limit and the table now. **A
bound you write down twice is a bound you have to keep in sync**, and the one
that loses is the one nothing tests.

Four more additions to the method from that probe, all in its README, and the
last three are the same lesson: **the control tells you the question is wrong,
not just the answer**.

- `can_place_entity` means different things per `build_check_type`.
  `blueprint_ghost` skips rail adjacency entirely, so a signal ghost is legal on
  bare grass - 2704 of 2704 against 0 for `manual`.
- Ghosts are **not** a placement test. Reviving one of two overlapping ghosts
  destroys the other whether or not the layout is legal, so a legal
  gate-on-a-rail lost an entity exactly like an illegal one. That whole
  measurement was built and thrown away.
- Then asking about the one direction the blueprint carried gave a false negative
  on the same control, because that direction was parallel to the rail. Sweeping
  all sixteen turned it into 8 against 0.
- Entities **snap**, so a requested position is not a measured one: 16 raw
  acceptances around a straight rail are 4 real signal positions.

And what a rail actually occupies (issue #133 item 1,
`tools/oracle/fixtures/rail-occupancy.json`), which **inverts that item's
premise and is the reason not to start writing it**. Occupancy was measured
operationally - a cell is blocked if the game refuses a 1x1 centred on it while
the rail stands - against four different 1x1 references, and they do not agree:
a `small-electric-pole` (0.3x0.3 box) fits on cells a `wooden-chest` (0.7x0.7)
is refused on, a `transport-belt` (0.8x0.8) is refused on cells the chest is
not, and a `gate` - **smaller** than the chest - is legal on all four cells of a
cardinal straight rail, which no size argument explains and which is the
rail-gate rule. So "which tiles does this rail occupy" has no single answer, and
one occupancy shape per rail cannot be correct however carefully it is chosen.
`rail-signal` cannot be measured this way at all and is excluded by its own
control, being refused on empty ground everywhere. Two further findings: the
editor's rectangle is wrong in **both** directions and **under**-reporting
dominates - 34 of 38 orientations block a cell it does not key against 28 that
key an empty one, a diagonal `straight-rail` really blocking 8 cells where it
keys 4 and a `half-diagonal-rail` 12 where it keys 4 - and the game publishes
`tile_width`/`tile_height` that the exporter emits for only 3 of 155 entities,
which disagree with the computed rectangle for every curved type
(`curved-rail-a` 2x4 against 2x6, `curved-rail-b` 2x2 against 2x5,
`legacy-curved-rail` 4x8 against 4x4) - **and that last observation is a trap,
which #142 walked into and then measured its way back out of**; see below.

And which rail may be laid across which (issue #133 item 5,
`tools/oracle/fixtures/rail-on-rail.json`), the first measurement those nine
arms had ever had. The headline is a **negative**: across 1444 ordered pairs of
(type, orientation) there is not one where the editor allowed and the game
accepts no overlapping placement, so nothing needed tightening - the only part
of `isAreaAvailable` where the permissive answer was already safe everywhere.
All 84 disagreements ran the other way, and 60 of them were closed by comparing
the prototype and the **normalised** direction instead of family and `% 8`. Two
method notes came out of it, both in the probe README: a control has to be able
to fail while the hypothesis holds (the first one here was a restatement of the
hypothesis and "failed" by announcing the finding), and a proposed rule should
be transcribed into the probe and checked against every measured row before any
code is written - the first draft of this fix produced four corruption-class
rows that the re-run caught in eight seconds and no test would have suggested.

And what an elevated rail collides with (issue #133 item 4,
`tools/oracle/fixtures/elevated-rail-collision.json`), which added three more:

- **Ask the cheapest question that settles the thing.** The #95 probe skipped the
  elevated rails because placing one needs rail supports and it was asking a
  placement question. The question underneath was **collision**, and
  `collision_mask` needs nothing placed at all - it is a read off the prototype
  table. Two probes' worth of setup disappeared.
- **`create_entity` and `can_place_entity` disagree, and the gap is buildability
  rather than collision.** `create_entity` built an elevated rail on bare ground
  with no support beneath it; `can_place_entity` refuses one everywhere for
  exactly that reason, so the over-a-chest sweep came back 0 accepted against a
  0/8 empty-ground control and **voided its own section**. The entity it created
  was still standing, which is what let the other direction be measured. Record a
  section its control voids rather than reading the zeros as a finding.
- **Version-stamping earned its keep for the first time.** Cross-checking the
  2.1.12 dump against the Lua at the 2.0.73 tag turned up one real difference:
  `cargo-bay` is `building_tall()` at 2.0.73, which carries the elevated layer,
  and plain `building()` at 2.1.12, which does not. Every other entry agreed. The
  editor targets 2.0.x, so the code lists it and says why.

And what holds an elevated rail up (issue #141,
`tools/oracle/fixtures/elevated-rail-support.json`), measured and then **not**
implemented. The rule is a **load path, not a distance**: a rail is buildable iff
it rests on a `rail-support` or `rail-ramp` or connects through elevated rails
_that already exist_ back to one, within `support_range` - 11 on a support, 9 on
a ramp, and identical at the 2.0.73 and 2.1.12 tags, so it transfers. One spot
five tiles out, inside range throughout, answered refused/accepted/refused/accepted
as the rails between it and the support were built, removed and replaced; distance
cannot explain four answers to one spot. Three reasons it stays unimplemented, and
the second is the transferable one: the exact rule needs a rail connectivity graph
(harder than the occupancy work #138 abandoned); the cheap permissive
approximation **cannot be implemented where the check lives**, because paste
iterates entities in the source blueprint's order and real exports interleave
supports after the rails they hold - radius 11 refuses 1005 of 5922 corpus rails,
and radius _1000_ still refuses 38, so no radius fixes an order dependency (#150);
and the reachable failure is nearly empty, 0 of 5922 corpus rails lacking a
support. Two more method notes, both in the probe README. **A probe entity's own
lattice is part of the question** - a support placed at the rail's own coordinates
produced profiles byte-identical to no support at all across 16 orientations and
16 distances, a clean and confident and wrong finding, caught not by more probing
but by decoding a real export and seeing that a support sits _between_ rails, only
16 of 64 parity/orientation combinations being functional. And **"how far apart"
has two answers when the thing is built incrementally**: a hand walk breaks at 14
tiles, a finished line is legal to 20, and a blueprint is the second - the corpus
spaces supports at exactly 20, so measuring only the walk would have produced a
rule refusing every real elevated bridge.

And what footprint the game publishes for every entity (issue #142,
`tools/oracle/fixtures/entity-tile-size.json`), which **refutes the change it
was capturing evidence for** - the second measurement here to end in "do not
implement", and the first taken on a **2.0.x** binary rather than on 2.1.12. The
issue was "make the editor's footprints agree with the game's own
`tile_width`/`tile_height`". They already agree for 146 of 155 entities. The 9
that differ are the six curved rail types, their two `dummy-` variants and
`rail-ramp`, and for **8 of those 9 the published rectangle does not contain the
entity's own collision box** - `curved-rail-b` is 2x2 against a box 4.88 tiles
tall, `rail-ramp` 2x16 against a box 3.6 wide. The reason is in the runtime
docs, one line that settles the whole issue: `tile_width` "is used to decide, if
the center should be in the center of the tile (odd tile size dimension) or on
the tile border (even tile size dimension)". It is a **centring parity, not a
size**, and it coincides with the enclosing rectangle for the 146 only because
most entities are boxes. **A field whose name reads like a size is not therefore
a size** - and this one is already read as one, at `factorioData.ts:598`, where
it is load-bearing and correct for exactly two entities (`offshore-pump`
declares 1x1 where the fallback computes 2x2, `train-stop` 2x2 where the
fallback computes 1x1).

Transcribing the proposed rule into the analysis and checking it against
`rail-occupancy.json` **before writing any code** - the #133 item 5 lesson,
which has now paid twice - says adopting the numbers makes agreement with
measured occupancy worse in **both** directions across all 38 measured
orientations: occupied-but-not-keyed 180 -> 188, keyed-but-empty 96 -> 152.
`curved-rail-a` improves by 2 cells of 11, and that is the whole of the upside;
`curved-rail-b` drops from 10 keyed cells to 4 against 14 really blocked, and
`legacy-curved-rail` doubles to 32 keyed against 18. Since the footprint is also
what `getEntityAtPosition` reads, the price is half of `rail-ramp` becoming
unclickable. The real fix for the curved rails is still per-rail measured cell
sets, which is #133 item 1 and was costed and abandoned as #138.

Three method notes, all in the probe README:

- **A mod's `factorio_version` must match the binary**, and every probe before
  this one hardcodes `2.1` - correct only because 2.1.12 was the only Factorio
  on the machine. A mismatch is silent: the mod is skipped, no dump appears, and
  the failure names nothing. `probe-entity-tile-size.mjs` derives it from
  `factorio --version`, which is the whole of what it takes to make the targeted
  2.0.x range measurable. Copy that, not the string.
- **Read what the docs say a field decides, not what its name suggests.** This
  probe's own instrument control - the three entities that declare `tile_width`
  at the data stage must read back the same number at runtime - passed
  perfectly, because the field is being read correctly. It was the right control
  and it could not have caught this. What caught it was one sentence of prose.
- **The version cross-check found something again**, and again it did not
  matter: four entities move footprint between 2.0.77 and 2.1.12 (`tree-plant`
  and the three demolisher corpses), none of them among the 155.

## Cloudflare Deployment

The editor is deployed to Cloudflare Workers at https://fbe.factorygamefan.com (custom
domain). The legacy workers.dev URL (https://fbeworkeyman.wormeyman.workers.dev) stays
enabled and 301-redirects to the custom domain, preserving path and query string
(redirect logic in `packages/worker/src/index.ts`). The custom domain is declared as a
`custom_domain` route in `packages/worker/wrangler.jsonc`; `workers_dev: true` keeps the
old URL live so the redirect can run.

```fish
# Build the website first (from packages/website/)
vp build

# Deploy to Cloudflare (from packages/worker/)
cd /factorio-blueprint-editor/packages/worker && npx wrangler deploy
```

The worker uses `run_worker_first` with an `ASSETS` binding to serve static files from the Vite build output (`packages/website/dist`). A `/corsproxy?url=` fetch handler proxies requests to external services (factorio.school, pastebin, etc.) for loading blueprints, adding CORS headers.

To authenticate with Cloudflare (first time or expired session):

```fish
cd packages/worker && npx wrangler login
```

## Version Constraints

The four things a dependency audit needs before it can say anything useful, and
the reason a bare `npm outdated` here is misleading. Everything below was
measured on 2026-07-29; re-derive rather than trust, since the circumstance that
justifies a hold expires without anyone editing this file.

### Held on purpose

- **`typed-factorio` stays on 3.x.** Not neglect - upstream publishes a
  **dedicated `factorio-2.0` dist-tag** pointing at exactly the version this
  project runs: `npm view typed-factorio dist-tags` gives
  `{latest: 4.2.0, factorio-2.0: 3.36.0}`. The mapping is in package metadata
  (`npm view typed-factorio@<v> factorioVersion`): **3.36.0 describes Factorio
  2.0.75, 4.2.0 describes 2.1.9**. The 3.x line is also the more recently
  published of the two. Issue #155 targets 2.0.77, which keeps this on the 3.x
  side - if it lands, look for a 3.37.x tracking 2.0.77, **not** v4. Note it is
  consumed as ambient types via the tsconfig `types` array, with zero `import`
  sites, so a major would change global types everywhere at once with nothing to
  stage the migration through.
- **basisu v1.16.4** encoder/transcoder must match - bundled transcoder at
  `packages/editor/src/basis/transcoder.1.16.4.js`. Newer basisu (v2.10 exists)
  brings HDR and ASTC codecs this project has no use for, and a bump re-encodes
  all 8776 tracked `.basis` files. Blocked behind #155's unanswered question of
  whether basisu encoding is deterministic - that decides whether the diff is
  reviewable at all.
- **Current basisu binary** is macOS ARM64 (`packages/exporter/basisu`);
  `setup.rs:501` hardcodes `"./basisu"` with no `cfg(target_os)` switch, and
  there is **no Linux binary at all** since `354ad057`, so the exporter cannot
  encode sprites on `ubuntu-latest`.
- **`.npmrc` sets `legacy-peer-deps=true`** and it is load-bearing, not laziness:
  `typed-factorio` declares non-optional peers on `lua-types` and
  `typescript-to-lua`, and `typescript-to-lua` pins `typescript: "6.0.2"`
  **exactly** against this project's 7.0.2. v4 declares the same peers, so
  upgrading would not fix it. It silences every peer conflict in the tree,
  including future real ones - re-test at each `typed-factorio` bump.

### Coupled - these move together or not at all

- **`vite-plus` 0.2.6 pins the whole toolchain.** Vite, Rolldown, oxlint, oxfmt
  and Vitest are **not independently upgradable** - there is no `vite` package in
  the tree at all, the root `overrides` aliases it
  (`"vite": "npm:@voidzero-dev/vite-plus-core@0.2.6"`). So "bump vitest" has no
  answer except "bump vite-plus". **0.2.6 is `latest`, not a lagging pin.**
- The pin appears in **five** places that must move as one: root, editor and
  website `package.json`; the root `overrides`; and
  `.github/actions/setup-vp/action.yml`, which carries both `VP_VERSION`, a cache
  key, **and a sha256 of the installer script** - the part people forget.
- **`@playwright/test`** needs `npx playwright install` in the same commit as any
  bump, or every spec fails on a missing `chrome-headless-shell` and reads as a
  suite-wide regression.

### How updates actually get applied

npm workspaces. `npm update --save` for the routine pass (`d0971109`), carets
preferred over exact pins (`a5a20c04`). Anything proposed has to be expressible
that way. **The gate is `vp check` + `vp test` + `npx playwright test`**, and the
Playwright half needs both dev servers up via `npm run localpreview`.

Dependabot is configured for **npm and github-actions only**
(`.github/dependabot.yml`) - there is **no `cargo` entry**, so the Rust exporter
gets security alerts but no version updates, and it has drifted accordingly.

### Settled - do not re-raise without new information

- **`pathfinding` (last published 2016) stays.** Its output is pinned by
  `generators.test.ts` against a committed fixture, so swapping it is a "did the
  oil outpost generator change?" question rather than a dependency change. No
  CVE, no network or parsing surface - the risk is bus-factor. If it ever moves,
  vendor the BFS and prove it against the existing fixture.
- **`npm audit` is 0.** Measured, not assumed.

### Known and unfixed

- `packages/worker/wrangler.jsonc` `compatibility_date` is **2026-03-01**, five
  months stale. Every flag that has defaulted on since is inert for a worker that
  only does a 301 and a CORS proxy, so this is hygiene rather than risk.
- ~~Three declared-but-unused dependencies~~ - **removed**, and the way they were
  found is the reusable part: Renovate proposed an update for each, which is what
  surfaced that nothing imported them. A dependency bot is a census as much as an
  upgrade tool. `@types/delaunator` went because delaunator ships its own
  `index.d.ts` and the bundled types are _more_ precise under `strict` - `vp check`
  staying at 0 after the removal is the proof, not an assumption. `http` and
  `tokio-stream` had **0** occurrences of `http::` and `tokio_stream` in
  `packages/exporter/src/`; both remain in `Cargo.lock` as transitives of reqwest
  and hyper, so only the two direct-dependency lines went.
- **The Rust exporter is compiled in CI but never run**, and the gap between those
  two is the thing to know. The `Rust exporter` job in `.github/workflows/ci.yml`
  runs `cargo build --locked` on `ubuntu-latest`; `--locked` is the load-bearing
  flag, since it fails when `Cargo.lock` disagrees with `Cargo.toml`, which is
  exactly what a dependency PR can get wrong. Compiling needs neither Factorio nor
  basisu - `./basisu` is a runtime `Command::new` at `src/setup.rs:501`, there is
  no `build.rs`, and no dependency is platform-gated. **Running** it needs both, and
  the tracked basisu binary is macOS ARM64 only, so a crate that changes runtime
  behaviour without breaking the build passes green. Anything touching image, zip,
  tar or compression handling still wants a local run on macOS.
- `ajv` is ~100 kB minified and **nothing branches on its result** - the load
  proceeds identically either way, and `ModdedBlueprintError` /
  `TrainBlueprintError` are declared, exported, handled, and never thrown. Decide
  what blueprint validation is _for_ before optimising it.

## Playwright Blueprint Diagnostics

Automated tests that load blueprint `.txt` files from `wormeyman-tests/` against the running dev server, capture console warnings/errors, and generate diagnostic reports.

**Structure:**

- `playwright.config.ts` - Config (base URL localhost:8080 unless `FBE_BASE_URL` is set, 120s timeout, single worker)
- `tests/blueprint-loading.spec.ts` - Main test file - iterates blueprints, uses `window.__fbe_test` API to load directly
- `tests/position-grid.spec.ts` - Exercises `PositionGrid` queries and the setTileData/removeTileData round trip against a real loaded blueprint (the class is core to placement and cannot be unit tested without FD data loaded)
- `tests/rail-placement-rules.spec.ts` - What `isAreaAvailable` answers for a signal or a gate dropped on a rail (issue #95). The corpus cannot reach any of it: `isAreaAvailable` is only called from the paint containers, so every answer needs hand placement, and the 578 real exports were all legal when the game wrote them. What the tests are really shaped around is that **the positive cases carry as much weight as the negative ones** - a fix that simply refused every signal on every rail passes the "refused" test and fails the "still allowed" one, and mutation-checking found that both directions matter, since six separate mutations each fail exactly one test. Two expectations are ones reading the code would get backwards, both measured: a `legacy-curved-rail` refuses a signal on its tiles where `curved-rail-a` accepts one, and a `legacy-straight-rail` accepts one at its diagonal orientations where `straight-rail` never does. The last test pins the arms that stay **permissive on purpose** so that narrowing them is a decision rather than a side effect of tidying the rule next door. Two more tests cover **rail on rail** (#133 item 5), and they are a matched pair rather than two independent tests - the tempting fix, "allow whenever the prototypes differ", passes the first and fails the second, because two _cardinal_ 2x2 rails fill their shared tiles whichever prototypes they are while the same pair at a _diagonal_ orientation does not. Mutation-checked five ways; the two that catch the tempting mistakes are name-only matching and dropping the direction normalisation, and each kills exactly the guard test. One expectation in the guard test is a refusal the game would allow - an identical curved rail at an identical direction, the 24 rows left for #133 item 1 - pinned so that closing it is a decision
- `tests/elevated-rail-placement.spec.ts` - What `isAreaAvailable` answers around the four `elevated-*` types (issue #133 item 4), which it never named, so they fell to `default:` and read as ordinary obstructions in both directions. Worth knowing why this is reachable at all, since the obvious route is not: **no item places an elevated rail** - nothing in `data.json` has one as its `place_result` and the rail planner gives `straight-rail` - so the inventory cannot reach it and pipetting one hands back a ground rail. It is reached through `PaintBlueprintEntityContainer`, which asks about every entity of a **pasted** selection, and from the other side by hand-placing anything under an elevated rail a loaded blueprint brought with it. The refusals carry as much weight as the acceptances: a fix that ignored elevated rails entirely passes the first test and fails the next two. Two of the tests are shaped by mistakes that would otherwise look right - the collider list is keyed by **name**, so it pins a `big-electric-pole` refused beside a `medium-electric-pole` accepted, and `canCollide` is asked about the **ground** entity of the pair, so reading the placed one instead is caught only by the paste direction. The last test involves no elevated rail at all: the filter only ever removes, and a mistake that removed too much would quietly turn the whole function into "always true"
- `tests/rail-signal-snapping.spec.ts` - That `PaintEntityContainer` actually calls the snapping (issue #133 item 2). The arithmetic is unit tested in `packages/editor/src/core/railSignalSnapping.test.ts`, which is pure and FD-free; what needs a browser is the wiring, and there is no other way to see it - a paint container's position and facing are invisible until the entity is placed, by which point a wrong snap and a missed click look identical, which is what the `paintContainerState` hook is for. Reached by pipette (`Q`) over an existing signal, the same route `editor-mode-input.spec.ts` documents. Three things this spec was shaped by, each of which cost a run. Every expectation is an **offset from the rail**, never an absolute position, because loading re-centres a blueprint - use the `entityPosition` hook rather than the coordinates you encoded. The zoom is **derived** from two entities a known distance apart rather than hardcoded, since the editor picks it from the blueprint's bounds. And the last test - the control, a signal far enough out to be left under the cursor - moves **sideways six tiles** for two separate reasons: diagonally it leaves the canvas, where the paint container is _hidden_ rather than moved and reports its last snapped position; and six is chosen to sit inside the rail search window and outside the snap distance, so the rail is found and then rejected on distance. Aim further and the window rejects it first, which passes for the wrong reason - that is exactly what happened while the window was a hardcoded 9, and it left a mutation removing the real distance limit invisible to the whole suite
- `tests/rail-footprints.spec.ts` - Which tiles the position grid hands each rail, and so which tiles **select** it (issue #142). Written deliberately _before_ the change it was to guard - **and that change is not coming**, because measuring it refuted it (see the #142 paragraph under Asking the real game). So it is now a fixed point guarding footprints that are staying put, which is the more useful thing for it to be. It matters because the footprint is not only a placement rule: `getEntityAtPosition` reads the same cells, so a `legacy-curved-rail` going 4x4 -> 4x8 doubles the area that selects it and a `curved-rail-a` going 2x6 -> 2x4 shrinks it, and **nothing else in the suite can see either** - every other spec hovers an entity's _centre_, which selects it whatever its size, so a footprint change would land green with users simply finding rails harder or easier to click. Mutation-checked with what was then the expected future change (forcing `curved-rail-a` to the game's 2x4), which moves 12 cells to 8 and leaves `elevated-curved-rail-a` alone. Two non-rails are in the fixture as controls, so a change that hit everything rather than rails says so. A fixed point, not a refreshable snapshot - and note it needs no pointer, no rendering and no viewport, reading the grid straight off a decoded blueprint the way `position-grid.spec.ts` does, which makes it the one piece of placement coverage that cannot go intermittent
- `tests/viewport-transform-freshness.spec.ts` - That a screen position read straight after a load is the real one (issue #144), which is the root cause of a flake that had made pointer specs fail intermittently for months. `Viewport.centerViewPort` computed the new scale and position and set a **dirty flag**, leaving the matrix itself to be rebuilt by `update()` on the render ticker - so `getTransform()` answered the matrix from _before_ the blueprint was centred until a frame ran, and `toScreen`, which is what every spec aims its pointer with, reads it. Measured, an entity reported **(-80, -16)**: off the canvas. Specs normally survive only because a `page.evaluate` round-trip is long enough for a frame to land in the gap; when one is not, the pointer goes somewhere the entity is not, the hover never arrives and the spec dies on a 10s timeout naming nothing. **The bug was intermittent and this test is not** - it reads inside the same `evaluate` as the load, with no yield, so the frame cannot have run, and it failed 25 of 25 before the fix. The third test is the one to understand before touching `Viewport`: the tempting over-correction is to clear the dirty flag in `getTransform` as well as rebuild, which passes the other two and every pointer spec in the suite, because `update()`'s return value is what writes the container's position and scale - clearing the flag on a _read_ hands back a fresh transform and skips the draw, so the model is centred and the pixels are not, and `toScreen`/`toWorld` stay perfectly self-consistent while the blueprint is drawn somewhere else. Only a screenshot or the `viewportRenderedInSync` hook can see it
- `tests/sprite-generation.spec.ts` - Two halves. One builds a synthetic blueprint holding every entity in `data.json` at the four cardinal directions (`tests/helpers/all-entities-blueprint.ts`); the other loads the real bases, which is where the neighbour-dependent branches (pipe junctions, belt corners, undergrounds) and modules get exercised. Both assert against a pinned list of entity types that fail today
- `tests/entity-accessors.spec.ts` - Tallies what every `Entity` accessor returns (a value, an empty list, or nothing) across all 578 blueprints in `wormeyman-tests/`, so a getter that starts returning `[]` where it returned `undefined` shows up. Fixed point, not a refreshable snapshot
- `tests/wire-connections.spec.ts` - Checks the connection map agrees with its entity index, that `serializeBpWires` resolves every endpoint, and that remove/re-create reproduces the wire set. Also needs FD loaded. The static `serialize`/`deserialize` are unit tested in `packages/editor/src/core/WireConnections.test.ts` instead - those need no FD
- `tests/blueprint-sources.spec.ts` - The `?source=` handlers in `bpString.ts`, which had no coverage at all until issue #124: nothing under `tests/` mentioned `/corsproxy` or any of the nine hostnames, so every arm could have been deleted or given the wrong URL with the suite green. The corpus cannot reach them **by construction** - every file in `wormeyman-tests/` starts with `0`, takes the `DATA[0] === '0'` branch and never builds a URL - and neither can a unit test, since the function ends in `decode`, which needs FD. What makes it cheap is that every arm fetches through `/corsproxy?url=<encoded>`, so `page.route` reads the rewritten URL off the intercepted request and `route.fulfill` supplies the body. Each case asserts **two** things, and the second is the point: the URL catches a typo in a template literal, and loading the result catches a change to the _parse_ step - `gist` reads `data.files[<first key>].content` and `factorio.school` reads `data.blueprintString.blueprintString`, and a rename at either end leaves the URL perfectly correct and the blueprint empty. Mutation-checked three ways, each failing exactly one test. Note the factorio.school arm is covered twice, since a URL already pointing at `/api/` is passed through untouched and read as text rather than JSON. The last test pins a **non**-happy path that is not an endorsement: `fetchData` rejects on `!response.ok` and nothing else, so a host answering **200 with an HTML login or error page** hands markup to `decode()` and the user sees a corrupt-blueprint error naming nothing about the URL - measured on Dropbox while probing #98
- `tests/blueprint-round-trip.spec.ts` - Pins the decode -> model -> serialize path over all 578 blueprints: counts, a checksum over the in-model entity/tile positions, a checksum over the serialized positions, and a hash of the serialized output. The two checksums are not redundant - `serialize()` re-centres through `getCenter()`, so the serialized one is blind to a `getOffset` change and only the model one catches it. Fixed point
- `tests/overlay-container.spec.ts` - Tallies the child count of every entity's info overlay (-1 for no overlay), synthetic and real halves like sprite-generation. Calls the static `createEntityInfo` via `window.__fbe_test.overlayInfoTally` so a throw propagates instead of being swallowed by the instance method's try/catch. Fixed point
- `tests/sprite-data.spec.ts` - Tallies a `"<layer count>:<hash>"` digest of the sprite data every entity generates, over five corpora: synthetic and real, each with and without a position grid, plus the bare-object path `PaintEntityContainer` draws with. The no-grid halves are the entity editor and paint previews, and they reach branches nothing else does - a wired belt drawn without a grid is only in the real no-grid half. The paint half is the only one that exercises `getDrawData`'s defaults, and it is not deduped, because collapsing to a set hides a wrong `dir` default that lands on a direction already in the list. This is the half `sprite-generation.spec.ts` does not cover: that one pins which entities fail outright, this one pins what the ones that succeed produced, so a read turned into a skip or a `?? []` shows up. Its real half walks every blueprint of every book (578, like `entity-accessors.spec.ts`) rather than the 11 top-level files, since loading a book renders only its first entry. Fixture is `tests/__fixtures__/sprite-data.json`; fixed point
- `tests/recipe-shapes.spec.ts` - Places one assembling machine per recipe in FD (`tests/helpers/all-recipes-blueprint.ts`) and tallies what each reader of the ingredient/result lists answers, or `THREW`. Keyed by recipe rather than by entity, which is the point: the shapes that break sit on recipes no real base contains and no entity carries by default, so nothing that iterates entities can reach them. The tally decodes without loading, because rendering asks every crafting machine for `assemblerHasFluidInputs` and is itself one of the readers; a second test asserts the load separately. Fixture is `tests/__fixtures__/recipe-shapes.json`; fixed point. No entry records a throw any more - `fluoroketone` was the last one, fixed in issue #41 by falling back to the product's icon
- `tests/name-migrations.spec.ts` - Drives `nameMigrations.ts` through the real decode path, where a migrated name has to resolve against FD or the entity gets stripped. Builds its own blueprints because the corpus cannot cover it - see the version note below
- `tests/unknown-prototypes.spec.ts` - Pins both halves of the strip: an unknown entity and an unknown tile are each dropped and named in a load warning, and a blueprint left empty by stripping still loads (issue #46)
- `tests/entity-container-mappings.spec.ts` - Measures `EntityContainer.mappings` across a blueprint swap, big-then-small. Deliberately not a "does it grow" test: retention was bounded by the largest blueprint seen in the session, so a growth test would pass while leaking (issue #42)
- `tests/editor-mode-input.spec.ts` - The only spec that dispatches real pointer and keyboard input, and now covers every mode (issue #44). PAN, COPY and DELETE need nothing under the cursor and run against the empty blueprint the editor opens with, so no press can be caught by an entity. EDIT, and both routes into PAINT, need a specific entity under the pointer and load a synthetic three-chest blueprint whose entity numbers the spec chose itself. The two PAINT routes are not interchangeable: pipette (`Q`) builds a `PaintEntityContainer`, releasing a ctrl drag builds a `PaintBlueprintContainer`, and they rotate and flip differently - which is what issue #53 turned out to be. Note the paint container is _hidden_, not destroyed, when the pointer leaves the canvas, and `mode` reports PAINT either way, so `paintContainerVisible` is the hook that can tell them apart; likewise `mode` says EDIT at both ends of a hover moving between two entities, which is what `hoveredEntityNumber` is for. Negative client coordinates do get dispatched, and are the only way a spec can put the pointer off a canvas that fills the window
- `tests/paste-placement.spec.ts` - The decision/execution split for a pasted selection. `checkBuildable` tints the whole preview against the destination grid before the click, so placement has to use decisions made against that same unchanged grid or a legal second entity can render green and then be silently dropped after the first mutates the grid. The positive case is the measured rail example: two `curved-rail-a` entities two tiles apart are legal in Factorio while their 2x6 editor rectangles overlap; the sibling refusal pastes the same pair back over destination entities so replacing every plan with `create` fails. Fast replace and rotate are separate controls because they reuse an existing entity and return `undefined` rather than entering the wire-remapping map. Their targets are deliberately re-derived during execution instead of kept in the plan: an earlier planned action can destroy the object that planning found, while a second lookup can only return the current live entity or safely return nothing
- `tests/text-input.spec.ts` - The only coverage of `UI/controls/TextInput.ts`, and the only spec that asserts on real DOM. That control is the odd one out in `UI/`: it is not drawn with pixi, it appends an `<input>` over the canvas and keeps it positioned, so its output can be checked directly instead of through a tally. Reached the way a user reaches it - hover to EDIT, then left click, the `openEntityGUI` action - which only became drivable with #44. Pins the DOM lifecycle (exact set of inputs, gone after Escape, back on reopen), the styles `_input_style` writes, and the numeric-only restriction path. Note `fontSize: ''` in the styles test is issue #60 recorded, not the expected answer
- `tests/keybinds.spec.ts` - Keybind import, which runs at startup against `localStorage`. That is the one input the editor is guaranteed to be handed names for that no longer exist, since stored keybinds outlive the action list that produced them - a stale entry used to throw inside the import loop, lose every keybind after it, and prevent the listener that rewrites storage from ever attaching, so it could not be cleared by normal use. Seeds storage with `addInitScript`, which runs before the page's own scripts; the corpus cannot reach any of this, being neither a blueprint nor input. The stale entry is listed _first_ in its fixture on purpose, so a fix that stops the throw without continuing the loop still fails
- `tests/paste-wires.spec.ts` - Pasting a wired selection, the only consumer of `PaintBlueprintEntityContainer.placeEntityContainer`'s return value. That value does not decide whether entities get _placed_, only whether their wires come with them, so no entity count can see a mistake in it - which is why this exists separately from `paste-placement.spec.ts`. Reads live editor state through `wireCount`, unlike `wire-connections.spec.ts`, which walks a blueprint it decoded itself. Its third test is a backstop on "a wire with one end outside the selection is not copied", a property enforced _twice_ - a copy-time entity-number whitelist and a paste-time both-ends check - so weakening either alone leaves it passing and only breaking both fails it; do not read it as coverage of either check
- `tests/tiles.spec.ts` - That tiles actually render, which nothing asserted: `blueprint-round-trip.spec.ts` checksums their positions in the model and stops, and `unknown-prototypes.spec.ts` covers them being stripped before they get that far, so `TileContainer.generateSprite` could stop drawing entirely and the suite would stay green - the load succeeds either way, the floor is just empty. Covers both of its branches separately because they read different prototype fields: of the 22 tiles in `data.json`, 16 carry `variants.material_background` and 6 fall back to a single-tile entry in `variants.main`
- `tests/book-serialize.spec.ts` - Book's index arithmetic, and the only spec that calls `Book.serialize()` at all. Four specs walk a book through `selectBlueprint` and would notice it resolving to the wrong blueprint, but the other two conversions produce nothing except `active_index` - on the book and on each nested book the save passed through - and no entity count depends on that, so it could have been wrong or missing with the suite green. Builds its own three-entry book with a nested one in the middle, the smallest shape where the flattened and top-level indices differ in both directions; the corpus cannot substitute, since its books are real exports whose nesting the spec did not choose and so cannot name an index for
- `tests/chest-filters.spec.ts` - Writing a logistic chest's filters, which threw outright until issue #64: the getter had been rewritten for the 2.0 `request_filters.sections` shape and the setter left as a bare `throw`. Two tests drive the live route with real input - paste settings, shift+RMB then shift+LMB - and the rest go through the `setEntityFilters` hook, because paste always sends a full list copied off another entity and so can neither clear a chest nor send the chest editor's partial slot lists. Note what the assertions are actually for: the setter rewrites the whole `request_filters` object, and most of that object is invisible to `Entity.filters`, which reads section 0 and stops. So the flags (`request_from_buffers`, `trash_not_requested`) and any second section can be destroyed on every filter edit with the filters themselves still reading back correctly - which is why those are asserted against the _serialized_ output rather than the model. The "no page errors" check in the paste test comes before the filter assertion on purpose: an empty target is equally what a shift-click that missed would leave, so asserting the filters first would fail identically either way and prove nothing about the gesture
- `tests/unknown-operator.spec.ts` - What the editor says when a combinator carries an operator it does not know (issue #55). Answers that issue's open question - the three `default:` arms **are** reachable, not merely unreached: the schema enum-constrains `operation`, but validation is lenient and `stripUnknownPrototypes` drops unknown _prototype names_ only, never unknown field values, so an operator outside the enum survives decode and reaches the switch. That is what a future Factorio version adding an operation would produce. Also pins that the throw stays caught, so the cost is one entity's sprites rather than the whole blueprint
- `tests/inserter-throughput.spec.ts` - What the info panel reports for an inserter (issue #96). The arithmetic is unit tested in `packages/editor/src/core/throughput.test.ts` instead - it is pure numbers with no FD, so it needs neither browser nor dev servers, which is true of almost nothing else under `UI/`. What this adds is the part a unit test cannot see: the panel used to read only what the inserter drops **into**, so one picking off a belt was reported at the container rate. Three arrangements giving three different numbers is the only way to show both ends are read and not swapped. Note an unrotated inserter picks from **-y** and drops to **+y**, matching the prototypes' `pickup_position`/`insert_position`; a first draft assumed the opposite and got the two belt cases back swapped
- `tests/paste-modules.spec.ts` - Module slot **positions** through paste-settings (issue #100). `Entity.modules` is positional - one entry per slot, undefined for an empty one - and the getter, setter and `Modules` UI all keep it that way; `pasteSettings` was the exception, copying with a `filter` that dropped the empty slots so every module behind a gap slid forward. Nothing asserted anything about positions, so every count, set and round-trip of that paste was identical either way. Two things worth knowing: `canPasteSettings` requires the two entities share a `type`, so a cross-type pair (a machine and a beacon) is refused outright and cannot be used as a fixture; and the third test pins a **deliberate** consequence - preserving positions means a module past a smaller target's slot count is now dropped where the old code moved it forward
- `tests/chest-editor.spec.ts` - The logistic chest editor, re-enabled in issue #87. `ChestEditor` itself needed no changes: its `// TODO: update using sections` was about the setter it drove, which #64 fixed, so the fix was the factory case and the coverage. This is the only spec that clicks a control **drawn inside a dialog**, which pixi gives no selector for - `topDialogBounds` says where the dialog sits and the spec's `FILTERS_X`/`SLOT_PITCH` constants mirror `ChestEditor` and `Filters`, so moving that layout moves these. Worth knowing about two of the tests: the count-controls one asserts through the **DOM**, because the count box is a `TextInput` and so the one part of the dialog visible from outside the canvas - and it happens to be exactly what tells the storage layout from the other two; and the pick-an-item one deliberately does not pin _which_ item it picked, since that follows `FD.inventoryLayout`, only that a pick reached the entity with a count. The last four tests are the grid's **size and shape** (issue #93) and are the only thing that can see it: `Entity.filterSlots` is a plain number, so a spec reading it would agree with itself whatever got drawn. Each one instead clicks a position that exists only under the intended layout - slot 10 on the first row proves ten columns, slot 30 proves three rows, and a chest arriving with a request at index 45 proves the floor is a floor. That last one found a live crash rather than pinning behaviour: `Filters` built its slots once but re-read `filterSlots` on every change, so clearing the index-45 request dropped the count back to 30 and the next redraw walked off the end of its own array
- `tests/pre-2-0-shape-migrations.spec.ts` - The two places in `Blueprint.ts` that rewrite a pre-2.0 shape into a 2.0 `LogisticSections` object: `control_behavior.filters` -> `control_behavior.sections` for constant combinators, and a flat `request_filters` array -> `request_filters.sections` for logistic chests. Neither had any coverage, and the corpus cannot give it any - no blueprint in it carries either old shape, so both were dead code as far as the suite was concerned. The two are gated differently and it is easy to misread: the chest one is **version**-gated and throws on an array in a non-pre-2.0 blueprint, the combinator one is **shape**-gated only (`filters` present, `sections` absent) and so fires at any declared version. Each migration is asserted twice, against the serialized output (the only place the section's own `index` is visible) and against the model, since an object no reader can use is no better than nothing
- `tests/paste-entity-settings.spec.ts` - The same-type half of #94: train stop name/colour/trains limit, locomotive colour, chest `bar`, cargo wagon `inventory`, rocket silo launch settings. What each pair carries was measured with `LuaEntity.copy_settings` rather than taken from the 2019 TODO (`tools/oracle/fixtures/copy-settings.json`), which is how two fields the TODO omits turned up (`manual_trains_limit`, `use_transitional_requests`) and how the silo's `auto_launch` turned out to be **renamed** to `launch_to_orbit_automatically`, not removed. Asserts against the **serialized** blueprint, not the model: a wagon nests `bar` and `filters` under `inventory` where a chest carries `bar` at the top level, so a setter writing the right value into the wrong shape reads back correctly from the model that just wrote it. Two things worth knowing: each test loads its **own two-entity blueprint**, because the editor centres the view on what it loads and an entity off screen hovers nothing - a first draft stacked six pairs down one blueprint and the far ones silently pasted nothing, which is indistinguishable from a broken setter, so `expectBothHoverable` now asserts the hover first; and the last test exists because no single paste can show whether the target got a **copy** of the source's settings object or a reference to it, so it changes the target afterwards and looks at the source. The last three tests are the **locomotive schedule** (issue #115), which is structurally unlike everything above them: a schedule is not a field on the entity at all but an entry in the blueprint's top-level `schedules` list naming the locomotives that share it, so they assert that list rather than a serialized entity and `Entity.schedule` reaches through to `Blueprint`. Two of the three exist because of what the game said rather than what the TODO did - a paste **replaces** the target's schedule, and a source with **no** schedule **clears** it. Mutation-checked, the obvious `if (source.schedule !== undefined)` mistake passes the successful-paste test and fails only the clearing one. Note what is deliberately not asserted: copy-versus-reference, because the format shares one entry between locomotives on the same schedule, so sharing is correct here rather than the bug it is for the wagon inventory
- `tests/paste-cross-type-settings.spec.ts` - The cross-type half of #94, and the only coverage of `canPasteSettings` accepting a pair at all. `CROSS_TYPE_PASTE` in `Entity.ts` lists the pairs Factorio's own copy carries, each one probed rather than assumed (`tools/oracle/fixtures/copy-settings-cross-type.json`). **The request-amount formula recorded in #94 is wrong**: it says `min(amount, ceil(amount * speed / energy))` and the game does `floor(30 * amount * speed / energy)` - thirty seconds of production - which disagree on every case measured. Three details the probe settled and the spec pins: it floors (4.5 -> 4), modules count (a machine with two speed modules asks for **62** where the arithmetic says 63, float error the JS reproduces), and fluid ingredients are omitted rather than requested at zero. Note the cursor-box test, which exists because adding a type to `CROSS_TYPE_PASTE` that does no work passes every other test here - the copy cursor box is the only thing `canPasteSettings` shows a user, and it is drawn **only while the modifier is held**, so a check after releasing shift answers false for every pair. Its `hoverEntity` steps the pointer off the target before moving onto it: the editor recomputes the hover on a grid update, so moving to coordinates the pointer already occupies changes nothing, which bites when a second blueprint is loaded into the same page and puts an entity in the same place
- `tests/toast-click-interception.spec.ts` - That a toast can take a click meant for the canvas, and that `tests/helpers/overlays.ts` stops it (issue #119). `.toasts-container` is `position: fixed; bottom: 0; right: 0; width: 320px; z-index: 20`, so every toast sits **on top of the editor**, and loading a blueprint raises one that lives five seconds - a click in that column goes to the toast `div`, pixi never sees a `pointerdown`, and the action behind it never fires. That made **nine** pointer-driven specs intermittent at roughly one full run in three, presenting as a paste that wrote nothing, which reads as a broken setter in whatever was last changed. Every spec that calls `page.mouse` now calls `suppressOverlays(page)` **before** `page.goto`. Two things worth knowing: the first test is a **control** that deliberately does _not_ suppress, because a test that only checked the suppressed case would pass just as happily if toasts stopped covering anything - mutation-checked, making the app's own container non-interactive fails that control; and neither test depends on an entity's position, since an earlier draft that put a chest under the toast column was measuring the viewport, the 96px-per-tile zoom and how many toasts happened to be stacked rather than the bug. A third thing, found by soaking the suite after #144: loading raises **three** toasts on **three different timers** - a `success` on 5s, an `info` on 10s and, a second later and prepended above both, the welcome toast on 30s - and both tests originally asserted on the **total count**. That made the suppressed half fail roughly one full run in six for a reason unrelated to the click, since the `success` toast expires on its own and takes the count down with it, and it made the control able to pass **without the click doing anything**, since the same expiry satisfies "the count went down". Both are now keyed to the **id** of the toast actually measured and clicked. The same fix closed a second latent race: `.first()` is a locator that re-resolves on every call, so a settle poll built on it can compare one toast's box against another's while the welcome toast arrives, and settle on a centre belonging to neither - hence settling on identity and geometry together
- `tests/test-hook-readiness.spec.ts` - That `window.__fbe_test` appearing means the editor is _ready_, which every other spec assumes and nothing checked (issue #109). The hook used to be assigned synchronously while `editor.init()` - which fetches `data.json` and calls `loadData` - was still in flight, so a spec could win the race and run against an empty `FD`. That is what full runs failing two to five **random** specs was, each passing in isolation: `book-serialize`, `chest-editor`, `chest-filters`, `tiles`, `unknown-operator`, `paste-wires`, all with `Cannot read properties of undefined` from wherever they first touched the data. Warm, the window is 0ms wide and nothing fails, so this spec holds `data.json` back 1.5s with `page.route` rather than waiting for a slow day. Note it covers only the ordering; the other route to an empty `FD` in #109 - editing `factorioData.ts` with the dev server live, where HMR re-evaluates the module without re-running `loadData` - needs a file edit mid-run and is a separate mechanism with the same symptom
- `tests/helpers/encode-blueprint.ts` - `encodeBlueprint`/`encodeBlueprintBook`/`packVersion`, for the specs whose case cannot come from the corpus: a version other than the 2.0.45+ every file declares, a name deliberately absent from FD, or a book whose nesting the spec picked. `decodeBlueprintString` is the inverse, for asserting on what the editor encoded rather than on a reload - the difference matters for anything, like `active_index`, that a reload cannot see
- `tests/helpers/fbe-test-api.ts` - The single `declare global` for `window.__fbe_test`, plus `waitForEditor`/`loadBlueprint`. TypeScript rejects two `declare global` blocks typing the same property differently, so a new hook goes here rather than in the spec that wants it
- `tests/helpers/blueprint-files.ts` - Discovers `.txt` files from `wormeyman-tests/{collection}/`
- `tests/helpers/report-generator.ts` - Generates JSON + markdown reports to `diagnostic-reports/`

**Test blueprints** are organized by collection in `wormeyman-tests/` (EARN, AVADII, etc.). Each `.txt` file contains a raw Factorio blueprint string.

**Every blueprint in the corpus declares 2.0.45 to 2.0.73** - 11 files, 1149 versioned blueprints and books. So the corpus cannot exercise any version-conditional branch: the pre-2.0 arms of `Blueprint.ts`'s guards and all of `nameMigrations.ts` are invisible to it, and code that is wrong for old blueprints passes the entire suite. That is what hid issue #40. Version-conditional code needs a synthetic blueprint at a chosen version - use `tests/helpers/encode-blueprint.ts`. Three other things the corpus cannot reach: a name FD does not have (every file loads clean), anything behind pointer or keyboard input, and **any pre-2.0 data shape** - no file carries `control_behavior.filters` or a flat `request_filters` array, so the shape migrations in `Blueprint.ts` are invisible to it too, whether or not they are version-gated (`tests/pre-2-0-shape-migrations.spec.ts`).

**How it works:** Tests navigate to the editor, wait for init, then call `window.__fbe_test.getBlueprintOrBookFromSource()` and `loadBp()` via `page.evaluate()` to inject blueprints directly (avoiding URL length limits). Console warnings/errors and JS exceptions are captured per blueprint.

**Suppress the overlays in any spec that dispatches pointer input.** `await suppressOverlays(page)` from `tests/helpers/overlays.ts`, **before** `page.goto` - it registers an init script, so `addStyleTag` would not survive a reload. There are **two** DOM overlays drawn over the canvas that take pointer events, in opposite corners, and they are the same bug twice:

- **Toasts** (issue #119), `.toasts-container`, bottom **right**, 320px wide, `z-index: 20`. Loading a blueprint raises one that lives five seconds. It cost three baseline runs to prove it was not a regression in #115; the specs that failed were the ones whose second entity sits furthest right - the pairs 12 and 14 tiles apart, never the 6-tile ones.
- **The dat.gui settings pane** (issue #130), `.dg.main`, bottom **left**, pinned by `packages/website/src/index.css` at `position: fixed; bottom: 0; left: 0; z-index: 5`. Open by default, since `closed` reads a `localStorage` key a fresh profile does not have, and unlike a toast it never goes away. Measured at the config's 1280x720: 320x236 at (0, 484) over a full-viewport canvas, `elementFromPoint` at its centre answering `DIV.c` rather than `CANVAS#editor` - a dead rectangle over about 8% of the canvas. This is why `paste-cross-type-settings.spec.ts` stayed intermittent after #119: its **source** entity is the left-hand one, so the failure is a hover that times out rather than a paste that wrote nothing.

The failure is silent either way and looks like a broken setter rather than a lost click. Note the pane is a real dead zone for **users** too, not only for specs - the suppression is a test-side workaround, not a fix for that.

**An unloaded `FD` names itself now (issue #109).** `FD` starts empty and is filled in by `loadData` during `Editor.init()`. Every one of its twelve properties is an accessor until then, throwing `FD.<name> was read before data.json was loaded`; the setter swaps each one for a plain data property on first write, so a loaded read costs nothing and `loadData` needed no changes. The point is that an empty `FD` used to be **silent** - a read answered `undefined` and the failure surfaced wherever that `undefined` was next indexed, classically `TypeError: Cannot read properties of undefined (reading 'requester-chest')` inside an AJV custom keyword, in a spec nobody had touched. That reads exactly like a regression, and nothing in it names `FD`. Adding a property to `FactorioData` without adding it to `FD_KEYS` is a compile error, not a silent gap - the record type constrains both directions where a `satisfies` list would only reject wrong names.

**The HMR half of that note was a misdiagnosis, and is measured, not assumed.** It used to say Vite re-evaluates `factorioData.ts` on edit without re-running `loadData`, leaving `FD` as `{}` under a live app. It does not: the module is not self-accepting and nothing above it accepts, so Vite falls through to a **full page reload**, startup re-runs and `loadData` with it. Probed three times against the running dev server - the page loses its own `window` state, the console shows a fresh `[vite] connecting...` and `loadData`'s own log line, and a blueprint loads clean afterwards. So `import.meta.hot.invalidate()` (#109's first suggested fix) would be a no-op, and there is still no `import.meta.hot` anywhere in `packages/`. The failures that prompted the note were almost certainly the startup race PR #111 fixed, where `window.__fbe_test` was assigned while `loadData` was still in flight - that produces exactly the reported error, and unlike an edit it also explains the same failure appearing in a run where no file was touched. Restarting the servers after editing a once-only module is still cheap insurance, but it is not the fix for this.

**An intermittent spec usually has a deterministic bug under it - find the mechanism, not a retry.** #144 presented as a hover timing out in roughly half of full runs and passing in isolation, in a spec nobody had changed. Retrying, raising the timeout or adding a settle wait would all have "worked" and left it live. The actual cause was a stale viewport transform (above), and once the mechanism was named it reproduced **25 times out of 25** by reading inside the same `page.evaluate` as the load so that no frame could run in between. What located it was not more runs - three more full runs all passed - but reading the code along the failing path and finding a `dirty` flag whose rebuild is deferred to the ticker. Note the two things that ruled out the easy explanations first: running the alphabetical prefix through the failing spec reproduced nothing, which killed "a heavy spec before it", and the config is `workers: 1, retries: 0`, so run order is deterministic and position could not be the variable.

**A green suite says nothing about how a feature feels.** Every assertion here is some form of "did it land on the right thing", and none can see _how far_ something moved to get there. Rail signal snapping shipped fully tested and mutation-checked, with a 4-tile snap radius that left the signal 390px from the pointer and an `R` key that jumped diagonally across the track - both found in one sitting by driving the editor with a throwaway Playwright probe and printing positions, and both one-line fixes (#143). For anything with a radius, a threshold or a step order, drive it and print numbers before calling it done. Throw the probe away afterwards: it is a measuring instrument, not a test, and keeping it means maintaining a spec whose expectations are "feels about right". Expect to get it wrong twice first - a "has it released yet" heuristic keyed on the signal being near the pointer fired while it was still snapped, and a screen-to-tile mapping derived from two entities put the pointer off by enough to look like a broken distance limit. **When a browser probe disagrees with a rule, check the rule's own pure function directly before believing the probe** - that one measured as a snap 2.7 tiles out against a 2.5 limit, and the limit was fine.

**Prerequisites:** Both dev servers must be running before tests. `npm run localpreview` from the repo root starts both (Vite on 8080, sprite data on 8081) and stops both on Ctrl-C.

Also run `npx playwright install` after any `@playwright/test` version bump. The bundled browser revision moves with it, and every spec then fails on a missing `chrome-headless-shell` executable - which reads like a suite-wide regression rather than a missing download.

The reason to prefer the script over two hand-started terminals is that both servers fail _quietly_ on a port clash, in the same direction. Vite without `--strictPort` falls back to 8081 and then proxies `/data` to itself, which looks like the sprite server failing rather than a port clash; `npx serve` moves to a random high port and says so in one line that scrolls away. `localpreview` checks both ports by name and refuses to start. Note its check probes both loopback families - Vite binds `localhost`, which is `::1` alone on macOS, so an IPv4-only probe reports 8080 free while Vite holds it.

If 8080 is taken, run Vite elsewhere and point the specs at it with `FBE_BASE_URL` rather than editing `playwright.config.ts`. The sprite data server must stay on 8081 either way - the Vite dev proxy hardcodes it, which is why `--port` only moves Vite.

```fish
npm run localpreview -- --port 8090
FBE_BASE_URL=http://localhost:8090 npx playwright test
```

**Reports** are written to `diagnostic-reports/blueprint-diagnostics.json` and `diagnostic-reports/blueprint-diagnostics.md` (gitignored).

## Manual Testing

Load blueprints from factorio.school to test:

```
http://localhost:8080?source=https://www.factorio.school/api/blueprintData/{hash}/
```

Key things to test:

- Blueprint books with Space Age entities load without errors
- Entity placement from inventory (press E, click entity, click to place)
- Entities with complex sprite formats (foundry, trains, elevated rails) render
- Copy/paste blueprint strings (Ctrl+C/V with canvas focused)

## Mobile Support

Mobile devices get a read-only viewer with touch gestures (single-finger pan, pinch-to-zoom). The mobile check (`isMobile.any` from pixi.js) shows a dismissable warning instead of blocking the app. Touch handling is in `BlueprintContainer.ts` using native `touchstart`/`touchmove`/`touchend` events on the canvas. Editing features (inventory, entity placement, wiring, keyboard shortcuts) are not available on mobile.

## Known Limitations

- Train entity sprites use 256-direction spritesheets mapped to 4 cardinal directions - orientation is approximate
- Complex visualizations (crane arms, plasma effects, thruster flames) show only static base sprites
- Blueprint book icons using planet names show no icon
- Some entity types may have missing or incorrectly mapped textures
- **`strict: true` is on and every package is clean** - editor, website and worker all type-check at 0, and `vp check` enforces it in CI (issues #22 and #77, both closed). The last flag was `strictPropertyInitialization` at 24 errors across 13 files; two of them were live bugs rather than annotations, and are worth knowing about because the same shape recurs. `Checkbox` and `Slider` had guarded setters their constructors called (`if (this.m_Checked !== checked)`) that ran **only** because the field started undefined, so simply adding an initialiser stopped `new Checkbox(false)` drawing anything at all; and `EntitySprite.__zIndex` was left unset for every splitter, underground-belt and loader sprite that was not the main belt, so `compareFn` computed `undefined - undefined` and sorted them on NaN. Use `need(e, 'field')` in the sprite builder rather than reading an optional prototype field directly
- `util.getDirName` throws for non-cardinal directions, so any `draw_*` that calls it fails for an entity placed diagonally and renders a placeholder box. `railgun-turret` hits this: the test corpus places it at directions 2 and 14. Pinned as current behaviour in `tests/__fixtures__/sprite-data.json`
- **Hand placement accepts arrangements Factorio would refuse, deliberately, and refuses some it would allow.** `isAreaAvailable` models rails as tile rectangles; the game does not. The refusals bite a user hand-building rails and a user **pasting against pre-existing destination entities**, since `PaintBlueprintEntityContainer` asks about each entity it places; entities inside one paste are planned against the unchanged destination grid, so they do not block one another. Loading an existing blueprint never reaches this code. Measured and left as-is: a rail dropped on a signal (the game blocks 88 of 768 such placements and nothing on this grid can say which 88), and, in the other direction, a half-diagonal or curved rail laid over a gate and a gate on a curved rail, all of which the game accepts and this refuses. Closing those means per-rail collision shapes instead of rectangles, which is issue #133. The rail-on-rail arms have now been measured too (#133 item 5) and the count of refusals the game would allow went 84 to 24; the 24 left are an identical curved rail at an identical direction, where the game accepts four overlapping placements and this grid cannot say which cell holds the curve. The cases that were closed in #95 are the ones where a permissive answer produced a blueprint the game will not build back. Where the gate rules stand now, checked against the fixture on every direction the editor can produce (`getPossibleRotations` gives a gate `[0,4,8,12]` and every rail `[0,2,4,6,8,10,12,14]`): they agree with the game **exactly** for straight, legacy-straight and half-diagonal rails, and the only reachable disagreement left is the curved-rail refusal. They part company at gate directions 1-3 and their multiples, because the rule compares `direction % 8` on an entity with four orientations where the game normalises to the quadrant first - latent, since nothing produces such a gate
- Mobile is view-only - no editing, inventory, or keyboard shortcuts
- Buffer and requester chests show **30** filter slots, three rows of the game's own `logistic_slots_per_row`. Neither declares `max_logistic_slots` and a 2.0 logistic section has no fixed count, so there is no number to read: only the _width_ comes from the data, and the three rows are a chosen default (issue #93, closed). `filterSlots` is a **floor**, raised by `Math.max` to whatever the blueprint arrived holding, so it is not constant for a given entity - anything caching it must clamp, which is what `Filters.m_SlotCount` is for. What an entity can actually hold is `maxFilters`, and that is what every writer reads
- `IFilter` carries `quality`/`comparator`/`max_count` as of issue #88, so those survive read -> model -> write including paste. There is still **no way to set a quality** - nothing in the UI offers a picker - so the editor round-trips what a blueprint arrived with and no more. Note absent is not the same as `normal`: Factorio reads a filter with no quality as accepting any quality. `set logisticChestFilters` layers the incoming filter over the one the slot already held, so a caller that knows a field sets it and one that does not leaves it alone; that preservation is what lets a partial write exist at all
