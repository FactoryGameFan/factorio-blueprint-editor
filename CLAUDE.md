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

# Type check (strictNullChecks is on and still being worked down - see issue #22)
npx tsc --noEmit -p packages/editor/tsconfig.json

# CI type-check gate: fails only if the error count exceeds the committed
# baseline in scripts/type-check-baseline.json. As errors are fixed, lower
# maxErrors to lock the gain. Runs in CI via .github/workflows/ci.yml
# (oxfmt + oxlint + vitest gate + tsc gate) on PRs/pushes to wormeyman-space-age-support.
npm run type-check:gate

# Unit tests (editor + gate) - gate tests now run under vp test
vp test

# Run Playwright blueprint diagnostic tests (requires dev servers running)
vp run test:e2e

# List discovered test blueprints without running
vp run test:e2e -- --list

# Bundle size analysis (from packages/website/) - opens treemap in browser
# Note: bare `npm`/`npx` must resolve to vp's managed npm (~/.vite-plus/bin on
# PATH); the root devEngines pins npm `^11`, which system npm may not satisfy.
cd packages/website && npm run build:analyze
```

## Vite+ Toolchain

`vp` is the unified CLI for this project (lint, format, test, build). Configuration lives in the root `vite.config.ts` (`lint`, `fmt`, and `test` blocks). The commands `npm run lint` and `npm run format` delegate to `vp` and require it on PATH - install with `VP_VERSION=0.2.6 VP_NODE_MANAGER=yes curl -fsSL https://vite.plus | bash` and add `~/.vite-plus/bin` to PATH.

## Dev Server Setup

Vite dev server runs on port 8080. In dev mode, `/data` is proxied to `http://127.0.0.1:8081` (the static file server serving sprite data). In production builds, `vite-plugin-static-copy` copies sprite data into the build output. Vite 8's dev server requires `optimizeDeps.include` for pixi.js subpath imports (e.g. `pixi.js/app`) - these are configured in `vite.config.js`.

## Architecture

### Data Flow

1. `packages/exporter/` extracts entity definitions and sprites from Factorio
2. Output goes to `packages/exporter/data/output/` - includes `data.json` (entity/item/recipe/signal definitions) and `.basis` texture files
3. `packages/editor/src/core/factorioData.ts` loads `data.json` at runtime as `FD` (FD.entities, FD.items, FD.fluids, FD.signals, FD.recipes, FD.tiles). It also holds the shape-tolerant readers for data that does not match its declared type - `recipeIngredients`/`recipeResults`, see Space Age Specifics
4. `packages/editor/src/core/bpString.ts` decodes blueprint strings, validates against schema, creates Blueprint/Book objects
5. `packages/editor/src/core/spriteDataBuilder.ts` maps entity types to sprite data via `generateGraphics()` switch statement and per-type `draw_*` functions

### Key Files

