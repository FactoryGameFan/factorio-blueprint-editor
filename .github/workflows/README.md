# Why CI looks like this

`ci.yml` is the only workflow that gates merges and deploys. This file holds the
reasoning behind it: what was measured, what was tried and rejected, and which
parts look like they could be simplified but cannot.

The workflow itself keeps only short guards, placed where someone is about to
undo the thing the guard protects. Everything longer lives here.

**Every number below names how and when it was measured.** If you repeat one,
re-measure it first. Two figures in this repo went stale without anyone
noticing, and both were being quoted as settled fact.

## The job graph

```
changes ──┬── checks ─────────┐
          │                   ├── deploy
          ├── e2e (4 shards) ─┘
          └── rust
```

Every job runs on `ubuntu-latest`. There is no Windows or macOS runner here,
which is what makes moving the whole matrix into a Linux container possible.

`deploy` runs only on a push to `wormeyman-space-age-support` or a manual
dispatch with the deploy input set. It never runs on a pull request.

Merging to that branch ships to https://fbe.factorygamefan.com, so a merge is a
release.

## `changes`: skip the jobs that cannot see the change

Every pull request used to run all seven jobs. A Cargo.lock-only crate bump
spent about 23 minutes of runner time, 17 of it on four Playwright shards that
cannot observe a Rust change. Renovate makes that the common case rather than a
corner case: 14 of the 20 bot pull requests before 2026-09-01 were single Rust
crate bumps.

The job lists the files a pull request touches and sets two outputs. `checks`
and `e2e` wait on `web`. The `rust` job waits on `rust`.

Measured on PR #315, an exporter-only diff, 2026-09-02: 6.5 minutes of runner
time against about 23 before.

### Why a job-level `if:` and not `on.pull_request.paths`

A workflow-level path filter skips the whole run, so the pull request shows no
CI at all. That is indistinguishable from CI being broken, and it would block
any check that is ever marked required, because a skipped workflow never
reports.

A skipped job does report. `checks` and `rust` both appear greyed out rather
than missing.

**One exception, and it is why this section is longer than one line.** A skipped
matrix job never expands its matrix. Measured on PR #315: `e2e` reported as a
single check under the literal, uninterpolated name
`Playwright ${{ matrix.shard }}/${{ strategy.job-total }}`, and the names
`Playwright 1/4` through `4/4` did not appear on the pull request at all.

That is harmless today. This repo has no required checks, `allow_auto_merge` is
false, and the only ruleset is "No ForcePush" with enforcement `disabled`
(re-measured 2026-09-01). It stops being harmless the moment branch protection
goes on, because a required shard name would be missing rather than skipped and
would block the merge forever, which is the exact failure this design was chosen
to avoid. If a shard is ever marked required, gate on an `always()`-guarded
aggregate job instead of on the shard names.

### Two deliberate choices

It fails open. Any error listing the files leaves both outputs true and the run
does everything. A wasted run costs minutes. A gate that skips itself quietly
costs a bad merge.

`web` is the loose one. Anything outside `packages/exporter`, or inside its
`data/output` directory, turns it on. The generated JSON and textures are web
inputs, so a dataset-only PR must run Playwright too. A README-only change
outside the exporter still runs Playwright.

Anything that is not a pull request runs every job. `deploy` is gated on `checks`
and `e2e`, so narrowing either one on a push would change when the site ships.

Cost: `checks` and `e2e` now wait on this job. Measured 2026-09-02 over 5 runs,
median 3s, max 7s. It checks nothing out and makes one API call.

## `checks`: format, lint, type check, unit tests

