# Factorio Blueprint Editor - Development Guide

## Project Overview

Web-based Factorio blueprint viewer/editor using PixiJS. Fork adding Space Age DLC support on branch `wormeyman-space-age-support`. Upstream repo: `teoxoy/factorio-blueprint-editor`, tracking issue #268.

## Monorepo Structure

- `packages/editor/` - Core editor library (PixiJS rendering, blueprint parsing, entity logic)
- `packages/exporter/` - Extracts entity data and sprites from Factorio install
- `packages/website/` - Vite-based web frontend that hosts the editor

## Key Commands

```fish
# Dev server (from packages/website/)
npm run start

# Static file server for sprite data (separate terminal, from repo root)
npx serve packages/exporter/data/output -l 8081 --cors

# Build
cd packages/website && npx vite build

# Type check (has pre-existing errors from Space Age work)
npx tsc --noEmit -p packages/editor/tsconfig.json
```

## Dev Server Setup

Vite dev server runs on port 8080. In dev mode, `/data` is proxied to `http://127.0.0.1:8081` (the static file server serving sprite data). In production builds, `vite-plugin-static-copy` copies sprite data into the build output.

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
- `packages/editor/src/containers/EntitySprite.ts` - Creates PixiJS sprites from sprite data. `getParts()` is the main entry point.
- `packages/editor/src/containers/BlueprintContainer.ts` - Main rendering container. `spawnPaintContainer()` handles entity placement from inventory.
- `packages/editor/src/containers/EntityContainer.ts` - Per-entity container, calls `EntitySprite.getParts()` in `redraw()`.
- `packages/editor/src/UI/InventoryDialog.ts` - Inventory panel (press E). Filters items by what's in FD.entities.

### Sprite Data Patterns (in spriteDataBuilder.ts)

Common patterns for `draw_*` functions:

| Pattern | Description | Example |
|---|---|---|
| Static layers | `return () => e.picture.layers` | `draw_container` |
| 4-way animation | `return (data) => getAnimation(e.graphics_set.animation, data.dir).layers` | `draw_burner_mining_drill` |
| Direction-indexed | `return (data) => e.sprites[util.getDirName(data.dir)].layers` | `draw_constant_combinator` |
| X-offset sheet | `duplicateAndSetPropertyUsing(layer, 'x', 'width', data.dir / 4)` | `draw_electric_pole` |
| Y-offset sheet | `duplicateAndSetPropertyUsing(layer, 'y', 'height', data.dir / 4)` | `draw_ammo_turret` |
| Multi-file (filenames) | `l.filename = l.filenames[data.dir / 4]` | `draw_locomotive`, `draw_cargo_wagon` |
| Rail 8-way | `e.pictures[util.getDirName8Way(dir)]` then pick layer keys | `draw_rail` |
| Flatten picture array | `e.graphics_set.picture.flatMap(p => p.layers)` | `draw_cargo_bay` |
| Chargable graphics | `e.chargable_graphics.picture.layers` | `draw_accumulator` |

### Space Age Specifics

- **Multi-file sprites**: Space Age entities (especially foundry) use `filenames: string[]` instead of single `filename`. `EntitySprite.getParts` handles this with a `filenames[0]` fallback.
- **Non-directional pipe_picture**: Foundry's `pipe_picture` is a single sprite object, not a `{north, east, south, west}` map. `spriteDataBuilder.ts` handles this with a fallback.
- **Signal types**: Space Age adds `space-location`, `asteroid-chunk`, `quality` signal types beyond the base `item`, `virtual`, `fluid`, `recipe`, `entity`.
- **Blueprint validation**: Made lenient to handle Space Age content. Unknown entity names are stripped; other validation failures (unknown signals, new enum values) are logged as warnings but don't block loading.

## Version Constraints

- **basisu v1.16.4** encoder/transcoder must match - bundled transcoder at `packages/editor/src/basis/transcoder.1.16.4.js`
- **Current basisu binary** is macOS ARM64 (`packages/exporter/basisu`) - needs cross-platform support (see TODO in exporter)

## Testing

Load blueprints from factorio.school to test:
```
http://localhost:8080?source=https://www.factorio.school/api/blueprintData/{hash}/
```

Key things to test:
- Blueprint books with Space Age entities load without errors
- Entity placement from inventory (press E, click entity, click to place)
- Entities with complex sprite formats (foundry, trains, elevated rails) render
- Copy/paste blueprint strings (Ctrl+C/V with canvas focused)

## Known Limitations

- Train entity sprites use 256-direction spritesheets mapped to 4 cardinal directions - orientation is approximate
- Complex visualizations (crane arms, plasma effects, thruster flames) show only static base sprites
- Blueprint book icons using planet names show no icon
- Some entity types may have missing or incorrectly mapped textures
- TypeScript has pre-existing type errors in Space Age code (`as any` casts used where prototype types don't match runtime data from data.json)
