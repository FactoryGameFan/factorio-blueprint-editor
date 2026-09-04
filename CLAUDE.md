# Factorio Blueprint Editor development guide

## Project

This repository is `FactoryGameFan/factorio-blueprint-editor`, deployed at
<https://fbe.factorygamefan.com>. It adds Factorio 2.x and Space Age support to
the original editor.

The default and deployment branch is `wormeyman-space-age-support`. Branch from
it and target pull requests at it. Use a descriptive commit subject; put issue
closing references such as `Closes #123` in the pull request body.

## Repository layout

- `packages/editor` - blueprint model, PixiJS renderer, controls, and unit tests
- `packages/website` - Vite entry point and browser UI
- `packages/worker` - Cloudflare Worker serving the built website
- `packages/exporter` - Rust extractor for Factorio prototype and sprite data
- `tests` - Playwright browser and blueprint-corpus tests
- `test-blueprints` - committed real-world blueprint corpus
- `tools/oracle` - probes that ask a local Factorio installation what it does
- `docs/superpowers` - `plans` (9) and `specs` (6) for larger past changes
- `.github/workflows` - CI and deploy; `README.md` holds the job rationale

## Setup and commands

The pinned toolchain is Vite+ 0.3.0 with its managed Node/npm. Prepend
`~/.vite-plus/bin` to `PATH`; the root package requires npm 12.

```sh
curl -fsSL https://vite.plus -o vp-install.sh
VP_HOME="$HOME/.vite-plus" VP_VERSION=0.3.0 VP_NODE_MANAGER=yes bash vp-install.sh
rm vp-install.sh
vp install
```

`VP_HOME` is load-bearing from 0.3.0 on. A default install now follows the XDG
layout and puts the binaries in `~/.local/share/vite-plus/bin`, so dropping it
makes the `PATH` line above wrong and `vp` looks missing rather than misplaced.
`.github/actions/setup-vp/action.yml` pins the same layout for the same reason.

Prepend rather than append, because Vite+ works through shims. It installs
`node`, `npm`, `npx` and `corepack` into that one directory, and each of them
resolves a version per directory at the moment you run it. Any other `node` or
`npm` earlier on `PATH` wins instead, and the shims are then never consulted.

Node and npm are two separate pins, which is the part worth knowing. The Node
version comes from `.node-version` (24.20.0). The npm version comes from
`devEngines.packageManager` in the root `package.json`, and Vite+ keeps it in
`~/.vite-plus/package_manager/npm/<version>/` rather than using the one inside
the Node install. That matters because the npm bundled inside Node 24.20.0 is
11.19.0. A Node version manager on its own - fnm, nvm, asdf - therefore cannot
satisfy this repo whichever Node it selects, because npm 12 comes from Vite+
and from nowhere else.

The symptom when something else's npm wins is `EBADDEVENGINES`:

```
npm error EBADDEVENGINES Invalid semver version "^12" does not match "11.19.0"
```

Every `npm` and `npx` command fails that way, including the `npx tsc` line
below, which reads as a broken repository rather than a misordered `PATH`.
`vp env doctor` identifies it - the PATH section marks each tool `(vp shim)` or
`(not vp shim)` - but it reports the mismatch as a warning and still ends in
`All checks passed`, so read that section rather than the verdict.

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

`vp check --fix .` is valid; flags must precede the path. Prefer `vp check` over
`vp fmt --check` plus `vp lint`: it ends with an error and warning count, so a
tailed log still shows a failure - missing `vp lint`'s single error line has
already reached CI here.

There is deliberately no root `tsc` command. The root tsconfig is a base to
extend - no `include`, no `lib`, and `node` in `types` for the Playwright
specs - so a bare `tsc` against it compiles the whole tree under settings no
package builds with. Measured, that reports 5 errors that neither a build nor
`vp check` sees: four in editor code checked against node's fetch types
(`r.json()` gives `unknown`), one in website code checked against node
globals. Every package is at 0 under its own project. To check one, name it,
for example:

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

## Dependencies

