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
- **`factorio_version` must be `"2.1"`** in the mod's `info.json` for a 2.1.x
  game, or the mod is silently skipped and no dump appears.
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
- **Entities snap, so a requested position is not a measured one.** A rail asked
  for at (-4,-4) lands at (-3,-3) on the 2-tile rail grid, and several accepted
  (position, direction) triples collapse to one real placement. Read offsets off
  the created entity, and build each accepted triple to count distinct spots -
  16 raw acceptances around a straight rail are 4 actual signal positions.

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
