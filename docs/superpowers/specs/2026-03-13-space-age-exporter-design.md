# Space Age Exporter Support - Design Spec

**Date:** 2026-03-13
**Goal:** Enable Factorio Blueprint Editor to support Factorio 2.0 + Space Age blueprints by allowing the exporter to use a local Factorio installation instead of downloading the base game.

---

## Problem

The live site (fbe.teoxoy.com) rejects blueprints containing Space Age items (e.g. `agricultural-science-pack`) with a schema validation error:

```
must pass "itemFluidSignalRecipeEntityName" keyword validation
```

**Root cause:** The exporter downloads only the base Factorio game. Space Age is a paid DLC bundled into the game installation by the Factorio/Steam launcher - it cannot be downloaded separately via API. Because Space Age content never loads into `data.raw` during export, those items are absent from the exported dataset, and the AJV schema validator rejects them as unknown.

**Secondary problem:** The exporter panics on macOS, making local development impossible for macOS users.

---

## What Does NOT Need to Change

The Lua extractor (`data-final-fixes.lua`) already iterates generically over `data.raw` - it will automatically include Space Age items, recipes, and entities once they are present. No changes are needed to the schema validator, factorioData.ts, or the HTTP server.

---

## Solution

Add a `FACTORIO_DIR` environment variable. When set, the exporter skips the download step entirely and uses the local Factorio installation at that path. Because Space Age (and the Quality and Elevated Rails expansions) are bundled into the game install by the Factorio/Steam launcher, running the local executable automatically loads all DLC content into `data.raw`.

---

## Design

### New Environment Variable

| Variable | Required | Description |
|---|---|---|
| `FACTORIO_DIR` | No | Path to local Factorio installation. When set, skips download and uses local executable. |
| `FACTORIO_USERNAME` | Only when `FACTORIO_DIR` is unset | Existing credential for download flow. |
| `FACTORIO_TOKEN` | Only when `FACTORIO_DIR` is unset | Existing credential for download flow. |

### Executable Path Resolution

When `FACTORIO_DIR` is set, the executable path is derived per platform:

| Platform | Path |
|---|---|
| macOS | `{FACTORIO_DIR}/factorio.app/Contents/MacOS/factorio` |
| Linux | `{FACTORIO_DIR}/bin/x64/factorio` |
| Windows | `{FACTORIO_DIR}/bin/x64/factorio.exe` |

### User Data Directory

The Factorio user data directory (where mods and `script-output/` live) is auto-detected per platform with no additional env var required:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/factorio` |
| Linux | `~/.factorio` |
| Windows | `%APPDATA%\Factorio` |

### Modified Export Flow

**When `FACTORIO_DIR` is set (new local flow):**

```
1. Resolve executable path from FACTORIO_DIR + platform
2. Auto-detect user data directory from platform
3. Write export-data mod to {user_data_dir}/mods/export-data/
4. Run local Factorio executable with scenario
   → data.raw includes Space Age (bundled in game install)
   → data-final-fixes.lua exports all content (no changes needed)
   → control.lua writes {user_data_dir}/script-output/data.json
5. Read data.json
6. Process sprites: resolve paths against FACTORIO_DIR
7. Convert PNGs to .basis, serve via HTTP on :8081
8. Clean up export-data mod from mods directory
```

**When `FACTORIO_DIR` is unset (existing download flow):**
No change. Existing behavior is preserved exactly.

### Sprite Path Resolution

The exporter currently resolves sprite file paths against the downloaded Factorio directory. When using a local install, sprite paths must be resolved against `FACTORIO_DIR` instead. This requires passing the Factorio root path through to the sprite processing step, which currently receives it implicitly from the download location.

### Cleanup

The `export-data` mod is written to the user's mods directory before the run and removed after. This avoids permanently polluting the user's mod list.

---

## Affected Files

| File | Change |
|---|---|
| `packages/exporter/src/setup.rs` | Main changes: add `FACTORIO_DIR` branch, platform executable resolution, user data dir detection, cleanup |
| `packages/exporter/src/main.rs` | Remove macOS panic; pass Factorio root path to sprite processing |

No changes to Lua scripts, schema, TypeScript, or website package.

---

## Contributor Notes

For a maintainer to update the production site's data with Space Age content:

1. Set `FACTORIO_DIR` to the local Factorio installation (with Space Age owned and installed)
2. Run the exporter: `cargo run --release`
3. The resulting `data.json` and sprite files will include Space Age content
4. Commit the updated data and redeploy

---

## Out of Scope

- Downloading Space Age from any API (not possible - DLC is launcher-distributed)
- Supporting user-installed mods from the mods directory (non-standard data would break the shared site)
- Rendering changes for Space Age entities (type definitions already exist in TypeScript; rendering gaps are a separate concern)
