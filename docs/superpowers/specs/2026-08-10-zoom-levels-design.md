# Zoom levels that behave like the game's

Issue #206. Design settled 2026-08-10; measured against the game 2026-08-11, which
answered every number this document left open and corrected two of its claims.

## What the probe found (2026-08-11)

`tools/oracle/probe-zoom-limits.mjs`, fixture `tools/oracle/fixtures/zoom-limits.json`,
against the 2.0.77 client over four sessions with a human at the wheel.

- **The step is `2^(1/7)` - seven notches per doubling - and the ladder is
  absolute, anchored at exactly 1.0.** Every one of the 23 non-clamp values
  scrolled through is an exact `2^(n/7)`, worst deviation in `n` of 4.2e-10.
  The ratio this document declined to choose did not need choosing.
- **A notch from between two rungs snaps to the _nearest_ rung and then moves one
  index** - the rule guessed under "the first notch snaps", now measured. Two
  further rules survived the obvious probe and one of them is wrong: from 0.83 a
  notch in gives 0.905724 under both `nearest+step` and "next rung in the
  direction of travel", and only a notch **out** separates them (0.742997
  against 0.820335). It answered 0.742997.
- **The ceiling is 3**, exactly what `BlueprintContainer.ts:87` already passes.
  The editor's ceiling was never wrong; only its softness was.
- **A step that would overshoot a limit lands on the limit exactly**, not on the
  last rung before it. So the clamp value is reachable and is not itself a rung.
- **The floor is not a number, it is a rule**: at most `distance = 200` tiles
  across the window, capped at `max_distance = 500`. On a 16:9 window that is
  exactly 0.3; on the 3736x2044-at-scale-2 window measured it is 0.283889, which
  the documented formula reproduces to 1e-9.
- **The units claim is confirmed exactly.** That floor formula only lands on the
  measured value at 32 px per tile per unit zoom, against the window in logical
  pixels (`display_resolution / display_scale`). The editor's 32 and the game's
  are the same 32.
- `furthest_game_view` is a **third** limit this document did not know about, and
  it is `distance 200` for the character, god and spectator controllers alike -
  the game never draws the world further out than 200 tiles across. God and
  spectator may zoom out further (to 0.015625 and 0.00390625), but that range
  renders as **chart view**, which the editor does not have.

### The one decision the measurement did not settle: the floor

**Adopting the game's world-view floor is not open to us.** 30 of the 367 corpus
blueprints are wider than 200 tiles and the widest is 397, which needs zoom 0.151
to fit at a 1920px viewport where the game's floor is 0.300. Taking the game's
number literally would make 8% of real blueprints impossible to view whole. The
200-tile limit exists so a player cannot see ungenerated chunks - a constraint
that does not apply to an editor at all.

**The floor is 0.1, the game's own map editor floor** (decided 2026-08-11). It is
the game's number for the editing context rather than an invented constant, and
it fits the widest corpus blueprint with room to spare. So the ladder runs
`2^(n/7)` for `n` in -23..11, clamped exactly at 0.1 and 3 - clamping to the
limit itself rather than to the last rung, which is what the game does.

Everything below is the design as settled on 2026-08-10, before any of this was
measured. Where it disagrees with the section above, the section above is what
was found.

## The problem, measured

The complaint is that scrolling does not feel like Factorio. Reading the code turns that into three separate defects, none of which is about units.

**The units already agree.** `EntityContainer.position` multiplies world coordinates by 32 (`EntityContainer.ts:296`), so the editor draws 32 px per tile at scale 1. Factorio's runtime API at 2.0.77 says of `LuaPlayer::zoom`: "The baseline zoom level is 1. Values greater than 1 will zoom in closer to the world and values between 0 and 1 will zoom out away from the world." Same baseline, same pixels per tile. The editor's scale number is already Factorio's zoom number, so nothing needs converting. Everything below is about which values we step through and where we stop.

### Defect 1: the step is asymmetric, so zoom does not round-trip

`BlueprintContainer.zoom()` uses a flat `zoomFactor = 0.1` and calls `viewport.zoomBy(+/-0.1)`. `Viewport.zoomBy` does `this.scaleX += delta`, and `scaleX` is reset to 1 after every `_updateMatrix`, so the value multiplied into the transform is `1 + delta`.

Zoom in is therefore `x 1.1` and zoom out is `x 0.9`, and those are not inverses:

