# Factorio Blueprint Editor development guide

## Project

This repository is `FactoryGameFan/factorio-blueprint-editor`, deployed at
<https://fbe.factorygamefan.com>. It adds Factorio 2.x and Space Age support to
the original editor.

The default and deployment branch is `wormeyman-space-age-support`. Branch from
it and target pull requests at it. Use a descriptive commit subject; put issue
closing references such as `Closes #123` in the pull request body.

### Stacked pull requests

When one change builds on another that has not merged yet, open it as a
GitHub stacked pull request rather than a plain pull request against the
other branch. A stack is a chain: the bottom pull request targets
`wormeyman-space-age-support`, and each one above targets the branch below it.
It is a GitHub public preview, driven by the official `gh stack` extension
(`gh extension install github/gh-stack`). The first stack here was #507 and
#508.

The reason is CI. `ci.yml` runs only for pull requests whose base is the
default branch, so a plain pull request on top of another one gets the Claude
review and nothing else - no checks and no Playwright - until the one below
merges and someone retargets it by hand. Once the two are linked into a stack,
the full CI runs on the upper one too. Measured on #508: its push got only the
Claude review, and linking it started the full CI run within minutes, with no
new push.

Link pull requests into a stack bottom to top. Passing a stack's number first
adds the rest to the top of that stack:

```sh
gh stack link 507 508
```

To merge a whole stack, pass its number. That is the stack's own number,
which `gh stack link` prints and the stack map shows; it is not a pull request
or issue number, so `gh pr view` cannot find it:

```sh
gh stack merge 510 --yes --squash
```

It merges every pull request in one step, all or nothing, and still writes one
squash commit per pull request - stack 510 landed #507 and #508 as two
commits, and closed the issue #508 named. It does not delete the branches.
Merging only part of a stack goes from the bottom: a pull request merges with
every one below it. GitHub's documentation says the lowest pull request left
then targets the default branch on its own, and the rest stay chained above
it. That has not been tried here yet.