Renovate proposes updates; `.github/renovate.json5` carries the reasoning for
every hold. The routine pass is `npm update --save`, and carets are preferred
over exact pins.

- Renovate extracts from manifests; Dependabot scans the resolved lockfile. A
  transitive-only advisory therefore never becomes a Renovate PR - a
  consequence of `lockFileMaintenance: { enabled: false }` in `renovate.json5`.
- Before acting on a transitive advisory, read the parent's declared range: an
  exact pin means it is not actionable, a range means it is.
- `undici` has open advisories with no in-range fix. It is blocked upstream
  behind two exact pins (`wrangler` → `miniflare` → `undici`) and is dev-only.
  Do not run `npm audit fix`: measured, it does not fix `undici`, it pulls
  `miniflare` to a major alpha, and `--force` downgrades `wrangler`.
- `ajv` is ~100 kB minified and nothing branches on its result; `bpString.ts`
  logs and loads whether validation passes or fails.

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

- `packages/editor/src/core/bpString.ts` - encode, decode, schema validation,
  and removal of unknown prototypes
- `packages/editor/src/core/blueprintSchema.json` - accepted blueprint shape
- `packages/editor/src/core/nameMigrations.ts` - version-scoped prototype renames
- `packages/editor/src/core/Blueprint.ts` - entity creation, serialization, wires
- `packages/editor/src/core/Book.ts` - nested books and active-index conversion
- `packages/editor/src/core/Entity.ts` - accessors over raw blueprint entities
- `packages/editor/src/core/PositionGrid.ts` - placement and overlap rules
- `packages/editor/src/core/spriteDataBuilder.ts` - entity rendering dispatch
- `packages/editor/src/core/spriteShape.ts` - typed-factorio union narrowing
- `packages/editor/src/core/need.ts` - required prototype-field reads
- `packages/editor/src/containers/OverlayContainer.ts` - icons and overlays
- `packages/editor/src/common/globals.ts` - globals assigned during `Editor.init`

## Invariants worth preserving

- Load Factorio data before reading `FD`; pre-load reads intentionally throw
  with the missing property name.
- Blueprint constructor input is partial because paint/copy operations create
  blueprints without a version. Do not treat a missing version as version zero.
- Keep migrations conditional on the blueprint's declared version. Current
  Factorio can reuse an old prototype name.
- A blueprint book's `active_index`, and the `index` on each of its entries,
  are inventory **slots**, not positions in the `blueprints` array. A book with
  empty slots exports a dense array with sparse `index` values, so
  `blueprints[active_index]` is the wrong lookup and can be out of range
  entirely. An active slot that holds nothing is legal and means the first
  blueprint. Measured in the shipped binary; `Book.ts` carries the citation.
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
`west`; filenames use `__base__`, `__core__`, `__quality__`, `__space-age__`,
or `__elevated-rails__` prefixes that map into exporter output directories.
`spriteDataBuilder.ts`'s file header lists the `draw_*` patterns.

An empty list in `data.json` is `{}`, not `[]` - an empty Lua table cannot say
which it was. A field typed `readonly X[] | undefined` therefore has a third
runtime shape that survives both a `!== undefined` guard and `?? []`, then
throws "is not iterable" in the first `for-of`. Read list-typed prototype fields
through an `Array.isArray` accessor; `recipeIngredients()` and `recipeResults()`
in `factorioData.ts` are the ones that exist so far. Localised names likewise
have more than one shape; read them through `localisedName()`.

## Testing

Unit tests cover pure model and rendering decisions. Playwright covers the
decode → model → render/serialize path with loaded Factorio data and the real
browser UI. The committed corpus is mostly modern blueprints and reaches only
part of the pre-2.0 work: the `UPSTREAM-277` collection added two 1.1-era files
that exercise the rename table in `nameMigrations.ts` and the combinator shape
migration in `Blueprint.ts`, but no committed blueprint holds an array-shaped
`request_filters`. For that branch, and for any version you need exactly,
create a synthetic blueprint with `tests/helpers/encode-blueprint.ts`.