`vp check .` replaced separate oxfmt and oxlint steps. `lint.options.typeCheck`
is now true in `vite.config.ts`, which it could not be while `packages/website`
carried 15 unchecked type errors (issue #78).

Measured 2026-09-02 over 11 successful runs: median 37s, range 31s to 42s. An
earlier comment in `ci.yml` said 46s, which is above every sample in that set.

### The Worker gets its own type check (#518)

`vp check .` never looks at `packages/worker`. The root tsconfig excludes it and
the lint pass ignores it, because its types come from `worker-configuration.d.ts`,
a gitignored file that `wrangler types` writes. `deploy` bundles the Worker with
esbuild, which strips types without checking them, so before this step a type
error in the Worker would have shipped.

The step runs `wrangler types`, then `tsc` under the Worker's own tsconfig. Both
come from the lockfile. `npx --no` makes a missing one fail rather than fetch the
latest from npm. `wrangler types` needs no Cloudflare login and no network for
this config: measured 2026-09-25 on macOS with outbound network blocked and an
empty wrangler config directory, it wrote the file and exited 0. Linux arm64 in
the devcontainer image gave the same result.

It runs **before** `vp check .` on purpose. The generated file then sits in the
tree, as it does on any machine that has run `wrangler types`. That is the
state where #413's bug showed up. Measured with the file present: `vp check .` stays green, and
removing `packages/worker` from the root tsconfig's `exclude` turns it red with
the TS2345 on `document.body.append`. Run after it, CI could not see that
regression.

`wrangler types --check` is not needed. It asks whether a file already on disk
is up to date, and this step writes the file fresh on every run. It only makes
sense for a committed copy, which this repo keeps out of git on purpose.

### `vp test` now runs a production build

`tests/production-bundle.test.ts` (#322) calls Vite's `build()` in-process and
greps the emitted chunks, so `import.meta.env.DEV` stripping the Playwright test
API from executable JavaScript (#292) has coverage that a `vp dev`-only e2e suite
cannot give it. It is the cheaper of the two options in #322 - a build and a
string scan, no browser and no preview server - which is why it sits here rather
than as a Playwright spec or a new `deploy`-adjacent job. `deploy` already needs
`checks`, so a leak blocks the release.

The build is `packages/website` at its real `vite.config.js`, with the same
`define` substitution and tree-shaking as production. The test reads emitted
JavaScript and maps in memory (`write: false`), so it neither overwrites a local
`dist` nor runs the sprite-copy write hook. It verifies compilation, not whether
the canvas renders; the browser suite still covers the dev build.

Public source maps are intentional (#328). This editor's source is public, and
maps make production errors debuggable in browser devtools. They retain
`sourcesContent`, including the original test API code, and the executable chunks
link to them with `sourceMappingURL`. The Worker/static-assets service serves
those maps like other assets. The test asserts that source remains in the maps
while the API is absent from executable JavaScript. This is not a claim that the
test API's source text is secret or absent from all deployed bytes.

### The strict-ratchet recipe (the type-check gate is gone)

A `Type-check gate` step used to run alongside `vp check`. The two answered
different questions. `vp check` asks whether the code type-checks under the flags
that are currently on. The gate asked whether the error count had risen above a
committed baseline. Once `strict: true` landed (issue #77) the baseline was back
to 0, which left the gate redundant until the next flag flip, and #268 removed
the step, the script, its test and the baseline.

**Keep this recipe. It is the part that is expensive to rediscover.** It does not
depend on the gate still existing - it describes how to stand a counting job back
up for one flag flip and retire it again. To turn on a new strict flag without a
red build on every commit in between:

1. Turn the flag on in a **second** TypeScript project that nothing compiles
   with and only the counting job reads.
2. Start the baseline at whatever the current error count is.
3. Ratchet it down, keeping that job green the whole way.

Turning the flag on in the root config instead fails the `vp check` step on the
first commit and every one after, whatever the baseline says, because `vp check`
runs first and tolerates nothing.

Issue #77 ran it from 24 to 0 this way.

## `rust`: compile the exporter

`packages/exporter` is Rust. Nothing compiled it until this job existed, so a
broken crate bump or a breaking API change was invisible until somebody built it
by hand on macOS.

The job **compiles** the exporter. It cannot **run** it, and the difference
matters before anyone extends it. Running it needs a Factorio install to extract
from, and sprite encoding shells out to a `basisu` binary picked by
`basisu_for()` in `src/setup.rs`, one per platform. Compiling needs neither:
`basisu` is invoked through `Command::new` at run time, there is no `build.rs`,
and no dependency is platform-gated.

Extending this job to run the exporter would be a bigger change than it looks.
The Linux and macOS `basisu` builds encode the same PNG to different bytes, so a
run here would not reproduce the committed textures. CLAUDE.md has the numbers.

So a crate that changes runtime behaviour without breaking the build will pass.

`--locked` is load-bearing. It fails if `Cargo.lock` disagrees with `Cargo.toml`,
which is exactly the mistake a dependency pull request can make. Renovate updates
the lockfile itself, and this is what checks that it did.

It is a separate job rather than a step in `checks` so the two run in parallel
instead of adding to that job's wall clock.

### The cache was most of this job

Measured on run 35543940158, 2026-09-20. The Linux job took 90s, and 68s of that
was the cache: 49s to restore and 19s in the post step. The work it protects,
build plus test plus fmt plus clippy, was 13s. The cache itself was 1,884 MB.

Debug info was the bulk of it. Measured locally the same day, a clean build
directory for this crate is 1.7 GB, 1.2 GB of that in `target/debug/deps`, and
building with `CARGO_PROFILE_DEV_DEBUG=false` and `CARGO_INCREMENTAL=0` gives
506 MB instead. The build did not get slower, 15.6s against 20.3s on the same
machine. Nothing in this job opens a debugger, so the information was being
compressed, uploaded, downloaded and decompressed for nobody.

Both are set as job-level `env:` rather than in `Cargo.toml`, so a developer
building locally keeps backtraces with line numbers.

**The cache key had to change with them, and that is the part worth
remembering.** `actions/cache` does not re-save on a hit, so leaving the key
alone would have restored the old 1.9 GB cache for its lockfile forever and
never replaced it. The `v2` in `cargo-v2-...` exists for that, and any future
change to how these artifacts are produced needs the same bump.

Measured on a runner afterwards, same day, run 35545415494:

|                  | before   | after                          |
| ---------------- | -------- | ------------------------------ |
| cache size       | 1,884 MB | 251 MB                         |
| restore          | 49s      | 6s                             |
| save (post step) | 19s      | 0s on a hit, 4s when it writes |
| whole job, warm  | 90s      | **30s**                        |

The first run after the key changes has no cache to restore and pays a full
build: 100s, of which 68s is `Build` and 19s is `Clippy`. That is the shape to
expect from any future key bump, and it is not a regression.

### `-D warnings` on clippy

Plain `cargo clippy` exits 0 with warnings. Measured. Without `-D warnings` the
step would be green forever and report nothing, which is worse than having no
check at all, because it looks like coverage.

Format and clippy arrived non-blocking, with 4 fmt sites and 10 clippy findings.
The `continue-on-error` came off in the same pull request that cleared them,
deliberately: a check nobody has to fix is a check nobody reads.

### Clippy agrees on every host

`download()` in `src/setup.rs` chooses its extractor with a runtime `match` on
`std::env::consts::OS`, so every target compiles both arms and both `out_dir`
and `stream` are read everywhere. `cargo clippy -- -D warnings` reports 0 on
this job and 0 on a Mac. Measured 2026-09-20, either side of the commit that
made the change: before it the same command gave 2 errors on macOS and none
here.

Put a `#[cfg(target_os)]` back around either arm and the split returns, with
clippy proposing `_out_dir` and `_stream`. That autofix compiles on macOS and
breaks this job, where the other arm still reads the original names.

### Why there is no Windows runner

There was one, `rust-windows`, on `windows-latest`. The Linux job compiled the
linux cfg block of `src/setup.rs` and skipped the Windows one, so a chunk of
that file was checked by nothing. Not theoretical: `zip` had exactly one call
site in the whole crate, inside `#[cfg(target_os = "windows")]`, and the zip v2
to v8 pull request passed the Linux job green with its only consumer
uncompiled. Six majors, covered by nothing.

The runtime `match` closes that at the source. Both arms compile on every
target, so this job now type-checks the `zip` call site and the `tokio-tar` one
alike, and the Windows job covered no code it misses.

A cross-check is still unavailable, and the reason moved rather than went away.
`cargo check --target x86_64-pc-windows-msvc` runs build scripts, and any
`-sys` crate then builds C for a Windows target. Dropping `zip`'s default
features removed `zstd-sys`, the crate this section used to name, and
`liblzma-sys` took its place: `async-compression` needs it because the Linux
download really is a `.tar.xz`, confirmed against the published
`factorio-demo_linux_2.0.68.tar.xz`. Measured from macOS 2026-09-20, the check
stops at `'stdlib.h' file not found`, because no Mac or Linux host carries the
Windows SDK headers.

What is no longer covered is narrow and worth naming: nothing checks that the
exporter's dependency tree still builds on windows-msvc. A crate bump could
break `npm run start:exporter` for a Windows contributor while CI stays green.

macOS is not covered either. `download()` panics on the unsupported-OS arm
before it reaches an extractor at all.

## `e2e`: the Playwright suite

The suite ran nowhere but a maintainer's laptop until this job existed. That gap
was not theoretical. PR #222 arrived with every check green and a
`blueprint-round-trip.spec.ts` failure in it, dropping
`position-relative-to-grid` from every absolutely-snapped blueprint, 325 of the
corpus's 367. `vp check` and `vp test` cannot see any of that, because the whole
decode to model to serialize path needs `FD` loaded, which needs a browser and
the sprite server.

It needs no Factorio and no network beyond npm. The corpus is committed under
`test-blueprints/` and the sprite data under `packages/exporter/data/output`, so
this stays as offline as the rest of CI.

### Sharding is the lever, not `workers`

The first push run spent 708s of its 774 inside `Run Playwright specs`.
Everything else, checkout, `vp install`, the browser download on a cold cache and
both dev servers, came to 56s. The part that shards is essentially all of it, and
each added runner pays about a minute to take a quarter off the rest.

Raising `workers` is the other obvious knob and the wrong one.
`playwright.config.ts` pins `workers: 1` because the specs share ports 8080 and
8081 and a single editor instance, and that conflict is **within a machine**.
Giving each shard its own runner, and so its own pair of dev servers, sidesteps
it instead of solving it.

`fail-fast: false` because a red shard should not cancel the other three. The
point of running the suite is to learn what broke, and three cancelled shards
answer that much less well than three finished ones.

### The spread is the point

Measured over this job's first three runs, the slowest leg came out at 213s, 225s
and 250s. Re-measured 2026-09-02 over 44 shard legs: median 226s, range 170s to
337s.

Do not collapse this into one figure. Each sample in turn looked precise enough
to quote, and each was contradicted by the next run of the same suite on the same
code. A shared runner's throughput is not a property of this repo. Do not treat a
slow run as a regression without at least a second sample.

Playwright splits shards by test count rather than by duration, and the specs
here are nowhere near uniform. The corpus-wide ones (`sprite-data`,
`entity-accessors`, `blueprint-round-trip`) dwarf the rest, so the honest
prediction was lopsided legs. Measured, they land within 11% of each other.
Recorded because the prediction was wrong, and the next person sizing a shard
count should trust the numbers over the reasoning.

The 20 minute timeout is a backstop against a hung suite, not an estimate. A
shard that has genuinely stopped making progress should be killed. One that is
merely slow should not.

### The browser cache is keyed on the resolved version

`@playwright/test` is a caret dependency, so the resolved version, and with it
the browser build the runner needs, can move without `package.json` changing.
Keying the cache on the resolved version makes a stale cache impossible. Keying
on `^1.62.0` would serve yesterday's browser to today's Playwright, which fails
as a missing `chrome-headless-shell` executable and reads as a suite-wide
regression rather than a cache miss.

This also means a `@playwright/test` bump reinstalls browsers by itself. CI needs
no manual `npx playwright install` step in the pull request.

### `playwright install-deps` was deleted, not retried

The ubuntu-24.04 image already carries every shared library the cached chromium
needs, so `playwright install-deps` had nothing to do on a cache hit, while being
by a wide margin the least reliable step in the workflow. Over 44 runs of it:
median 17s, a tail to 686s, and 2 that never finished and took the job timeout
and the deploy with them. The suite then passed on all four shards with it
removed entirely.

Why it hung, since the number alone does not say: apt stalls on the mirrorlist
fetch. **Wrapping it in `timeout` does not help and actively hurts.** `timeout`
kills its own child, `npx`, while the root-owned `apt-get` underneath survives
holding `/var/lib/apt/lists/lock`, so every retry after the first dies instantly
on the lock. That was measured too, on all four shards, and is why this is a
deletion rather than a retry.

What replaced it is an assertion, not an install: ask the linker whether anything
is actually missing. About a second, and it cannot hang. If a future runner image
drops a library, this fails naming the binary instead of surfacing as chromium
failing to launch inside an unrelated spec.

### The binary count is part of that assertion

`expected=2` is the more important half of the check. The first draft looked for
`headless_shell` when the file is `chrome-headless-shell`, so it silently probed
one binary rather than two and reported a clean result for a binary the specs do
not run. `headless: true` in `playwright.config.ts` means the headless shell is
what they use.

A missing-library count is only meaningful next to the number of things it looked
at.

### The dev servers

The job runs the same `npm run localpreview` a maintainer runs locally, rather
than a second copy of "how to start the two servers" that can drift from it. It
refuses to start if either port is taken and ties both lifetimes together, so a
half-started pair fails at that step instead of presenting as `/data` 502s inside
the specs.

`serve` is a declared devDependency rather than something `localpreview` fetches
fresh with `npx --yes`, which is what it did until this job existed. Unpinned was
tolerable while that command only ran on a laptop. As a CI dependency it is a
package resolved at run time that the lockfile has no opinion about, and the
whole point of `vp install --frozen-lockfile` is that nothing else in the run is.
It costs about 990 lines of lockfile for a dev-only static file server, and buys
a reproducible sprite server plus Renovate tracking the thing.

stdout is redirected to a file rather than inherited, which is not cosmetic: a
backgrounded process holding the step's stdout pipe open can stop that step from
ever completing. The log is uploaded with the report on failure, because "the
specs all failed" and "the sprite server never started" look identical from the
Playwright output alone.

`localpreview` exits non-zero on a port clash but otherwise never returns, so
readiness has to be polled rather than awaited. Both ports, since Vite comes up
first and the specs need the sprite server too.

## `deploy`

Gated on both `checks` and `e2e`, not just `checks`. The class of bug this covers
is the one that motivated `e2e`: a change that type-checks, lints and passes
every unit test while breaking the editor in a browser. PR #222 dropping
`position-relative-to-grid` is the worked example, and `checks` was green on it.
Without `e2e` here, exactly that could reach fbe.factorygamefan.com.

The price is the deploy's critical path growing by the length of the suite's
slowest shard, so a deploy that used to start after `checks` alone now waits
three to four minutes. It was thirteen before the suite was sharded across four
runners, which is most of why it was sharded. If the wait ever stops being worth
paying, this gate is the thing to reconsider rather than the job.

## Known flake

`tests/quick-actions.spec.ts:611` can fail with `Expected: 2, Received: 3`. The
mechanism is documented in that spec's own header: `page.waitForTimeout(200)` has
no upper bound, so under shard CPU contention the 500ms debounce fires before the
undo lands. It is the shard, not your change. Do not paper over it.
