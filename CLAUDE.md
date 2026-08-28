# Factorio Blueprint Editor development guide

## Project

This repository is `FactoryGameFan/factorio-blueprint-editor`, deployed at
<https://fbe.factorygamefan.com>. It adds Factorio 2.x and Space Age support to
the original editor.

The default and deployment branch is `wormeyman-space-age-support`. Branch from
it and target pull requests at it. Use a descriptive commit subject; put issue
closing references such as `Closes #123` in the pull request body.

## Repository layout

- `packages/editor` — blueprint model, PixiJS renderer, controls, and unit tests
- `packages/website` — Vite entry point and browser UI
- `packages/worker` — Cloudflare Worker serving the built website
- `packages/exporter` — Rust extractor for Factorio prototype and sprite data
- `tests` — Playwright browser and blueprint-corpus tests
- `test-blueprints` — committed real-world blueprint corpus
- `tools/oracle` — probes that ask a local Factorio installation what it does

## Setup and commands

The pinned toolchain is Vite+ 0.2.9 with its managed Node/npm. Put
`~/.vite-plus/bin` on `PATH`; the root package requires npm 12.

```sh
curl -fsSL https://vite.plus -o vp-install.sh
VP_HOME="$HOME/.vite-plus" VP_VERSION=0.2.9 VP_NODE_MANAGER=yes bash vp-install.sh
rm vp-install.sh
vp install
```

Common commands:

```sh
npm run localpreview        # website on 8080, sprite data on 8081
npm run build:website
vp check                    # format, lint, and package-aware type checking
vp check --fix
vp test                     # unit tests
npx playwright test         # browser tests; localpreview must be running
cargo check --manifest-path packages/exporter/Cargo.toml
```

`vp check --fix .` is valid; flags must precede the path. There is no root
`tsc` command because the root tsconfig is only a base. To check one package,
use its own project, for example:

```sh
npx tsc --noEmit -p packages/editor/tsconfig.json
```

If port 8080 is occupied, move only Vite and tell Playwright where it went:

```sh
npm run localpreview -- --port 8090
FBE_BASE_URL=http://localhost:8090 npx playwright test
```

The sprite server must stay on 8081 because Vite's development proxy targets
that port. Run `npx playwright install` after changing `@playwright/test`.

## Architecture

The exporter writes `packages/exporter/data/output/data.json` and compressed
textures. In development the editor fetches those through Vite's `/data`
proxy; production builds copy them into the website bundle.

The main flow is:

1. `factorioData.ts` loads `data.json` into `FD`.
2. `bpString.ts` decodes and validates a blueprint string.
3. `Blueprint.ts`, `Book.ts`, and `Entity.ts` create the editable model.
4. `BlueprintContainer.ts` and `EntitySprite.ts` render the model.
5. `spriteDataBuilder.ts` maps Factorio prototypes to sprite layers.

Key files:

- `packages/editor/src/core/bpString.ts` — encode, decode, schema validation,
  and removal of unknown prototypes
- `packages/editor/src/core/blueprintSchema.json` — accepted blueprint shape
- `packages/editor/src/core/nameMigrations.ts` — version-scoped prototype renames
- `packages/editor/src/core/Blueprint.ts` — entity creation, serialization, wires
- `packages/editor/src/core/Book.ts` — nested books and active-index conversion
- `packages/editor/src/core/Entity.ts` — accessors over raw blueprint entities
- `packages/editor/src/core/PositionGrid.ts` — placement and overlap rules
- `packages/editor/src/core/spriteDataBuilder.ts` — entity rendering dispatch
- `packages/editor/src/core/spriteShape.ts` — typed-factorio union narrowing
- `packages/editor/src/core/need.ts` — required prototype-field reads
- `packages/editor/src/containers/OverlayContainer.ts` — icons and overlays
- `packages/editor/src/common/globals.ts` — globals assigned during `Editor.init`

## Invariants worth preserving

- Load Factorio data before reading `FD`; pre-load reads intentionally throw
  with the missing property name.
- Blueprint constructor input is partial because paint/copy operations create
  blueprints without a version. Do not treat a missing version as version zero.
- Keep migrations conditional on the blueprint's declared version. Current
  Factorio can reuse an old prototype name.
