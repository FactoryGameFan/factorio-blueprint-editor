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
# Dev server (from packages/website/)
vp dev

# Static file server for sprite data (separate terminal, from repo root)
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
3. `packages/editor/src/core/factorioData.ts` loads `data.json` at runtime as `FD` (FD.entities, FD.items, FD.fluids, FD.signals, FD.recipes, FD.tiles)
4. `packages/editor/src/core/bpString.ts` decodes blueprint strings, validates against schema, creates Blueprint/Book objects
5. `packages/editor/src/core/spriteDataBuilder.ts` maps entity types to sprite data via `generateGraphics()` switch statement and per-type `draw_*` functions

### Key Files

- `packages/editor/src/core/spriteDataBuilder.ts` - Entity rendering logic. Each entity type has a `draw_*` function that returns sprite layers. This is where you add rendering for new entity types.
- `packages/editor/src/core/bpString.ts` - Blueprint string decode/encode, AJV schema validation. Validation is lenient - warns on unknown items/signals but only strips unknown entities.
- `packages/editor/src/core/blueprintSchema.json` - AJV schema for blueprint validation. Signal types enum must include Space Age types.
- `packages/editor/src/core/Blueprint.ts` - Blueprint data model, entity creation, wire connections.
- `packages/editor/src/core/PositionGrid.ts` - Spatial index behind placement, overlap rules and neighbour lookups. It stores entity numbers, not entities: `setTileData`/`removeTileData` keep it in lockstep with `Blueprint.entities` via `onCreateOrRemoveEntity`, and `entityAt()` throws if the two ever drift.
- `packages/editor/src/core/generators/` - Oil outpost generators (pipe, beacon, pole). Untested geometry until recently; `generators.test.ts` pins their output against a committed fixture, so a diff there means a refactor changed generated layouts.
- `packages/editor/src/core/WireConnections.ts` - Wire data model. A connection point is either `IEntityConnectionPoint` (anchored to an entity) or `ILooseConnectionPoint` (a bare position, produced only by `PaintWireContainer` for the end following the cursor). `IConnection` has two anchored ends and is what gets stored, hashed and serialized; `IDrawableConnection` is the wider type `WiresContainer.add` accepts. `hash()` sorts `cps` in place on purpose - that normalisation is load-bearing.
- `packages/editor/src/core/Entity.ts` - Wraps a raw blueprint entity. Most accessors are getters over `m_rawEntity`, and because the blueprint format has those fields optional, most of them return `| undefined` - a splitter with no priority, an assembler with no recipe. Don't "fix" one by returning `[]` or `0` instead; `tests/entity-accessors.spec.ts` pins the difference. `Entity.getItemName` is undefined for the 20 entities with no `minable.result`.
- `packages/editor/src/core/WireConnectionMap.ts` - Stores wires twice: hash -> connection, plus an entity number -> hashes index. `get`/`getEntityConnections` throw if the two drift, same signal `PositionGrid.entityAt` gives. Note a self-connection is indexed once, not twice.
- `packages/editor/src/core/spriteShape.ts` - Narrowing helpers for the sprite unions typed-factorio models as `Base | Struct`. Deliberately does no null handling: a throw is caught by `getSpriteData` and logged, and a silent empty return would hide that.
- `packages/editor/src/containers/EntitySprite.ts` - Creates PixiJS sprites from sprite data. `getParts()` is the main entry point.
- `packages/editor/src/containers/BlueprintContainer.ts` - Main rendering container. `spawnPaintContainer()` handles entity placement from inventory.
- `packages/editor/src/containers/EntityContainer.ts` - Per-entity container, calls `EntitySprite.getParts()` in `redraw()`.
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
- **`draw_*` functions that switch on `e.name` need a `default`**: falling off the end returns `undefined`, and `getSpriteData` then calls it, so the entity fails with `graphicsFn is not a function` - which names neither the entity nor the real problem, and is swallowed by the try/catch into a placeholder box. Throw instead, naming the entity. `draw_mining_drill` had this and `big-mining-drill` rendered as an unknown entity for it (issue #29). Switching on `e.name` at all is a Space Age hazard: the DLC adds new members to existing entity types.
- **`always_draw` working visualisations come in two shapes**: directional (`north_animation` and friends, absent for facings the visualisation does not apply to) and a single non-directional `animation` drawn the same whichever way the entity points. Read `vis[animDir] ?? vis.animation` - reading only the directional key silently drops the second kind, which cost `big-mining-drill` its drill head and scorch mark. The `??` order matters: a directional entry that omits the current facing must stay dropped, not fall back.

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
- `tests/helpers/blueprint-files.ts` - Discovers `.txt` files from `wormeyman-tests/{collection}/`
- `tests/helpers/report-generator.ts` - Generates JSON + markdown reports to `diagnostic-reports/`

**Test blueprints** are organized by collection in `wormeyman-tests/` (EARN, AVADII, etc.). Each `.txt` file contains a raw Factorio blueprint string.

**How it works:** Tests navigate to the editor, wait for init, then call `window.__fbe_test.getBlueprintOrBookFromSource()` and `loadBp()` via `page.evaluate()` to inject blueprints directly (avoiding URL length limits). Console warnings/errors and JS exceptions are captured per blueprint.

**Prerequisites:** Both dev servers must be running before tests:

- Terminal 1: `cd packages/website && vp dev` (Vite on port 8080)
- Terminal 2: `npx serve packages/exporter/data/output -l 8081 --cors` (sprite data)

Start them in that order and check the port Vite reports. If something else already holds 8080, Vite silently falls back to 8081 and then proxies `/data` to itself, which looks like the sprite server failing rather than a port clash. Pin it with `vp dev --port 8080 --strictPort` to get a clear failure instead.

If 8080 is taken, run Vite elsewhere and point the specs at it with `FBE_BASE_URL` rather than editing `playwright.config.ts`. The sprite data server must stay on 8081 either way - the Vite dev proxy hardcodes it.

```fish
cd packages/website; vp dev --port 8090 --strictPort
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
- TypeScript has pre-existing type errors in Space Age code (`as any` casts used where prototype types don't match runtime data from data.json). What is left is spread more evenly now that `spriteDataBuilder.ts` is down to 83 of the 270; use `need(e, 'field')` there rather than reading an optional prototype field directly - see issue #22
- Mobile is view-only - no editing, inventory, or keyboard shortcuts