```
1.1 x 0.9 = 0.99
```

One notch in and one notch out leaves the view 1% further out than it started, with nothing to snap back. Ten round trips lose about 10%.

### Defect 2: the wheel discards how far you scrolled

```js
if (Math.sign(e.deltaY) === 1) {
    this.zoom(false)
} else {
    this.zoom(true)
}
```

Only the sign is read. A trackpad emitting a burst of small pixel deltas and a mouse emitting one notch produce the same fixed jump. This is the likeliest single cause of "does not feel like the game". `WheelEvent.deltaMode` also varies across devices and browsers (pixels, lines, pages), so raw `deltaY` is not comparable without normalising.

### Defect 3: the ceiling is soft and there is no floor

`maxZoom` is `3`, passed at `BlueprintContainer.ts:87`, so 96 px per tile. The guard is:

```js
if (Math.sign(deltaX) === 1 && this.origTransform.a > this.maxZoom) return
```

It tests **before** applying, so from 2.99 a tick still lands at 3.289 - the ceiling is soft by a full step. Zooming out has no clamp anywhere; grepping `Viewport.ts` and `BlueprintContainer.ts` finds no floor. Because the step is multiplicative it approaches 0 asymptotically rather than going negative, so it degrades into an unusable speck instead of breaking outright.

## What the game gives us, and what it does not

From the 2.0.77 install's own `doc-html/runtime-api.json`, which is a better source than the online docs for a pinned version:

- zoom 1.0 is baseline, `> 1` closer, `0 < z < 1` further out
- `ZoomSpecification` supports either a fixed `zoom` or a dynamic `distance` in tiles computed against the window's aspect ratio
- `max_distance` defaults to **500** tiles along the window's longest axis, a hard limit on how far a player can see

Not available from either source: the per-notch step, and the character controller's default `zoom_limits`. Those are engine constants. `factorio-data` at the 2.0.77 tag was grepped and holds only `camera_zoom` values inside Factoriopedia and tips-and-tricks simulations (1.0 to 4), which are scripted camera positions rather than player limits; `core/prototypes/utility-constants.lua` has `zoom_to_world_can_use_nightvision` and friends but no threshold or range.

So the range must be asked of the game. The step cannot be, without a human scrolling, and we have chosen not to require that.

## Decisions

### A fixed ladder, not corrected continuous constants

Zoom moves through an ordered array of levels; a notch moves the index by one.

This kills defect 1 **by construction** rather than by arithmetic - there is no accumulation, so in-then-out returns the exact value it started on. It makes the ceiling and floor exact rather than soft. And it is the only model a test can assert: a continuous multiplier can only be tested for its clamps, whereas a ladder can be pinned whole, which matters because nothing under `tests/` reads a zoom level today.

Rejected: continuous with a symmetric step (`x k` and `x 1/k`). Smaller diff and it fixes the drift, but "the same as the game" stays approximate and the levels passed through are whatever the starting scale happened to be times `k^n`.

Rejected: continuous while scrolling, snapping on settle. Best feel in principle, but it needs a settle timer, and the viewport's existing dirty-flag-and-ticker split has already produced one hard-to-find bug around deferred state (#144).

### Scale stays the source of truth; the first notch snaps

`centerViewPort` fits a loaded blueprint by computing a continuous scale from its bounds, so the zoom after a load is almost never a ladder value.

The state stays a continuous scale. A notch finds the nearest ladder value to the current scale, moves one index from there, and clamps. Loading therefore still fits a blueprint exactly, and mobile pinch stays continuous with no special case.

Rejected: storing the ladder index as truth. Simplest state, but loading would snap to the nearest level, so a blueprint would no longer fit its viewport - it would land slightly over- or under-filled. That changes framing for every blueprint, breaks the fit-to-bounds guarantee that `rail-signal-snapping.spec.ts` relies on when it derives zoom from two entities a known distance apart, and cannot express pinch-to-zoom at all.

Rejected: an index whose ladder gains the computed fit value per blueprint. Preserves the fit and keeps integer state, but the ladder is then not constant, so no test can assert it and the levels only match the game away from wherever you started.

### Wheel events accumulate a normalised delta

`deltaY` is normalised via `deltaMode` into a common unit and added to a running total. Each time the total crosses a threshold, one rung is stepped and the threshold subtracted, keeping the remainder.