- Entity accessors preserve the distinction between absent values and empty or
  zero values. Tests in `entity-accessors.spec.ts` pin this behavior.
- Logistic filter writes must retain unknown sections and per-filter quality,
  comparator, and maximum-count fields.
- `PositionGrid` and `EntityContainer` throw when their indexes drift from the
  model. A missing indexed entity is an invariant failure, not a normal lookup.
- `need()` belongs only below a caller that can catch a missing sprite field.
  Without such a boundary, use a fallback or guard so one bad asset cannot lose
  the whole blueprint.
- `railSignalSpots.ts` is generated from
  `tools/oracle/fixtures/rail-signal-spots.json`; regenerate it with
  `generate-rail-signal-spots.mjs` instead of editing it.
- Generated exporter output is committed. Do not hand-edit `data.json` or
  texture files.

## Sprite data

Factorio sprite fields may be a single sprite, a directional object, an array,
or a layered wrapper. Reuse the helpers in `spriteShape.ts` rather than adding
local shape checks. Directional sprites use `north`, `east`, `south`, and
`west`; filenames use `__base__`, `__core__`, `__quality__`, or
`__space-age__` prefixes that map into exporter output directories.

Space Age recipe ingredients/results can be tuples or objects. Read them with
`recipeIngredients()` and `recipeResults()` from `factorioData.ts`. Localised
names also have multiple shapes; use `localisedName()`.

## Testing

Unit tests cover pure model and rendering decisions. Playwright covers the
decode → model → render/serialize path with loaded Factorio data and the real
browser UI. The committed corpus is useful for modern blueprints but does not
cover pre-2.0 migrations; create a synthetic blueprint at the required version
with `tests/helpers/encode-blueprint.ts` for those branches.

Browser tests use `window.__fbe_test` to load sources without URL-length limits.
Tests that dispatch pointer input should call `suppressOverlays(page)` before
navigation so toasts and the settings panel cannot intercept events. Do not
edit files while a Playwright run is active: Vite reloads the page and destroys
the test's execution context.

CI runs checks, Rust builds on Linux and Windows, four Playwright shards, and a
Cloudflare deployment after both checks and browser tests pass.

## Asking Factorio

Read `tools/oracle/README.md` before adding or recapturing a probe. Search the
matching `factorio-data` release first; use a probe for engine behavior that the
Lua source cannot answer.

Most probes use `factorio-probe.mjs`, which creates an isolated temporary mod,
writes its config, runs Factorio, and reads the JSON dump. Set `FACTORIO_BIN` or
use the macOS Steam default. A deliberate `error("DUMPED-OK")` is success; the
dump file, not Factorio's exit code, decides whether a run worked.

Fixtures change only behind each probe's `--write-fixture` flag. After a
recapture, run `vp check --fix` and any generator named in the oracle README.
Nothing in normal CI requires Factorio or network access.

## Regenerating Factorio data

Set `FACTORIO_DIR` in `packages/exporter/.env` to a local installation and run:

```sh
npm run start:exporter
```

Without a local installation, `FACTORIO_USERNAME` and `FACTORIO_TOKEN` can
download base-game data, but that path cannot export Space Age. Sprite
compression invokes the repository's `basisu` binary, currently macOS ARM64.

The Rust exporter has two input paths—downloaded data and a local install—but
both route sprite compression through the same implementation in `setup.rs`.

## Deployment

`npm run build:website` creates `packages/website/dist`. The worker configuration
is `packages/worker/wrangler.jsonc`; GitHub Actions deploys after checks and e2e
tests pass. Required secrets are `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

## Known limits

- Mobile is a read-only viewer; editing remains desktop-only.
- Some complex animations render only static base sprites.
- Train sprites approximate 256 orientations with four cardinal frames.
- Planet (`space-location`) icons round-trip but currently have no exported
  prototype to draw.
- `getDirName` rejects diagonal directions, so unsupported diagonal sprite
  paths fall back to the placeholder rendering.
- Rail placement uses integer tile rectangles and is deliberately more
  permissive than Factorio in cases its continuous collision geometry cannot
  express. Preserve measured exceptions and fixtures in `tools/oracle`.
- Logistic filters retain quality metadata but the UI has no quality picker.
- Blueprint icons round-trip, but the UI has no icon picker.