Browser tests use `window.__fbe_test` to load sources without URL-length
limits. That hook is assigned only under `import.meta.env.DEV` (#292), so the
specs need the dev server `npm run localpreview` starts. Run against
`vp preview` / `preview:website` - a production bundle, no hook - every spec
instead burns its 60s wait on a function that never appears, and the only
symptom is a timeout that names nothing (#321). `vp preview` binds 4173, not
8080, so that mistake surfaces as a connection refused rather than a hang.
Tests that dispatch pointer input should call `suppressOverlays(page)` before
navigation so toasts and the settings panel cannot intercept events. Do not
edit files while a Playwright run is active: Vite reloads the page and destroys
the test's execution context.

CI runs checks, Rust builds on Linux and Windows, four Playwright shards, and a
Cloudflare deployment after both checks and browser tests pass.

### Running the browser suite under WSL2

Chromium's default settings destroy the whole WSL virtual machine, not just the
browser process - `Wsl/Service/E_UNEXPECTED`, needing `wsl.exe --shutdown` to
recover. It is not a missing-library fault: the binary starts and prints its
version, then the VM dies when a page renders. The cause is the GPU
paravirtualisation path, since WSLg is running and `/dev/dxg` is present, so
Chromium crosses into the Windows GPU driver. Forcing software rendering keeps
it inside the VM.

`playwright.wsl.config.ts` spreads the committed config and adds those flags.
CI is unaffected - it applies only when passed explicitly:

```sh
export DISPLAY= WAYLAND_DISPLAY=
npx playwright test --config playwright.wsl.config.ts
```

Blanking those two variables is required, not cosmetic: they are what attaches
Chromium to WSLg in the first place.

`playwright install-deps` needs root, and on a machine where `sudo -n` fails the
libraries can be unpacked into a private prefix instead - `apt-get download`
needs no root:

```sh
apt-get download libnspr4 libnss3 libasound2t64
for f in *.deb; do dpkg -x "$f" ~/pw-libs; done
export LD_LIBRARY_PATH=~/pw-libs/usr/lib/x86_64-linux-gnu
```

Re-run `ldd` on the Chromium binary after a Playwright upgrade; the missing set
can grow.

**Software rendering does not reproduce every spec, so know which half you are
in before recording a fixture from a local run.** Measured 2026-09-04 against a
clean base branch that is green in CI:

| Spec                               | Local under swiftshader |
| ---------------------------------- | ----------------------- |
| `blueprint-round-trip.spec.ts`     | passes                  |
| `entity-accessors.spec.ts`         | passes                  |
| `sprite-data.spec.ts` (both cases) | passes                  |
| `overlay-container.spec.ts`        | **fails**               |
| `sprite-generation.spec.ts`        | **fails**               |

The two failures are the same page error, and it is the renderer rather than
the model:

```
TypeError: Failed to execute 'drawImage' on 'CanvasRenderingContext2D':
The provided value is not of type '(CSSImageValue or HTMLCanvasElement or ...)'
```

Both specs assert `pageErrors` is empty, so they fail on that line rather than
on a value. The specs whose pins are model-level checksums and tallies are
unaffected and can be recorded here; **`overlay-container` and
`sprite-generation` must be recorded from CI.** Re-check this table rather than
assuming it, because which specs touch a canvas can change.

**Do not try removing `--disable-software-rasterizer` to fix those two.** It
sits next to `--use-gl=swiftshader` and reads as a contradiction, because
SwiftShader is the software rasterizer, so it looks like the cause of the
`drawImage` failure. Measured on WSL2 at `ece449f5`, it is not. With that one
flag dropped and every other flag kept, the two specs go from 2 of their 4 tests
failing to all 4, `drawImage` disappears from the log entirely, and
`waitForEditor` times out after 120 s because the editor never initialises. The
flag is load-bearing in the opposite direction from the guess.

Two rules the specs cannot enforce:

- A green suite says nothing about how a feature feels. For anything with a
  radius, a threshold, or a step order, drive the editor and print numbers
  before calling it done.
- An intermittent spec usually has a deterministic bug under it. Find the
  mechanism rather than adding a retry.

## Asking Factorio

Read `tools/oracle/README.md` before adding or recapturing a probe. Search the
matching `factorio-data` release first; use a probe for engine behavior that the
Lua source cannot answer.

Each probe creates an isolated temporary mod, writes its config, runs Factorio,
and reads the JSON dump. Set `FACTORIO_BIN` or use the macOS Steam default. A
deliberate `error("DUMPED-OK")` is success; the dump file, not Factorio's exit
code, decides whether a run worked.

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

The Rust exporter has two input paths - downloaded data and a local install -
but both route sprite compression through the same implementation in
`setup.rs`.

## Deployment

`npm run build:website` creates `packages/website/dist`. The worker configuration
is `packages/worker/wrangler.jsonc`; GitHub Actions deploys after checks and e2e
tests pass. Required secrets are `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

## Visitor counts

Two counters measure the same thing from opposite sides, and they are meant to
disagree.

- Cloudflare Web Analytics. `packages/website/vite.config.js` injects the beacon
  at build time when `CF_BEACON_TOKEN` is set, which only the deploy job does.
  Unset, the tag is omitted and the build is otherwise identical. Read it in the
  Cloudflare dashboard. It counts sessions that ran JavaScript, so ad blockers
  and crawlers are missing from it.
- A server-side count in the Worker. `packages/worker/src/visitorCount.ts` holds
  the rules and the definition: one GET of `/` per IP + User-Agent +
  Accept-Language per UTC day, deduped in the Cache API and written to the
  `fbe_unique_visitors` Analytics Engine dataset. Nothing identifying is stored;
  the fingerprint is a cache key and never reaches the dataset. Analytics Engine
  has no dashboard, so read it over the SQL API with the query in the
  `recordVisit` comment in `packages/worker/src/index.ts` - and note it has no
  `uniq()` or `COUNT(DISTINCT)`, which is why deduplication happens at write
  time and a query is a plain `SUM(_sample_interval)`.

Neither number is exact. The Worker count runs high (per-colo dedupe, a
check-then-act race inside that dedupe, and crawlers that send a browser's
`Accept`); the beacon runs low. The gap between them is the useful part.

`tests/visitor-count.test.ts` covers the pure rules and pins the beacon's hosts
against the CSP in `packages/website/public/_headers` that permits them.

## Known limits

- Mobile is a read-only viewer; editing remains desktop-only.
- Some complex animations render only static base sprites.
- Train sprites approximate 256 orientations with four cardinal frames.
- Planet (`space-location`) icons have no exported prototype, and `F.CreateIcon`
  ends in a bare `throw` for a name it cannot resolve. Below a `try` (an
  `OverlayContainer` or `SafeIcon` boundary) that is a missing icon; on a path
  with none it loses the whole blueprint. Serialization keeps the icon's signal
  (issue #264); drawing it is still open (issue #231).
- `getDirName` throws on diagonal directions, so any `draw_*` that calls it
  renders a placeholder for a diagonally-placed entity. `railgun-turret` calls
  it. The hazard is latent, not pinned: no committed test reaches it. The public
  corpus (#191) places the turret at direction 8 only, and the synthetic halves
  of `sprite-data.spec.ts` sweep cardinals alone, so
  `tests/__fixtures__/sprite-data.json` records it succeeding with 8 layers. It
  was pinned failing against the private corpus this one replaced.
- Rail placement models rails as integer tile rectangles where Factorio uses
  continuous collision geometry, so it is wrong in both directions - it accepts
  some arrangements the game refuses and refuses 24 measured cases the game
  accepts (an identical curved rail on an identical curved rail). Preserve the
  measured exceptions and the `tools/oracle` fixtures. Per-rail collision
  shapes will not close it: #133 measured that occupancy is not a property
  of the rail, because which cells it blocks depends on the size of the box
  asking, and #142 measured that the game's published `tile_width` does not
  help either. Both are closed. #183 is the live rail defect.
- Logistic filters retain quality metadata but the UI has no quality picker.
- Blueprint icons round-trip, but the UI has no icon picker.