CodeRabbit reviews only pull requests whose base is the default branch, so it
skips an upper layer (it did on #508). Comment `@coderabbitai review` to ask for
one. Stacks need every branch in this repository, so a pull request from a fork
cannot join one.

## Repository layout

- `packages/editor` - blueprint model, PixiJS renderer, controls, and unit tests
- `packages/website` - Vite entry point and browser UI
- `packages/worker` - Cloudflare Worker serving the built website
- `packages/exporter` - Rust extractor for Factorio prototype and sprite data
- `tests` - Playwright browser and blueprint-corpus tests
- `test-blueprints` - committed real-world blueprint corpus
- `tools/oracle` - probes that ask a local Factorio installation what it does
- `docs/superpowers` - `specs` (6) for larger past changes
- `.github/workflows` - CI, deploy, and issue triage; `README.md` holds the
  job rationale
- `.devcontainer` - an opt-in Linux container; see "Devcontainer" below

## Setup and commands

The toolchain is Vite+ with its managed Node/npm. Its version is written in
exactly one place, `devDependencies.vite-plus` in the root `package.json` (the
`overrides.vite` alias beside it must carry the same number, because npm
cannot express one as a reference to the other). The workspace packages carry
no pin of their own, and `.github/actions/setup-vp/action.yml` reads that
field with `jq` for both the version it installs and its cache key. Install the
`vp` CLI once:

```sh
curl -fsSL https://vite.plus -o vp-install.sh
VP_HOME="$HOME/.vite-plus" VP_NODE_MANAGER=yes bash vp-install.sh
rm vp-install.sh
```

The installer writes `~/.vite-plus/bin` into your shell's startup files for
new shells; for the current one, prepend it to `PATH` yourself. Then
`vp install` fetches the pinned toolchain. The action verifies the installer
against a sha256 before running it - two scripts, since the vite.plus script
now sources a second one, `install-legacy.sh`, which it looks for beside
itself before downloading it. To get the same guarantee, fetch both into the
same directory and take the `sha256sum -c` lines from the action rather than
from a doc, because those digests rotate on their own and a copy here would go
stale.

The global `vp` does not need to match the pin. It defers to the project's
local `vite-plus` for every tool - measured, a global `vp` one release behind
runs the local vite, vitest and oxlint and `vp check` passes identically, and
outside a repo the same binary reports every tool as "Not found". CI pins it
anyway, for reproducibility. The root package requires npm 12.

`VP_HOME` is load-bearing from 0.3.0 on. A default install now follows the XDG
layout and puts the binaries in `~/.local/share/vite-plus/bin`, so dropping it
makes the `PATH` line above wrong and `vp` looks missing rather than misplaced.
The action sets it for the same reason.

Prepend rather than append, because Vite+ works through shims. It installs
`node`, `npm` and `npx` into that one directory, alongside `pnpm`, `yarn` and
`bun`, and each of them resolves a version per directory at the moment you run
it. There is no `corepack` shim: vite-plus 0.3.1 removed it and manages the
package managers itself. Any other `node` or `npm` earlier on `PATH` wins
instead, and the shims are then never consulted.

Node and npm are two separate pins, which is the part worth knowing. The Node
version comes from `.node-version`. The npm version comes from
`devEngines.packageManager` in the root `package.json`, and Vite+ keeps it in
`~/.vite-plus/package_manager/npm/<version>/` rather than using the one inside
the Node install. Read both files for the numbers; neither is repeated here,
because a copy goes stale the day the pin moves. What matters is that the npm
bundled inside the pinned Node is an older major than the range `devEngines`
asks for. A Node version manager on its own - fnm, nvm, asdf - therefore cannot
satisfy this repo whichever Node it selects, because the npm it needs comes from
Vite+ and from nowhere else.

The symptom when something else's npm wins is `EBADDEVENGINES`. With a bundled
npm 11 against a `^12` range, it reads:

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
globals. Every package is at 0 under its own project. The root tsconfig does
carry one `exclude`, `packages/worker`: its gitignored `worker-configuration.d.ts`
merges Cloudflare's HTMLRewriter `Element` into the DOM's, which made
`vp check` red on `document.body.append` in a Playwright spec on any machine
that had run `wrangler types` while CI, which had no copy of the file, stayed
green. CI's `checks` job now runs `wrangler types` before `vp check`, so it
would catch that, and then type-checks the Worker under its own tsconfig. To
check one package, name it, for example:

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

When 8081 is VS Code forwarding from the devcontainer, a full local run loses
random specs to a timeout in `waitForEditor`, with the page on its loading
screen. That is not the code under test: through Vite's `/data` proxy, about 1
request in 7 gets its `200` and then no body, while requests straight to 8081
all complete (#514). Check with `curl` through the proxy before blaming a
change, and take the full-suite result from inside the devcontainer or from
CI.

### Devcontainer

`.devcontainer/devcontainer.json` builds a Linux container that runs
everything above: `vp check`, `vp test`, `npm run localpreview`, the
Playwright suite, and the exporter's cargo build, test, fmt and clippy. It
starts from the Vite+ image, `ghcr.io/voidzero-dev/vite-plus`, so `vp`, `node`
and `npm` all resolve to `/home/vp/.vite-plus/bin`, from the same two pins as
on the host. That directory is second on `PATH`, not first: the Dockerfile
prepends `/home/vp/.cargo/bin` for the Rust toolchain, and that directory holds
no `node` or `npm`, so it shadows no shim. Measured 2026-09-21 in the built
image on macOS arm64, `PATH` is
`/home/vp/.cargo/bin:/home/vp/.vite-plus/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`.

Measured 2026-09-18 on three hosts: OrbStack on a Mac (linux/arm64), Docker
Engine inside WSL2 on a Windows PC (linux/amd64), and rootless Podman on a
CachyOS laptop (linux/amd64). On all three, `vp check` and `vp test` matched
the host, and the Playwright suite passed, including the two canvas specs that
fail under WSL (see below). The one exception came from memory, not from the
container. On the 3.7 GiB laptop, the kernel's out-of-memory killer took
Chromium's renderer, at about 1.5 GB, during the large-paste test in
`shortcut-bar.spec.ts`. That test passed when run alone, so it is not a flake
to chase. That run predates the switch from the Rust devcontainer feature to
`.devcontainer/Dockerfile`, and has not been repeated on the current image.

It does not do two things:

- **Regenerate Factorio data.** `packages/exporter/basisu` is a macOS arm64
  binary, with a Windows `basisu.exe` beside it, and on Linux the exporter
  looks for an x86-64 `bin/x64/factorio`. Run `npm run start:exporter` on the
  host.
- **Run oracle probes.** They need a local Factorio.

Vite's default host is `localhost`, which resolves `::1` ahead of `127.0.0.1`,
so a default Vite binds `[::1]` alone while a port forwarder dials
`127.0.0.1`, and the host cannot reach it. Measured against VS Code's Dev
Containers extension, which does read `forwardPorts`: it forwarded both ports
correctly, 8081 answered 200 because `npx serve` binds `::` dual-stack, and 8080
timed out on an otherwise healthy Vite. The editor's own Playwright specs never
saw it, because they reach `::1` too.

`containerEnv` sets `FBE_DEV_HOST`, which makes `scripts/localpreview.mjs`
add a bare `--host`, and both ports come up on `::`. Measured from the Mac
afterwards: `localhost:8080` answers 200 through VS Code's forward, and the
container's own address answers 200 directly - so on OrbStack the bare
`devcontainer` CLI does not need the forwarding it does not do
(devcontainers/cli#22). The container's `.orb.local` name connects and returns
403, which is Vite's `allowedHosts` refusing an unfamiliar Host header rather
than a networking fault, and the name is random anyway because VS Code passes
no `--name`.

**That 403 is not what keeps the listener safe.** Measured against the pinned
Vite: `isHostAllowedInternal` returns true for any Host header that parses as an
IPv4 or IPv6 literal, _before_ `allowedHosts` is consulted. Against the real dev
server, `evil.example.com` and `fbe.factorygamefan.com` both got 403 while
`10.1.2.3`, `192.168.1.50` and `[dead::beef]` all got 200. `allowedHosts`
constrains names only, and a peer reaching the server by address sends no name.
What actually keeps it contained is that `forwardPorts` is a VS Code-side
forward and not a docker publish, so nothing puts the port on a real interface.
Note also that `server.fs.deny` defaults do not cover `.dev.vars`, which
`.gitignore` treats as secret.

Do not "fix" that bind with `--host 0.0.0.0`. It binds IPv4 alone and refuses
`::1` - the address the Playwright specs reach, through
`playwright.config.ts`'s default `baseURL` of `http://localhost:8080`. The
value that reads as the more permissive one breaks the suite instead.

`.devcontainer/Dockerfile` installs Rust with a checksum-verified rustup
installer as the non-root `vp` user. It replaces the Rust feature, which added
`SYS_PTRACE` and disabled seccomp through its metadata. No extra capabilities
or security options are requested. The Devcontainer workflow builds the actual
configuration, asserts seccomp is enabled and `SYS_PTRACE` is absent from the
capability bounding set, checks Chromium can render, then runs cargo test, fmt
and clippy.

Rust resolves to stable at build time. The installer checksum does not pin the
toolchain; use a shared `rust-toolchain.toml` if the project adopts a Rust
version policy. When the rustup installer changes, verify it and update its
checksum in the Dockerfile.

`node_modules` is a named volume, not the bind-mounted folder. An install
holds native binaries for one platform (esbuild, oxlint, workerd, sharp and
more), so a shared folder would leave whichever side installed last broken for
the other. `CARGO_TARGET_DIR` moves the Rust build out of the bind mount for
the same reason. There are no devcontainer features or feature lockfile.

Two lines in the CLI's output look like faults and are not. `Error fetching
image details: Could not parse image name` is the CLI failing to parse a tag
plus a digest for a metadata lookup; the build carries on and succeeds. And
under rootless Podman the container runs with `userns=private`, which reads as
if the host user's files would show up root-owned inside. They do not: the CLI
maps the user itself, the workspace shows as `vp` inside, and files written
there land as the host user outside. Only the empty `node_modules` mountpoint
on the host belongs to a subordinate UID, and nothing reads it.

Run the CLI from a directory with no `package.json` above it. From the repo
root, `pnx @devcontainers/cli` prints `The "workspaces" field in package.json
is not supported by pnpm`, which is the host's pnpm reading the root
`package.json`, not the container. And under a parent `package.json` whose
`devEngines` names another package manager, `npx` stops with
`EBADDEVENGINES` before the CLI starts.

## Dependencies

Renovate proposes updates; `.github/renovate.json5` carries the reasoning for
every hold. The routine pass is `npm update --save`, and carets are preferred
over exact pins.

- Renovate extracts from manifests; Dependabot scans the resolved lockfile. A
  transitive-only advisory therefore never becomes a Renovate PR - a
  consequence of `lockFileMaintenance: { enabled: false }` in `renovate.json5`.
- Before acting on a transitive advisory, read the parent's declared range: an
  exact pin means it is not actionable, a range means it is.
- Upgrade Wrangler and its pinned runtime dependencies (workerd, Miniflare,
  undici) together. Confirm the new Wrangler accepts the `compatibility_date` in
  `packages/worker/wrangler.jsonc` in local development. Do not use
  `npm audit fix --force` or override Miniflare on its own; validate the Worker
  with `wrangler dev --local`.
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
- A wire endpoint can live in three places: `blueprint.wires` (2.0 and later),
  and each entity's `connections` and `neighbours` (before 2.0). `bpString.ts`
  drops an endpoint naming a missing entity from all three, whatever the
  declared version, because each one threw the same error in `initBP` (#457).
  A new wire shape needs the same treatment. A wire to a connection point its
  entity lacks, or with a connector id that maps to nothing, is dropped in the
  `Blueprint` constructor instead, where the real `Entity` can be asked (#488);
  `Editor.loadBlueprint` warns with the count. No real string now fails inside
  `initBP`, so the rollback specs arm `armUndrawableWire` to get one.
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

A layer count is not a monotone function of neighbours, so it cannot express
"this entity joined to something". A cargo bay that gains a west neighbour swaps
its two left outer corners, 4 + 5 layers, for a top and a bottom wall, also
4 + 5. Measured, a bay covered on its west or north stays at 26 while one
covered on its east or south drops to 25. Compare the digest, not the count.

An entity's own position is not always on a whole tile: loading a blueprint
re-centres it, and a blueprint whose extent is odd puts everything in it on a
half tile - the all-entities blueprint at four directions puts the landing pad
at x -73.5. Anything deriving a tile grid from `position` must not round, or the
same entity draws different sprites depending on where it was dropped.

Tests that dispatch pointer input should call `suppressOverlays(page)` before
navigation so toasts and the settings panel cannot intercept events. Do not
edit files while a Playwright run is active: Vite reloads the page and destroys
the test's execution context.

CI runs checks, a Rust build, four Playwright shards, and a Cloudflare
deployment after both checks and browser tests pass. Every job is on
`ubuntu-latest`. Linux type-checks both extractors, because `download()` hides
neither behind a `#[cfg(target_os)]`. `.github/workflows/README.md` records
what Linux-only CI does not cover.

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

**The devcontainer avoids both problems, where Docker runs inside the WSL
distro.** Measured 2026-09-18 on Menehune (Docker Engine 29.1.3 in
Ubuntu 26.04): the full suite passed with the committed config and no extra
flags, `overlay-container` and `sprite-generation` included, and the VM
survived. The container has no `/dev/dxg`, no `/mnt/wslg`, and no `DISPLAY` or
`WAYLAND_DISPLAY`, so Chromium never reaches the GPU path, and the canvas specs
pass there as they do in CI. So a machine with Docker in WSL can record all five
specs above.

Two rules the specs cannot enforce:

- A green suite says nothing about how a feature feels. For anything with a
  radius, a threshold, or a step order, drive the editor and print numbers
  before calling it done.
- An intermittent spec usually has a deterministic bug under it. Find the
  mechanism rather than adding a retry.

## Labelling a new issue

`.github/workflows/issue-triage.yml` gives a newly opened issue the domain
label saying which part of the editor it is about. The type label arrives on
its own - both issue templates set one - so the allowlist in
`scripts/triage-labels.mjs` holds only the 13 domain labels. Type, the verdicts
(duplicate, wontfix, invalid) and the recruiting labels are deliberately
outside it.

Three things are worth knowing before changing it.

**A gate runs first and usually stops there.** It reads the labels GitHub has
at run time rather than the ones the event payload carried, because
`gh issue create --label` lands about two seconds after the issue exists and a
runner takes longer than that to boot. An issue that already names an area
never reaches the model at all. `selectLabels` asks the same question again at
the moment of writing, which closes the minute-wide gap where someone labels
the issue by hand while the model is still reading it.

**The menu is built from the repository's own labels.** `gate` reads
`gh label list` and filters it through the allowlist, so a label created on
GitHub reaches the prompt on the next run with no edit here. Only the allowlist
that decides what may be _applied_ is in code, and a test pins each entry.

**Claude cannot write to GitHub from that workflow, by construction.** It gets
no Bash tool, so it has no `gh` and no network; the gate dumps the issue to a
file and the model writes a proposal file, which the applier validates. The
applier is copied to `$RUNNER_TEMP` and checksummed before the model starts,
because the model's `Write` tool reaches the whole checkout and the last step
executes that file with a token that can write to issues. A `git diff` there
would not do: `.git/config` is untracked, and `diff.external` in it names a
program `git diff` itself runs. Anything logged or put in the job summary goes
through `oneLine` first - a step's stdout is parsed for workflow commands,
which are recognised only at the start of a line.

Re-run it on any issue with
`gh workflow run 'Issue triage' --field issue=<number>`. That is also the only
way to test a prompt change: `workflow_dispatch` and `issues` events both run
the copy of the workflow on the default branch, and `push` is not an event
`claude-code-action` supports at all, so nothing here can be exercised from a
branch.

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

Without a local installation, `FACTORIO_USERNAME` and `FACTORIO_TOKEN` download
the game instead. That path asks for the `expansion` build, so it does carry
Space Age, and the account behind the token has to own Space Age or the download
returns a non-success status. It runs on Linux and Windows only; macOS panics on
the unsupported-OS arm, because the macOS distribution is a DMG.

The version is not written in the source. `resolve_version()` reads
`stable.expansion` from <https://factorio.com/api/latest-releases>, and
`FACTORIO_VERSION` pins a specific one. A number in the source went stale
before: it read 2.0.68 while the oracle fixtures were recorded at 2.0.77.

Sprite compression invokes a tracked `basisu` binary, one per platform, chosen
by `basisu_for()` in `setup.rs`: `basisu` on macOS ARM64, `basisu-linux` on
Linux x86-64, `basisu.exe` on Windows. All three are v1.16.4, and the Windows
and Linux ones are upstream's own builds from the 1.16.4 release, whose
`basisu.exe` is byte-identical to the tracked one. Both input paths, downloaded
and local, route compression through the same implementation.

**The three are not interchangeable, and the committed textures came from the
macOS build.** The same PNG encodes to different bytes on macOS and on Linux:
measured 2026-09-20 on `accumulator-charge.png`, 139,208 bytes against 139,094,
with 7 of 8 sprites differing. The pictures are the same to look at - alpha is
bit-identical, transparent pixels match exactly, and the mean channel difference
over the sheet is 0.226 of 255 - but the files are not.

So regenerating on Linux rewrites all 3,060 `.basis` files, about 152 MB, with
no visible change in any of them. That is a real cost on a `.git` already around
700 MB, and it is why the Linux binary is tracked while the committed output was
left alone. **Regenerate on macOS unless you intend that rewrite.** If you ever
do intend it, the Linux output is reproducible: upstream's x86-64 build gives
the identical sha256 on native x86-64 hardware and under emulation on an
arm64 Mac, measured both ways on the same input.

`tools/check-basisu-determinism.mjs` reads the macOS binary by name and answers
a different question - whether one encoder repeats itself - so it cannot see
this.

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
  renders a placeholder for a diagonally-placed entity. Around 20 call sites
  still reach it and have not been audited for which of their entities can face
  a diagonal, so treat the hazard as live everywhere except the one case below.
  `railgun-turret` was the known instance, being 8-way: #357 moved it onto the
  underscored `RotatedAnimation8Way` keys and
  `tests/railgun-turret-diagonal.spec.ts` now pins all four diagonals rendering
  8 layers apiece. Measured against the pre-#357 draw, all four read `FAILED`,
  so that spec fails if the fix is reverted. It is the only committed test that
  reaches a diagonal at all: the public corpus (#191) places the turret at
  direction 8 only, and the synthetic halves of `sprite-data.spec.ts` sweep
  cardinals alone.
- Rail placement models rails as integer tile rectangles where Factorio uses
  continuous collision geometry, so it is wrong in both directions - it accepts
  some arrangements the game refuses and refuses 24 measured cases the game
  accepts (an identical curved rail on an identical curved rail). Preserve the
  measured exceptions and the `tools/oracle` fixtures. Per-rail collision
  shapes will not close it: #133 measured that occupancy is not a property
  of the rail, because which cells it blocks depends on the size of the box
  asking, and #142 measured that the game's published `tile_width` does not
  help either. Both are closed. #183 is the live rail defect.
- The agricultural tower's crane is nine 3D parts the engine poses from live
  entity state (`LuaEntity.crane_destination`) and projects with a camera the
  prototype never describes. Only `crane.parts[0]`, the hub, is drawable from
  data, and it alone carries `allow_sprite_rotation: false`, so its 128 frames
  are true yaw where the booms store axial roll. #365 draws that one part,
  parked at frame 0, offset by a fitted 0.526 screen tiles per tile of world
  height - fitted, because nothing in the data gives the factor. The booms also
  need `is_contractible_by_cropping` and an arm pose that only exists at
  runtime; measured, a naive chain walk renders a 12-tile mast through the
  tower. `tests/agricultural-tower-crane.spec.ts` pins the hub, because all five
  guards in `craneHubLayers` return an empty array and a drop would otherwise be
  silent.
- The same tower's two `always_draw` working visualisations are deliberately not
  drawn, and #365's original suggestion to draw them was wrong on both. `wv[0]`
  is byte-identical to the base layer already drawn - it exists only to carry a
  `fog_mask` rect, and `G.getTexture`'s cache key would hand back the very same
  `Texture`. `wv[1]` is an `apply_recipe_tint` + `tint_as_overlay` mask, and
  `EntitySprite` reads neither field, so it would draw as a raw mask. Check a
  candidate visualisation against the layers already emitted before adding it;
  measured over all 155 entities, `agricultural-tower` and `big-mining-drill`
  are the ones where an `always_draw` entry duplicates the main animation.
- Cargo hatches are drawn parked shut, and that is frame 0 for free - the
  editor draws frame 0 of every sheet and nothing reads `frame_count`. Three
  entities have one, and each drew a hole until #362: `cargo-bay` through
  `hatch_definitions`, `cargo-landing-pad` and `space-platform-hub` through
  `cargo_station_parameters.giga_hatch_definitions`. Their plain hatches carry
  no `hatch_graphics` at all, so the giga hatch is the only drawable one.
  Placement differs between the two: a plain hatch needs `offset` plus each
  layer's own `shift`, which the shadow layer settles - only that sum lands it
  in the band the bay's own shadow occupies. A giga hatch has no `offset`.
  `tests/cargo-hatches.spec.ts` pins all three by layer count, because every
  guard in both helpers returns an empty array and a drop would otherwise be
  silent.
- `graphics_set.animation` sits beside `graphics_set.picture` on exactly two
  entities, and a picture-only draw dropped it until #364. Swept over all 155,
  `cargo-landing-pad` and `space-platform-hub` are the pair; the other 22 with
  an `animation` have no `picture` next to it and already read it. The two are
  not the same size of defect. The pad's single layer is the fan inside its
  turbine cowling, which the picture draws empty, so the pad rendered a black
  hole - the same class as the open hatches above. Scored against the game's own
  render over the fan's pixels, mean per-channel error falls 30.7 -> 20.9, and
  under the body instead of over it the score stays at 30.7, because the body
  covers it. The hub's 22 layers are additive `draw_as_glow` screens in the
  cockpit windows, not the cockpit body, which `picture` always drew - so the
  issue's "the whole cockpit missing" overstates it at 3.4% of its pixels.
  Appending is the game's order: `animation_render_layer` defaults to `object`,
  neither prototype sets it, and drawing it there rather than last moves 0
  pixels on either entity. `tests/cargo-hub-animation.spec.ts` pins the split.
- Cargo bay connection pieces are placed per 2x2 cell and per shared edge, and
  both halves are measured against Factorio 2.0.77 rather than reasoned out
  (issues #378, #362 item 2). The cell rule is Factorio 2.1's `tileset_mapping`
  written as code and agrees with it on 173 of its 175 mapped masks. The bridge
  rule cannot come from that table at all, because a bridge is anchored on the
  shared edge BETWEEN two entities and no cell mask can select one - which is
  why 2.1 leaves the five `bridge_*` keys outside the mapping, and why reading
  that silence as "unreachable" was wrong. The rule: the key names the direction
  the bridge spans, so entities side by side take `bridge_horizontal_*` and
  stacked ones take `bridge_vertical_*`; a 4-tile shared edge takes `_wide` and
  a 2-tile one `_narrow`, with a longer edge split into 4-tile spans; and a cell
  corner where the covering entity changes both left to right and top to bottom
  takes `bridge_crossing`. Each piece is drawn once, by the entity west or north
  of the seam and by the one north-west of a crossing. Nothing spans a gap - two
  bays 2 tiles apart draw no join at all, which is the control.
  `cargoBayConnections.ts` holds both rules, pure and unit tested;
  `tests/cargo-bay-connections.spec.ts` pins the placement.
- Two of #362's items remain open on the cargo bay. `render_layer` is
  discarded, which reorders layers on 10 of the 14 corpus neighbour masks but
  changes at most 684 pixels and none at all on the commonest one. And
  `variants[0]` is taken unconditionally where the game picks by tile position -
  measured on the bridges, which variant the game uses differs from seam to
  seam, so reproducing it needs a position hash we would be inventing. That
  applies to all 17 keys, not just the walls.
- Logistic filters retain quality metadata but the UI has no quality picker.
- Keybind labels in the shortcut bar's hover text name each key by its place on
  a US QWERTY keyboard, because actions match `KeyboardEvent.code`. On other
  layouts the printed letter differs: German Undo shows Z but works on the key
  printed Y. `keyComboLabel.ts` says what a fix would need.
- Blueprint icons round-trip, and an auto icon is never stored.
  `BlueprintInfoEditor`'s four slots are the one place a blueprint's own
  icons are set; a blueprint carrying none exports what `computeAutoIcons`
  derives from its contents at serialize time, without writing it into the
  model - so clearing every slot by hand is a deliberate return to auto
  rather than a locked-in empty set, and serializing stays a read (routing
  that generation through History made `Ctrl+C` trim the redo stack).