A mouse notch crosses the threshold in one event; a trackpad needs several; slow scrolling still arrives because the remainder carries.

Rejected: one step per event. Smallest diff, but it leaves the defect most likely to explain the original complaint, and a discrete ladder makes it more visible than continuous zoom does.

Rejected: rungs proportional to magnitude. Most responsive to a flick, but one event could jump most of the ladder, which with discrete levels reads as teleporting - the same failure the rail signal `R` key had before its ordering was fixed.

## Architecture

### `packages/editor/src/core/zoomLevels.ts` (new, pure)

No pixi, no FD, no globals, following `railSignalSnapping.ts`, `throughput.ts` and `util.ts`. It owns the ladder and every decision about it:

```ts
export const ZOOM_LEVELS: readonly number[] // ascending, contains the value 1.0
export function stepZoom(scale: number, direction: 1 | -1): number
export function clampZoom(scale: number): number
export class WheelAccumulator {
    feed(deltaY: number, deltaMode: number): number
}
```

`ZOOM_LEVELS` is a **committed literal array**, not computed at runtime. It is generated once from the probe's measured endpoints and the chosen ratio, then written into the file, so the ladder a test asserts is the ladder that ships. Regenerating it is a deliberate act, the same rule the other measured tables here follow.

**Reversed 2026-08-11: it ships computed, as `2^(n/7)` for `n` in -23..11.** The argument above holds when the ladder is a table of measurements, which is what `railSignalSpots.ts` is - 152 placements with no formula behind them, where a generated literal is the only re-derivable form. This ladder turned out to have a closed form, so a literal would be a _transcription_ of a formula rather than a record of measurements, and 35 hand-copied digits are the kind of thing that drifts without any reviewer being able to see it. The unit test asserts the closed form, the two exact endpoints and the measured off-rung cases.

`stepZoom` is where the snap lives: nearest ladder value to the current continuous scale, move one index, clamp. From `0.83` on a ladder containing `1.0`, a notch in yields the rung above `1.0`.

`WheelAccumulator.feed` returns a **signed** rung count - negative for zoom out, positive for zoom in, `0` when the threshold has not been crossed. Usually -1, 0 or 1.

### `Viewport.ts`

Keeps its continuous scale and its accumulating matrix. Two changes:

- gains a real floor
- the ceiling test moves to **after** the multiply, so it stops being soft by a step

**The measured range replaces `maxZoom = 3`.** The ladder's endpoints become the editor's limits, so the constructor argument at `BlueprintContainer.ts:87` is superseded by `ZOOM_LEVELS[0]` and its last element. If the probe reports a ceiling above 3 the editor gains reach it did not have, and if below, it loses some - either is intended, since the stated goal is the game's range. The one number that must not move silently is the floor, because there is none today and anything is stricter than nothing.

**Measured 2026-08-11: the ceiling is 3, so `maxZoom` was already right** and the only change at the top is that the clamp stops being soft by a step. The floor is 0.1, and the anticipation above is exactly inverted - the number that moves is not the ceiling, and the floor is not adopted from the game's range at all but from its map editor, because the game's own world-view floor cannot express a 397-tile blueprint. See "the one decision the measurement did not settle" at the top.

`zoomBy` stays as it is for **mobile pinch**, which feeds a genuinely continuous `scaleDelta` derived from finger distance and cannot be expressed in rungs. Pinch gets `clampZoom` only; the ladder never touches it.

### `BlueprintContainer.ts`

Loses `zoomFactor = 0.1`. Owns a `WheelAccumulator` and calls `setCurrentScale(stepZoom(...))` once per rung crossed. `zoom(zoomIn)` stays public as editor-package API; note it currently has exactly one caller, the wheel handler, and there are no keyboard zoom bindings.

## The probe

`tools/oracle/probe-zoom-limits.mjs`, fixture `tools/oracle/fixtures/zoom-limits.json`, version-stamped 2.0.77 with `factorio_version` derived from `factorio --version` rather than hardcoded.

It measures the effective range **two independent ways**, and that is the control rather than an afterthought:

1. read `player.zoom_limits` directly
2. write `player.zoom = 10000` and read back; write `player.zoom = 0.00001` and read back. The docs state that writes outside the limits are always valid but reads are clamped, so what comes back is the true ceiling and floor.

The two must agree. A disagreement is the finding, not a number to average.

Two things make this unlike every previous probe in this repo, and both belong in its README:

