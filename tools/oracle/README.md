# Factorio oracle

Asks the real game what it does, so a behaviour this editor reimplements can be
checked against Factorio rather than against our own assumptions.

Method borrowed from the sibling project at
`/Users/ericjohnson/GitHub/FactorioMapWebUI/test/oracle/`, which uses it for the
map generator's noise functions. The subsystem differs - that one routes a
`noise-expression` and samples tile properties, this one imports a blueprint
string with `LuaItemStack.import_stack` and reads `get_blueprint_entities()` back

- but the shape is the same: write a throwaway mod, run the binary headless
  against an isolated config so it never touches the real install, have the mod
  dump JSON and `error()` out.

## Order of attack

This is the part that saves time, and it is not "open a disassembler":

1. **`factorio-data` first.** Most behaviour is Lua shipped in the clear at
   github.com/wube/factorio-data, one git tag per release. Grep for the
   **definition site** (`name *= *"<thing>"`), not a bare name, which matches
   every caller. Check out the tag matching what you target - this editor's
   corpus is 2.0.45 to 2.0.73, not 2.1.
2. **Then the oracle** - this directory. Use it for anything the Lua does not
   answer because it is engine behaviour: import rules, validation, numeric
   primitives.
3. **Only then the binary**, which ships unstripped, for the short list of
   genuinely compiled things. Nothing here has needed it yet.

## Scripts

