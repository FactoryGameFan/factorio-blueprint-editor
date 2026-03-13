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

The Lua extractor (`data-final-fixes.lua`) already iterates generically over `data.raw` - it will automatically include Space Age items, recipes, and entities once they are present. Locale generation also continues unchanged - it scans `factorio_data` generically and picks up Space Age locale files automatically. No changes are needed to the schema validator, factorioData.ts, or the HTTP server.

---

## Solution

Add a `FACTORIO_DIR` environment variable. When set, the exporter skips the download step entirely and uses the local Factorio installation at that path. Because Space Age (and the Quality and Elevated Rails expansions) are bundled into the game install by the Factorio/Steam launcher, running the local executable automatically loads all DLC content into `data.raw`.

---

## Design

### New Environment Variable

| Variable | Required | Description |
|---|---|---|
| `FACTORIO_DIR` | No | Path to the local Factorio installation root (see platform notes). When set, skips download. |
| `FACTORIO_USERNAME` | Only when `FACTORIO_DIR` is unset | Existing credential for download flow. |
| `FACTORIO_TOKEN` | Only when `FACTORIO_DIR` is unset | Existing credential for download flow. |

The `.env` file in `packages/exporter/` is the standard mechanism for setting these (loaded via `dotenvy` at startup).

### Platform Path Layout

`FACTORIO_DIR` is the Factorio installation root. Platform-specific paths derived from it:

| Platform | `FACTORIO_DIR` example | Executable | Game data dir |
|---|---|---|---|
| macOS | `/Applications/Factorio` or Steam path | `{FACTORIO_DIR}/factorio.app/Contents/MacOS/factorio` | `{FACTORIO_DIR}/factorio.app/Contents/data/` |
| Linux | `~/.steam/steam/steamapps/common/Factorio` | `{FACTORIO_DIR}/bin/x64/factorio` | `{FACTORIO_DIR}/data/` |
| Windows | `C:\Program Files\Factorio` | `{FACTORIO_DIR}\bin\x64\factorio.exe` | `{FACTORIO_DIR}\data\` |

On macOS the game's `data/` directory is inside the app bundle. All sprite path resolution and locale generation must use the platform-specific game data dir, not a simple `{FACTORIO_DIR}/data/` join.

**Steam on macOS:** `FACTORIO_DIR` would be set to `/Users/<user>/Library/Application Support/Steam/steamapps/common/Factorio`.

### User Data Directory

The Factorio user data directory (where mods and `script-output/` live) is auto-detected per platform. No env var is needed.

| Platform | User data dir | Resolution in Rust |
|---|---|---|
| macOS | `~/Library/Application Support/factorio` | `dirs::data_dir()` + `"factorio"` or hardcoded platform path |
| Linux | `~/.factorio` | `dirs::home_dir()` + `".factorio"` |
| Windows | `%APPDATA%\Factorio` | `std::env::var("APPDATA")` + `"Factorio"` |

### Validation

Before proceeding, when `FACTORIO_DIR` is set, the implementation must validate:

1. The resolved executable path exists and is a file.
2. The resolved game data directory exists.

If either check fails, exit with a human-readable error such as:

```
FACTORIO_DIR is set to "/path/to/factorio" but executable not found at "/path/to/factorio/factorio.app/Contents/MacOS/factorio".
Check that FACTORIO_DIR points to your Factorio installation root.
```

### Modified Export Flow

**When `FACTORIO_DIR` is set (new local flow):**

```
1. Resolve + validate executable path and game data dir from FACTORIO_DIR + platform
2. Auto-detect user data directory from platform
3. Write export-data mod → {user_data_dir}/mods/export-data/
   (fail with clear error if mods directory is not writable)
4. Write scenario → {user_data_dir}/scenarios/export-data/control.lua
5. Run local Factorio executable with scenario
   → data.raw includes Space Age (bundled in game install)
   → data-final-fixes.lua exports all content (no changes needed)
   → control.lua writes to {user_data_dir}/script-output/data.json
6. Read {user_data_dir}/script-output/data.json
7. Process sprites: resolve __modname__ paths against game data dir
8. Convert PNGs to .basis, serve via HTTP on :8081
9. Clean up: remove {user_data_dir}/mods/export-data/ and
             {user_data_dir}/scenarios/export-data/
   (log warning if cleanup fails; do not treat as fatal error)
```

**When `FACTORIO_DIR` is unset (existing download flow):**
No change. Existing behavior is preserved exactly.

### Sprite Path Resolution

The current code substitutes only `__core__` and `__base__` prefixes when resolving sprite file paths. Space Age sprites use `__space-age__`, quality uses `__quality__`, and so on. The substitution must be generalized:

**Current (handles only base game):**
```rust
let in_path = factorio_data.join(
    s.replace("__core__", "core").replace("__base__", "base")
);
```

**Required (handles any mod prefix):**
Strip `__modname__` delimiters and join to the game data dir:
```
__<modname>__/path/to/sprite.png  →  {game_data_dir}/<modname>/path/to/sprite.png
```

This generalization is required regardless of which flow is used - it is an existing gap that blocks Space Age sprites even in the download flow if DLC data were somehow present. The fix belongs in the sprite processing step in `setup.rs`.

### Cleanup Behavior

| Scenario | Behavior |
|---|---|
| Mods dir not writable | Fail immediately with clear error before running Factorio |
| Factorio run fails | Still attempt cleanup, then surface Factorio error |
| Cleanup fails | Log warning, do not fail the overall export |

---

## Affected Files

| File | Change |
|---|---|
| `packages/exporter/src/setup.rs` | Add `FACTORIO_DIR` branch; platform-specific path resolution; user data dir detection; validation; generalized sprite prefix substitution; cleanup with warning-on-failure |
| `packages/exporter/src/main.rs` | Remove macOS panic; pass game data dir (not download dir) to sprite processing |

No changes to Lua scripts, schema, TypeScript, or website package.

---

## Contributor Notes

For a maintainer to update the production site's data with Space Age content:

1. Add `FACTORIO_DIR=<path to Factorio install>` to `packages/exporter/.env`
2. Run the exporter: `cargo run --release` from `packages/exporter/`
3. The resulting `data.json` and sprite files will include Space Age content
4. Commit the updated data and redeploy

---

## Out of Scope

- Downloading Space Age from any API (not possible - DLC is launcher-distributed)
- Supporting user-installed mods from the mods directory (non-standard data would break the shared site)
- Rendering changes for Space Age entities (type definitions already exist in TypeScript; rendering gaps are a separate concern)