- **It needs a `LuaPlayer`.** Every previous probe read prototypes or queried a surface. A headless server has no player until one connects, so this runs against the 2.0.77 client with a freeplay scenario and the usual `error()`-out dump. If no player can be obtained, that **voids the section** rather than producing zeros to be read as a finding, per the elevated-rail lesson.
- **Limits are per controller type.** The character controller is the one that means "like the game"; god and spectator will differ. Recording all of them costs nothing and says whether the number chosen is the one a player actually experiences.

## The ladder's ratio is deliberately not chosen here

**Superseded 2026-08-11: it is `2^(1/7)`, measured.** The rest of this section is what was believed before the probe ran, and why it was wrong is worth keeping. The ratio was called pure feel and handed to a driving session because the design assumed a human scrolling against a logging mod was too expensive to ask for. It took one sitting. This section was reasoning about a number that was sitting in the game waiting to be read - and the guessed starting point below, 1.33, is three real notches wide. Shipping it would have felt wrong in exactly the way #206 complains about, and no test could have said so.

---

The ratio is the one number in this design that is pure feel, and it is left to a driving session inside the implementation PR.

The reason is a scar: rail signal snapping shipped fully tested and mutation-checked with a 4-tile snap radius that left the signal 390px from the pointer and an `R` key that jumped diagonally across the track. Both were found in one sitting by driving the editor and printing positions, and no passing test could have shown either.

The change in coarseness is real and worth stating: today's continuous `x 1.1` needs eleven notches to double, where a ladder at ratio 1.5 doubles in under two. A defensible starting point is around 1.33:

```
... 0.33, 0.44, 0.59, 0.79, 1.0, 1.33, 1.78, 2.37, 3.16 ...
```

Ship a starting ratio, drive it, print numbers, then throw the measuring probe away - it is an instrument, not a test.

## Testing

Everything with a decision in it is pure, so `packages/editor/src/core/zoomLevels.test.ts` runs under `vp test` in **CI**. That is the point: nothing under `tests/` reads a zoom level today, and Playwright never runs in CI (#210).

- **round trip** - `stepZoom` in then out returns the exact starting value. Defect 1, now impossible by construction and pinned so it stays that way.
- **ladder invariants** - strictly ascending, contains exactly `1.0`, spans the measured range.
- **clamps are exact** - stepping in at the top rung stays at the top rung rather than overshooting, and the same at the floor, which does not exist today at all. Defect 3.
- **snap from off-ladder** - from `0.83`, a notch in gives the rung above `1.0`.
- **accumulator** - one mouse notch is one rung; N trackpad events make one rung; the remainder carries so slow scrolling arrives; `deltaMode` line and page units normalise to the same result as pixels. Defect 2.

Playwright covers only what a browser can see: that a wheel event over the canvas moves the viewport scale, and that loading a blueprint still fits it. The second is a guard rather than a feature - it is what would catch a `centerViewPort` regression, and it exists because the specs deriving zoom from blueprint bounds would otherwise fail confusingly.

## Sequencing

Two PRs against `wormeyman-space-age-support`, squash-merged, no issue number in either subject.

1. **The probe and its fixture.** Pure measurement, no behaviour change, reviews as evidence. Its result picks the ladder's endpoints.
2. **The ladder, the wiring, and the tests.** One reviewable behaviour change. The ratio driving session happens inside it, before merge.

Landing `zoomLevels.ts` on its own between the two was considered and rejected: a pure module nothing calls is dead code at merge time, and its unit tests are what make it reviewable anyway.

## Out of scope

- ~~Matching the game's exact per-notch step.~~ **Done on 2026-08-11, before any of this shipped, and #211 is answered rather than blocked.** It is `2^(1/7)`. The reasoning that put it out of scope was sound and the conclusion was wrong: it is indeed an input-handling constant no headless probe can reach, and it did need a manual scrolling session against a logging mod - which turned out to cost one sitting rather than being a reason to ship a substitute. The control named here is the one that passed: the hand-scrolled endpoints equal the independently measured limits at both ends, in all four sessions. **The lesson is the cost estimate, not the method** - "no headless probe can reach it" was allowed to stand in for "not worth measuring", and those are different claims.
- Changing what `centerViewPort` computes. The fit stays exact; that is the point of keeping scale as truth.
- Mobile pinch behaviour beyond gaining a clamp.