| Script                               | What it asks                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `probe-section-index.mjs`            | First pass at #91, all cases in one blueprint                                 |
| `probe-section-index-cases.mjs`      | The same, one blueprint per case so each import code is attributable          |
| `probe-editor-output.mjs`            | Imports a string from a file - used to feed the game this editor's own output |
| `probe-copy-settings.mjs`            | What `copy_settings` carries between two entities of one type (#94)           |
| `probe-copy-settings-cross-type.mjs` | The same across different types (#94)                                         |
| `probe-filter-count-cap.mjs`         | How many filters a logistic section takes before an import fails (#93)        |
| `probe-schedule-api.mjs`             | Which schedule API 2.x actually has - written to stop guessing at it (#115)   |
| `probe-copy-settings-schedule.mjs`   | Whether a settings copy carries a locomotive's schedule (#115)                |
| `probe-rail-placement.mjs`           | Where a signal and a gate may sit relative to every rail orientation (#95)    |
| `probe-elevated-rail-collision.mjs`  | What an elevated rail collides with, and what may sit under one (#133)        |
| `probe-rail-on-rail.mjs`             | Which rail may be laid across which, over 1444 ordered pairs (#133)           |
| `probe-rail-occupancy.mjs`           | Which tiles a rail really blocks, and whether one answer serves (#133)        |
| `probe-rail-signal-spots.mjs`        | Every legal signal position, and whether the #95 window clipped them (#133)   |
| `probe-elevated-rail-support.mjs`    | What holds an elevated rail up, and whether a tile grid can express it (#141) |
| `probe-entity-tile-size.mjs`         | What `tile_width`/`tile_height` the game publishes for every entity (#142)    |

One script here is not a probe and asks the game nothing:

| Script                           | What it does                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `generate-rail-signal-spots.mjs` | Turns `fixtures/rail-signal-spots.json` into `packages/editor/src/core/railSignalSpots.ts` |

It exists because the editor cannot read a fixture at runtime - nothing under
`src/` or `tests/` may depend on `tools/oracle`, since CI stays offline - so the
152 measured numbers have to be copied into the bundle. Generating the copy is
what keeps it re-derivable rather than a transcription nobody dares touch. Re-run
it after any recapture of that fixture; the output is committed, and if a fresh
run disagrees with the committed file, the fixture moved and the table did not.

```sh
node tools/oracle/probe-section-index-cases.mjs
node tools/oracle/probe-editor-output.mjs /tmp/some-blueprint.txt

# probes that own a fixture recapture it behind a flag, never on every run -
# a probe that rewrote its own fixture would turn "the game changed" into
# "the fixture changed". vp's formatter collapses short arrays and
# JSON.stringify does not, so the --fix is part of the step, not optional.
node tools/oracle/probe-rail-placement.mjs --write-fixture && vp check --fix
```

Needs a local Factorio. Found via `FACTORIO_BIN`, else the macOS Steam default.
Nothing in `tests/` depends on these - the committed fixtures do the asserting,
so CI stays offline.

`probe-rail-placement.mjs` needs one more thing: `packages/exporter/data/output/data.json`,
which it reads to work out tile footprints the way the editor does. That is a
deliberate choice rather than reading a bounding box back out of the game - the
question it asks is what `PositionGrid`'s integer tile grid sees, not what
collides in Factorio, so the footprint has to come from the same data
`getEntitySize` reads. Any probe comparing the game against the editor's own
model wants the same treatment.

## Gotchas, each of which cost a run

- **`helpers.write_file` / `helpers.table_to_json`**, not `game.*`. They moved in
  2.1 and the old names are gone.
- **`factorio_version` in the mod's `info.json` must match the binary's
  major.minor**, or the mod is silently skipped and no dump appears - the run
  ends on "No dump" and nothing in Factorio's output names the cause. Every
  probe up to #141 hardcodes `"2.1"`, which is correct only because the only
  Factorio on this machine was the 2.1.12 Steam install. `probe-entity-tile-size.mjs`
  **derives** it from `factorio --version` instead, which is what makes running
  against a 2.0.x binary - the range this editor actually targets - a matter of
  setting `FACTORIO_BIN` and nothing else. Copy that, not the hardcoded string.
- **`tile_width`/`tile_height` are a centring parity, not a footprint.** The
  runtime docs say so in as many words: "is used to decide, if the center should
  be in the center of the tile (odd tile size dimension) or on the tile border
  (even tile size dimension)". For 146 of the 155 entities this editor knows
  that coincides with the enclosing rectangle, which is exactly why reading it
  as a footprint looks right. For the other 9 - every curved rail and
  `rail-ramp` - the published rectangle does **not contain the entity's own
  collision box**: `curved-rail-b` is 2x2 against a box 4.88 tiles tall, and
  `rail-ramp` is 2x16 against a box 3.6 tiles wide. Measured in
  `fixtures/entity-tile-size.json`. A field whose name reads like a size is not
  therefore a size; check what the docs say it decides.
- **Embed the blueprint string in a Lua long bracket** (`[==[ ... ]==]`) so its
  base64 survives verbatim.
- **`error("DUMPED-OK")` makes Factorio exit non-zero.** That is success. Key off
  the dump file existing, never the exit code.
- **Blueprint import needs no `--map-gen-settings`.** The sibling's noise oracle
  does; this one does not, since nothing is being generated.
- **One case per blueprint string.** The first probe put four cases in one
  string and got a single `import_stack` code of -1 for the lot, which could not
  be attributed - and worse, entities _did_ come back, so -1 looked like it might
  mean something other than what it does. Splitting them made the answer obvious.
- **`help()` is gone in 2.1.** `LuaEntity`/`LuaTrain` have no such key, so the
  usual way of asking an object what it can do does not work. The install ships
  `doc-html/runtime-api.json`, which is the whole runtime API as data and is a
  better source than either `help()` or `strings` on the binary - it is what
  `probe-schedule-api.mjs` should have started with.
- **A control has to be able to fail while the hypothesis holds.** The rail-on-rail
  probe's second control was "a rail on an identical rail overlaps nowhere",
  which **failed** on every curved orientation - 4 overlapping spots per
  curved-rail-a orientation, 8 per legacy-curved-rail. Nothing was wrong: a
  curved rail's tile rectangle is mostly empty, so a second identical curved
  rail sits legally beside it with the rectangles overlapping and the curves
  not. That control was a restatement of the hypothesis, so it could only ever
  agree or announce the finding, never invalidate the apparatus. It was replaced
  with "the anchor's own position is never accepted", which is about the rig.
- **A sweep window is part of the answer too.** `probe-rail-placement.mjs` swept
  +/-3 tiles, which is ample for a 2x2 rail and not for a 4x8 one:
  `legacy-curved-rail`'s legal signal positions reach an offset of 3.5, so that
  fixture lost one or two of the four at every orientation and recorded 2 or 3.
  Nothing in the output looked wrong - the spots it did find were real. Sweep at
  **two** window sizes and make "the wider one finds nothing new" an explicit
  control, which is what `probe-rail-signal-spots.mjs` does; it caught 16 clipped
  sweeps of 76. Note the rule that had been built on the clipped number survived
  re-checking, so the cost here was a wrong count rather than wrong behaviour -
  but that is luck, and it is only knowable by re-measuring.
- **A probe entity is part of the question, not a neutral instrument.** "Which
  tiles does this rail occupy" sounds like a property of the rail. It is not:
  collision is continuous, so the answer depends on how big the box being asked
  about is. Measured with four 1x1 references, a `small-electric-pole` (0.3 x
  0.3) fits on cells a `wooden-chest` (0.7 x 0.7) is refused on, and a
  `transport-belt` (0.8 x 0.8) is refused on cells the chest is not - 28 and 24
  of 38 rail orientations respectively. Sweep more than one reference before
  concluding anything of the form "X occupies Y", and if they disagree, that is
  the finding.
- **Check a proposed rule against the rows before writing any code.** The same
  probe carries two transcriptions of the editor's arms, before and after, and
  reports what each would get wrong across every measured row. The first draft
  of the fix - "allow whenever the prototypes differ" - produced four
  corruption-class rows, which the re-run caught in eight seconds and no test
  would have suggested. Transcribe the rule into the probe, not only into the
  source.
- **Include a control that can invalidate the probe itself.** Not a control for
  the behaviour, one for the measurement. `probe-copy-settings-schedule.mjs` runs
  a case where `copy_settings` is never called, because `create_blueprint` groups
  a train's locomotives into one `schedules` entry on its own - without that case
  a merged entry would have looked like a successful copy. The filter-count probe
  learned the same lesson the expensive way, reading 50 as a cap when it was the
  game deduplicating 50 cycled item names.
- **`can_place_entity` answers a different question per `build_check_type`.**
  `blueprint_ghost` skips rail adjacency entirely - a rail signal ghost is legal
  on bare grass hundreds of tiles from any rail, 2704 of 2704 in the #95 probe's
  empty-ground control, against 0 for `manual`. Use `manual` for "may this be
  built here"; a probe that accepts either will read as "anything goes anywhere".
- **Ghosts are not a placement test.** Stamping a blueprint and reviving what it
  leaves looks like the most faithful way to ask whether the game accepts a
  layout. It is not: reviving one of two overlapping ghosts destroys the other
  whether or not the layout is legal, so a legal arrangement loses an entity
  exactly like an illegal one. #95 built and discarded that whole measurement.
  Lay the rest of the blueprint for real, then ask `can_place_entity`.
- **Ask for the whole answer, not the one value you happened to bring.** The same
  probe then asked whether a gate was placeable at one direction - the one its
  control had picked while standing in open ground - and got a false negative,
  because that direction was parallel to the rail. Sweeping all sixteen turned
  8-versus-0 into the finding. If a control fails, suspect the question first.
- **Ask the cheapest question that settles the thing.** `probe-rail-placement.mjs`
  skipped the elevated rails because placing one needs rail supports and it was
  asking a placement question. The question underneath was **collision**, and
  `LuaEntityPrototype.collision_mask` needs nothing placed at all - it is a read
  off the prototype table, and sweeping the whole table gives the complete set of
  things a layer collides with rather than a list written in advance. Before
  building a placement rig, check whether a prototype field answers it.
- **`create_entity` and `can_place_entity` disagree, and the gap is
  buildability, not collision.** `create_entity` will build an elevated rail on
  bare ground with no support beneath it; `can_place_entity` refuses one
  everywhere for exactly that reason. So the over-a-chest sweep came back 0
  accepted against a **0 of 8 empty-ground control** and voided its own section,
  while the entity `create_entity` had made was still standing and let the
  opposite direction be measured. Report a section its control voids as
  unmeasured; the zeros are not a finding.
- **A probe entity's own lattice is part of the question.** The #141 probe put a
  `rail-support` at the coordinates of the rail it was meant to hold, because
  both are `build_grid_size = 2` and it looked like one lattice. It is not: a
  north-south line of `elevated-straight-rail` sits on odd y and its supports on
  **even** y, between two rails, and which parity is legal depends on the
  support's orientation. A support on the wrong parity is created happily by
  `create_entity`, stands there, and holds nothing - so every profile came back
  byte-identical to having no support at all, across all 16 orientations and 16
  distances. That reads as "supports do not participate in buildability", which
  is a clean, confident, wrong finding. Sweeping both parities of both axes cost
  four lines. What caught it was not the probe: it was decoding a real export
  from the corpus and looking at where the game had actually put the supports.
  **When a probe says an entity does nothing, check a real example of it doing
  something before believing the probe.**
- **"How far apart" has two answers when the thing is built incrementally.** The
  same probe measured the maximum spacing between two rail supports twice. A
  hand walk outward from one support stops at **12** tiles, because each rail
  has to be legal at the moment it is placed and the walk only ever approaches
  from one side. A **finished** line - build it all, then knock out one rail and
  ask whether it may be rebuilt - is legal to **20**, because the far half of
  the span is reachable from the other support. A blueprint is a finished
  configuration, so 20 is the number that describes real exports, and the corpus
  confirms it: every export spaces its supports exactly 20 apart. Measuring only
  the walk would have produced a rule that refuses every real elevated bridge.
- **Entities snap, so a requested position is not a measured one.** A rail asked
  for at (-4,-4) lands at (-3,-3) on the 2-tile rail grid, and several accepted
  (position, direction) triples collapse to one real placement. Read offsets off
  the created entity, and build each accepted triple to count distinct spots -
  16 raw acceptances around a straight rail are 4 actual signal positions.

And what holds an elevated rail up (issue #141,
`fixtures/elevated-rail-support.json`), where the prototype answered half the
question for free and the measured half turned out not to be a geometry at all.
`RailSupportPrototype::support_range` is **11** and `RailRampPrototype::support_range`
is **9**, unchanged between the 2.0.73 and 2.1.12 tags - but the docs give no
units and no shape, and the rule that consumes the number is a **load path**
rather than a radius. One spot five tiles from one support, asked four times
with only the rails between them changing, answers refused / accepted / refused
/ accepted. A lone support permits exactly the rails resting on it - two
`elevated-straight-rail` at +/-1 tile and four `elevated-curved-rail-a` at +/-2 -
and everything beyond that has to be reached through rails that already exist.
So the editor's question, "may this rail go here", cannot be answered from the
tiles under it or from any neighbourhood of them.

And what footprint the game publishes for every entity (issue #142,
`fixtures/entity-tile-size.json`), which **refutes the change it was capturing
evidence for** and is the second measurement here to end in "do not implement".
The issue was "make the editor's footprints agree with the game's own
`tile_width`/`tile_height`". They already agree for 146 of 155 entities. The 9
that differ are the six curved rail types, their two `dummy-` variants and
`rail-ramp` - and for 8 of those 9 the game's rectangle does not contain the
entity's collision box, because `tile_width` is a centring parity rather than a
size (see the gotcha above). Transcribing the proposed rule and checking it
against `fixtures/rail-occupancy.json` before writing any code - the #133 item 5
lesson - says adopting the numbers makes agreement with measured occupancy worse
in **both** directions across the 38 measured orientations: occupied-but-not-keyed
180 -> 188, keyed-but-empty 96 -> 152. `curved-rail-a` improves by 2 cells of 11;
`curved-rail-b` drops from 10 keyed cells to 4 against 14 really blocked, and
`legacy-curved-rail` doubles to 32 keyed against 18. Since the footprint is also
what `getEntityAtPosition` reads, that is half of `rail-ramp` becoming
unclickable in exchange for agreeing with a number that does not mean what the
issue assumed.

This is also the first capture here taken on a **2.0.x** binary rather than on
2.1.12, and the cross-check paid for itself again: four entities move footprint
between 2.0.77 and 2.1.12 (`tree-plant` and the three demolisher corpses), none
of them among the 155 the editor knows.

## Fixture policy

Capture once, commit the JSON with its provenance, assert offline. Copied from
the sibling repo, and the reasons are theirs:

- **Never hand-edit a fixture to make a test pass.** A mismatch is a finding.
- **Version-stamp every capture.** Steam updates the binary without asking.

The version stamp stopped being theoretical with `elevated-rail-collision.json`.
Cross-checking the 2.1.12 dump against the Lua at the **2.0.73 tag** - the
version this editor targets - turned up one real difference in twenty-one
entries: `core/lualib/collision-mask-defaults.lua` has `["cargo-bay"] =
building_tall()` at 2.0.73, which carries the elevated rail layer, and
`building()` at 2.1.12, which does not. A fixture that only said "2.1.12" would
have been correct and still have produced the wrong rule for the targeted
version, so record the cross-check itself in a `versionDifferences` field rather
than only the binary it came from.

`fixtures/section-index.json` records what was asked, what came back, the exact
binary it came from, and - importantly - that the only Factorio on this machine
is **2.1.12 while this editor targets 2.0.45 to 2.0.73**. The behaviour is
assumed stable across that range and was not measured on a 2.0.x binary.
`factorio.com/download/archive/` has every release if that ever needs settling.

## Scope

Behavioural reverse-engineering for interoperability - understanding what the
game computes so this editor can agree with it. Not extracting or redistributing
game code or assets. Keep it that way.