- `packages/editor/src/core/spriteDataBuilder.ts` - Entity rendering logic. Each entity type has a `draw_*` function that returns sprite layers. This is where you add rendering for new entity types.
- `packages/editor/src/core/bpString.ts` - Blueprint string decode/encode, AJV schema validation. Validation is lenient - warns on unknown items/signals, and `stripUnknownPrototypes` drops entities _and_ tiles that FD does not have, reporting the two kinds separately. Tiles were added in issue #46: they were left in, and an unknown one then threw in `TileContainer` on `FD.tiles[name].variants`, taking the whole load down while an unknown entity merely warned.
- `packages/editor/src/core/blueprintSchema.json` - AJV schema for blueprint validation. Signal types enum must include Space Age types.
- `packages/editor/src/core/nameMigrations.ts` - Legacy prototype renames, grouped by the Factorio version that introduced each and applied to the parsed object, scoped to the version each blueprint declares. They used to be a regex pass over the raw JSON with the version conditions written as comments, so every rename hit every blueprint - which silently rewrote `stack-inserter` and `fusion-reactor-equipment`, both live prototypes again in 2.0 (issue #40). The textual form could not be fixed in place: the version to test lives inside the string being rewritten. A blueprint with no version is treated as older than every threshold. Note this is _not_ the same call as `Blueprint.ts`'s version guards - see the `Partial<IBlueprint>` note there.
- `packages/editor/src/core/factorioVersion.ts` - `getFactorioVersion(main, major, minor)`, packing a version the way Factorio does. On its own so `nameMigrations.ts` can compare versions without pulling FD into a unit test; `Blueprint.ts` re-exports it.
- `packages/editor/src/core/Blueprint.ts` - Blueprint data model, entity creation, wire connections. The constructor takes `Partial<IBlueprint>` on purpose: `PaintBlueprintContainer` builds one from just `entities` + `wires` for copy/paste, with no `version`. That is why the version checks read `data.version !== undefined && data.version < X` rather than `(data.version ?? 0) < X` - the latter would call a version-less blueprint pre-2.0 and try to parse `connections`/`neighbours` that a 2.0 paste does not have.
- `packages/editor/src/core/History.ts` - Undo/redo. `updateMap`/`updateValue` take and return `V | undefined`: undefined is a supported value meaning "delete this key", and `Action` swaps old and new on undo, so a callback can legitimately receive undefined at either end. `openTransaction` is the named invariant for "startTransaction() has run", same pattern as `PositionGrid.entityAt()`.
- `packages/editor/src/core/PositionGrid.ts` - Spatial index behind placement, overlap rules and neighbour lookups. It stores entity numbers, not entities: `setTileData`/`removeTileData` keep it in lockstep with `Blueprint.entities` via `onCreateOrRemoveEntity`, and `entityAt()` throws if the two ever drift.
- `packages/editor/src/core/generators/` - Oil outpost generators (pipe, beacon, pole). Untested geometry until recently; `generators.test.ts` pins their output against a committed fixture, so a diff there means a refactor changed generated layouts.
- `packages/editor/src/core/WireConnections.ts` - Wire data model. A connection point is either `IEntityConnectionPoint` (anchored to an entity) or `ILooseConnectionPoint` (a bare position, produced only by `PaintWireContainer` for the end following the cursor). `IConnection` has two anchored ends and is what gets stored, hashed and serialized; `IDrawableConnection` is the wider type `WiresContainer.add` accepts. `hash()` sorts `cps` in place on purpose - that normalisation is load-bearing.
- `packages/editor/src/core/Entity.ts` - Wraps a raw blueprint entity. Most accessors are getters over `m_rawEntity`, and because the blueprint format has those fields optional, most of them return `| undefined` - a splitter with no priority, an assembler with no recipe. Don't "fix" one by returning `[]` or `0` instead; `tests/entity-accessors.spec.ts` pins the difference. `Entity.getItemName` is undefined for the 20 entities with no `minable.result`.
- `packages/editor/src/core/WireConnectionMap.ts` - Stores wires twice: hash -> connection, plus an entity number -> hashes index. `get`/`getEntityConnections` throw if the two drift, same signal `PositionGrid.entityAt` gives. Note a self-connection is indexed once, not twice.
- `packages/editor/src/core/spriteShape.ts` - Narrowing helpers for the sprite unions typed-factorio models as `Base | Struct`. Deliberately does no null handling: a throw is caught by `getSpriteData` and logged, and a silent empty return would hide that. `layers` is optional on both `Sprite` and `Animation` because a value is allowed to be a bare sprite that is itself the only layer - that is what `layersOf` is for, and `dirLayers(x, dirName)` is `dirEntry` followed by `layersOf`, which is how nearly every directional read uses it. Reading `.layers` directly is what strictNullChecks flags there.
- `packages/editor/src/core/need.ts` - `need(obj, 'a', 'b')` reads a prototype field that the data always has for the types reaching the call but that typed-factorio marks optional, throwing with the field path rather than returning undefined. Used by `spriteDataBuilder.ts` and `OverlayContainer.ts`, both of which have a try/catch above them that turns the throw into a named log line and a missing sprite or overlay. Only for fields that are genuinely always present - one that is legitimately absent sometimes wants a default or a guard, since a throw costs the caller everything else it was drawing. **Before adding a `need()`, find the nearest try/catch above the read.** If there is none, `need()` is the wrong tool no matter how reliable the field looks: `TileContainer.generateSprite` is called straight from `initBP`, so a throw there loses the entire blueprint rather than one sprite - measured, and it takes the tiles that were fine down with it (issues #46 and #54). Where nothing is catching, the question is what to draw instead, and to say so in a warning that names the thing.
- `packages/editor/src/containers/OverlayContainer.ts` - The overlay drawn on top of entities (recipe icon, fluid arrows, module and filter icons, combinator signals, splitter priority). `createEntityInfo` returns `Container | undefined` - undefined is the normal case, most entities draw nothing. `tests/overlay-container.spec.ts` pins child counts per entity, because the instance method's try/catch means a broken overlay degrades to a missing one silently.
- `packages/editor/src/containers/EntitySprite.ts` - Creates PixiJS sprites from sprite data. `getParts()` is the main entry point; `getDrawData()` builds the `IDrawData` it feeds `getSpriteData` and is split out so `tests/sprite-data.spec.ts` can digest generated sprite data without loading textures. `getDrawData` is also where `IEntityData`'s optional fields get their defaults - `dir ?? 0`, `generateConnector ?? false`, `modules ?? []` - because `IDrawData` keeps those required so the draw functions can do plain arithmetic. Only `PaintEntityContainer` reaches them; everything else passes an `Entity`, which supplies every field. `getParts` skips falsy entries in the sprite list and assigns `zOrder = i` from the pre-skip index, so a generator that stops emitting an `undefined` placeholder shifts every later `zOrder` down by one - harmless, since `compareFn` only ever compares them relatively.
- `packages/editor/src/containers/BlueprintContainer.ts` - Main rendering container. `spawnPaintContainer()` handles entity placement from inventory.
- `packages/editor/src/containers/EntityContainer.ts` - Per-entity container, calls `EntitySprite.getParts()` in `redraw()`. `containerOf(entityNumber)` is the lookup for callers holding a live entity - `initBP` builds a container for every entity, the constructor is the only write and that entity's `destroy` the only delete, so a miss means drift and it throws, same signal as `PositionGrid.entityAt()`. The `mappings` map itself stays public for the lookups where absence is a real answer, such as `OverlayContainer` asking about `entityForCopyData`, which outlives its entity. The map is static, and each container now removes its own entry on its `BlueprintContainer`'s `destroyed` - but only where the map still points at itself (issue #42). That identity check is load-bearing: `Editor.loadBlueprint` runs the incoming blueprint's `initBP()` _before_ destroying the outgoing container, so the new containers have already claimed the entity numbers the two share, and a blanket `clear()` would delete the entries just written. `cursorBox` takes `keyof CursorBoxSpecification | undefined`, where undefined removes the box; that is what every hover-out and copy/delete mode exit sends.
- `packages/editor/src/UI/InventoryDialog.ts` - Inventory panel (press E). Filters items by what's in FD.entities.

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
- **`draw_*` functions that switch on `e.name` need a `default`**: falling off the end returns `undefined`, and `getSpriteData` then calls it, so the entity fails with `graphicsFn is not a function` - which names neither the entity nor the real problem, and is swallowed by the try/catch into a placeholder box. Throw instead, naming the entity. `draw_mining_drill` had this and `big-mining-drill` rendered as an unknown entity for it (issue #29). Switching on `e.name` at all is a Space Age hazard: the DLC adds new members to existing entity types.
- **`always_draw` working visualisations come in two shapes**: directional (`north_animation` and friends, absent for facings the visualisation does not apply to) and a single non-directional `animation` drawn the same whichever way the entity points. Read `vis[animDir] ?? vis.animation` - reading only the directional key silently drops the second kind, which cost `big-mining-drill` its drill head and scorch mark. The `??` order matters: a directional entry that omits the current facing must stay dropped, not fall back.
- **`EnergySource` is a discriminated union on `type`, but `getEnergySource` can also answer `undefined`,** and `undefined` has no `type` for the check to narrow through. `if (es.type === 'heat')` therefore narrows nothing and `.connections` / `.pipe_covers` stay unreadable - the guard has to be `if (es && es.type === 'heat')`.
- **The same layer key is not uniformly present across a family of entities.** Ground rails carry all five picture layers for every non-empty direction; elevated rails have no `ties`, `rail-ramp` has no `backplates` or `metals`, and `heating-tower` is a reactor with no `lower_layer_picture`. So `draw_rail` can use `need()` and `draw_elevated_rail` has to filter - probe `data.json` per entity rather than per type.

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

- **basisu v1.16.4** encoder/transcoder must match - bundled transcoder at `packages/editor/src/basis/transcoder.1.16.4.js`
- **Current basisu binary** is macOS ARM64 (`packages/exporter/basisu`) - needs cross-platform support (see TODO in exporter)

## Playwright Blueprint Diagnostics

Automated tests that load blueprint `.txt` files from `wormeyman-tests/` against the running dev server, capture console warnings/errors, and generate diagnostic reports.

**Structure:**

- `playwright.config.ts` - Config (base URL localhost:8080 unless `FBE_BASE_URL` is set, 120s timeout, single worker)
- `tests/blueprint-loading.spec.ts` - Main test file - iterates blueprints, uses `window.__fbe_test` API to load directly
- `tests/position-grid.spec.ts` - Exercises `PositionGrid` queries and the setTileData/removeTileData round trip against a real loaded blueprint (the class is core to placement and cannot be unit tested without FD data loaded)
- `tests/sprite-generation.spec.ts` - Two halves. One builds a synthetic blueprint holding every entity in `data.json` at the four cardinal directions (`tests/helpers/all-entities-blueprint.ts`); the other loads the real bases, which is where the neighbour-dependent branches (pipe junctions, belt corners, undergrounds) and modules get exercised. Both assert against a pinned list of entity types that fail today
- `tests/entity-accessors.spec.ts` - Tallies what every `Entity` accessor returns (a value, an empty list, or nothing) across all 578 blueprints in `wormeyman-tests/`, so a getter that starts returning `[]` where it returned `undefined` shows up. Fixed point, not a refreshable snapshot
- `tests/wire-connections.spec.ts` - Checks the connection map agrees with its entity index, that `serializeBpWires` resolves every endpoint, and that remove/re-create reproduces the wire set. Also needs FD loaded. The static `serialize`/`deserialize` are unit tested in `packages/editor/src/core/WireConnections.test.ts` instead - those need no FD
- `tests/blueprint-round-trip.spec.ts` - Pins the decode -> model -> serialize path over all 578 blueprints: counts, a checksum over the in-model entity/tile positions, a checksum over the serialized positions, and a hash of the serialized output. The two checksums are not redundant - `serialize()` re-centres through `getCenter()`, so the serialized one is blind to a `getOffset` change and only the model one catches it. Fixed point
- `tests/overlay-container.spec.ts` - Tallies the child count of every entity's info overlay (-1 for no overlay), synthetic and real halves like sprite-generation. Calls the static `createEntityInfo` via `window.__fbe_test.overlayInfoTally` so a throw propagates instead of being swallowed by the instance method's try/catch. Fixed point
- `tests/sprite-data.spec.ts` - Tallies a `"<layer count>:<hash>"` digest of the sprite data every entity generates, over five corpora: synthetic and real, each with and without a position grid, plus the bare-object path `PaintEntityContainer` draws with. The no-grid halves are the entity editor and paint previews, and they reach branches nothing else does - a wired belt drawn without a grid is only in the real no-grid half. The paint half is the only one that exercises `getDrawData`'s defaults, and it is not deduped, because collapsing to a set hides a wrong `dir` default that lands on a direction already in the list. This is the half `sprite-generation.spec.ts` does not cover: that one pins which entities fail outright, this one pins what the ones that succeed produced, so a read turned into a skip or a `?? []` shows up. Its real half walks every blueprint of every book (578, like `entity-accessors.spec.ts`) rather than the 11 top-level files, since loading a book renders only its first entry. Fixture is `tests/__fixtures__/sprite-data.json`; fixed point
- `tests/recipe-shapes.spec.ts` - Places one assembling machine per recipe in FD (`tests/helpers/all-recipes-blueprint.ts`) and tallies what each reader of the ingredient/result lists answers, or `THREW`. Keyed by recipe rather than by entity, which is the point: the shapes that break sit on recipes no real base contains and no entity carries by default, so nothing that iterates entities can reach them. The tally decodes without loading, because rendering asks every crafting machine for `assemblerHasFluidInputs` and is itself one of the readers; a second test asserts the load separately. Fixture is `tests/__fixtures__/recipe-shapes.json`; fixed point. No entry records a throw any more - `fluoroketone` was the last one, fixed in issue #41 by falling back to the product's icon
- `tests/name-migrations.spec.ts` - Drives `nameMigrations.ts` through the real decode path, where a migrated name has to resolve against FD or the entity gets stripped. Builds its own blueprints because the corpus cannot cover it - see the version note below
- `tests/unknown-prototypes.spec.ts` - Pins both halves of the strip: an unknown entity and an unknown tile are each dropped and named in a load warning, and a blueprint left empty by stripping still loads (issue #46)
- `tests/entity-container-mappings.spec.ts` - Measures `EntityContainer.mappings` across a blueprint swap, big-then-small. Deliberately not a "does it grow" test: retention was bounded by the largest blueprint seen in the session, so a growth test would pass while leaking (issue #42)
- `tests/editor-mode-input.spec.ts` - The only spec that dispatches real pointer and keyboard input, and now covers every mode (issue #44). PAN, COPY and DELETE need nothing under the cursor and run against the empty blueprint the editor opens with, so no press can be caught by an entity. EDIT, and both routes into PAINT, need a specific entity under the pointer and load a synthetic three-chest blueprint whose entity numbers the spec chose itself. The two PAINT routes are not interchangeable: pipette (`Q`) builds a `PaintEntityContainer`, releasing a ctrl drag builds a `PaintBlueprintContainer`, and they rotate and flip differently - which is what issue #53 turned out to be. Note the paint container is _hidden_, not destroyed, when the pointer leaves the canvas, and `mode` reports PAINT either way, so `paintContainerVisible` is the hook that can tell them apart; likewise `mode` says EDIT at both ends of a hover moving between two entities, which is what `hoveredEntityNumber` is for. Negative client coordinates do get dispatched, and are the only way a spec can put the pointer off a canvas that fills the window
- `tests/text-input.spec.ts` - The only coverage of `UI/controls/TextInput.ts`, and the only spec that asserts on real DOM. That control is the odd one out in `UI/`: it is not drawn with pixi, it appends an `<input>` over the canvas and keeps it positioned, so its output can be checked directly instead of through a tally. Reached the way a user reaches it - hover to EDIT, then left click, the `openEntityGUI` action - which only became drivable with #44. Pins the DOM lifecycle (exact set of inputs, gone after Escape, back on reopen), the styles `_input_style` writes, and the numeric-only restriction path. Note `fontSize: ''` in the styles test is issue #60 recorded, not the expected answer
- `tests/keybinds.spec.ts` - Keybind import, which runs at startup against `localStorage`. That is the one input the editor is guaranteed to be handed names for that no longer exist, since stored keybinds outlive the action list that produced them - a stale entry used to throw inside the import loop, lose every keybind after it, and prevent the listener that rewrites storage from ever attaching, so it could not be cleared by normal use. Seeds storage with `addInitScript`, which runs before the page's own scripts; the corpus cannot reach any of this, being neither a blueprint nor input. The stale entry is listed _first_ in its fixture on purpose, so a fix that stops the throw without continuing the loop still fails
- `tests/paste-wires.spec.ts` - Pasting a wired selection, the only consumer of `PaintBlueprintEntityContainer.placeEntityContainer`'s return value. That value does not decide whether entities get _placed_, only whether their wires come with them, so no entity count can see a mistake in it - which is why this exists separately from the paste test in `editor-mode-input.spec.ts`. Reads live editor state through `wireCount`, unlike `wire-connections.spec.ts`, which walks a blueprint it decoded itself. Its third test is a backstop on "a wire with one end outside the selection is not copied", a property enforced _twice_ - a copy-time entity-number whitelist and a paste-time both-ends check - so weakening either alone leaves it passing and only breaking both fails it; do not read it as coverage of either check
- `tests/tiles.spec.ts` - That tiles actually render, which nothing asserted: `blueprint-round-trip.spec.ts` checksums their positions in the model and stops, and `unknown-prototypes.spec.ts` covers them being stripped before they get that far, so `TileContainer.generateSprite` could stop drawing entirely and the suite would stay green - the load succeeds either way, the floor is just empty. Covers both of its branches separately because they read different prototype fields: of the 22 tiles in `data.json`, 16 carry `variants.material_background` and 6 fall back to a single-tile entry in `variants.main`
- `tests/helpers/encode-blueprint.ts` - `encodeBlueprint`/`packVersion`, for the specs whose case cannot come from the corpus: a version other than the 2.0.45+ every file declares, or a name deliberately absent from FD
- `tests/helpers/fbe-test-api.ts` - The single `declare global` for `window.__fbe_test`, plus `waitForEditor`/`loadBlueprint`. TypeScript rejects two `declare global` blocks typing the same property differently, so a new hook goes here rather than in the spec that wants it
- `tests/helpers/blueprint-files.ts` - Discovers `.txt` files from `wormeyman-tests/{collection}/`
- `tests/helpers/report-generator.ts` - Generates JSON + markdown reports to `diagnostic-reports/`

**Test blueprints** are organized by collection in `wormeyman-tests/` (EARN, AVADII, etc.). Each `.txt` file contains a raw Factorio blueprint string.

**Every blueprint in the corpus declares 2.0.45 to 2.0.73** - 11 files, 1149 versioned blueprints and books. So the corpus cannot exercise any version-conditional branch: the pre-2.0 arms of `Blueprint.ts`'s guards and all of `nameMigrations.ts` are invisible to it, and code that is wrong for old blueprints passes the entire suite. That is what hid issue #40. Version-conditional code needs a synthetic blueprint at a chosen version - use `tests/helpers/encode-blueprint.ts`. Two other things the corpus cannot reach for the same reason: a name FD does not have (every file loads clean), and anything behind pointer or keyboard input.

**How it works:** Tests navigate to the editor, wait for init, then call `window.__fbe_test.getBlueprintOrBookFromSource()` and `loadBp()` via `page.evaluate()` to inject blueprints directly (avoiding URL length limits). Console warnings/errors and JS exceptions are captured per blueprint.

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
- TypeScript has pre-existing type errors in Space Age code (`as any` casts used where prototype types don't match runtime data from data.json). `spriteDataBuilder.ts` is now clear, so the remaining 23 are all UI and container code (globals 5, Book 4, InventoryDialog 3, util 3, then a long tail); use `need(e, 'field')` in the sprite builder rather than reading an optional prototype field directly - see issue #22
- `util.getDirName` throws for non-cardinal directions, so any `draw_*` that calls it fails for an entity placed diagonally and renders a placeholder box. `railgun-turret` hits this: the test corpus places it at directions 2 and 14. Pinned as current behaviour in `tests/__fixtures__/sprite-data.json`
- Mobile is view-only - no editing, inventory, or keyboard shortcuts
