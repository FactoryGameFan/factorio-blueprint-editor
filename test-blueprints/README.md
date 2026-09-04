# Test blueprints

Third-party Factorio blueprints, included here as **test fixtures**. Nine
Playwright specs load every file in this directory and pin what the editor makes
of it - see the Playwright section of `../CLAUDE.md`.

These are other people's designs. They are redistributed unmodified, with
attribution, so that the test suite works on a fresh clone; nothing here is
authored by this project. If you are an author listed below and would rather not
be included, open an issue and the file will be removed.

Every file is a raw Factorio blueprint string, exactly as the game exports it -
one line, no trailing newline. `tests/helpers/blueprint-files.ts` reads them
with a `.trim()`.

## Where a new blueprint goes

`test-blueprints/<collection>/<name>.txt`. The collection folder is not optional:
`discoverBlueprintFiles` walks one level down, so a `.txt` left at the top level
of this directory is loaded by no spec. It now **throws** naming the file rather
than skipping it in silence (issue #190), and `vp test` runs that check in CI, so
a stray file fails a PR instead of waiting to be noticed.

That guard exists because the silence had already cost something. The old corpus
carried a top-level `wormeyman-tests/a.txt` holding 368 blueprints which no spec
ever read, but which a hand count of the directory did - and that is where the
"1452 `control_behavior` sections" in `tests/pre-2-0-shape-migrations.spec.ts`
came from, against a discovered corpus really holding 1295.

Adding a file also moves the pinned fixtures under `tests/__fixtures__/`, which
are fixed points rather than snapshots. Expect that to be the larger half of the
change.

Provenance is recorded the way `tools/oracle/fixtures/` records its own.

## EARN - ElderAxe

Retrieved from an existing local copy on 2026-08-05, byte-identical to what the
suite has been running against since March 2026. Each book carries its author
and a Patreon collection link in its own description field, quoted below.

All four are **publicly available** from those collections. ElderAxe gates new
releases for a period and then opens them, and these versions have been out long
enough to be public - which is why they are redistributable here at all. The
version numbers in the filenames are the ones that were current when this corpus
was assembled, not necessarily the latest; refreshing them is deliberately left
as its own change, since it would regenerate every pinned fixture.

| File                                | Book label                                | Author                    | Version | Source                                                          |
| ----------------------------------- | ----------------------------------------- | ------------------------- | ------- | --------------------------------------------------------------- |
| `earn-v22-0-12.rev-2.txt`           | EARN - ElderAxe's Rail Network (v22.0.12) | ElderAxe                  | 2.0.55  | <https://www.patreon.com/collection/1415594>                    |
| `pocket-base-space-age-v22.1.2.txt` | Pocket Base - Space Age Edition (22.1.2)  | MisterGrimmJaw & ElderAxe | 2.0.73  | EARN 22 collection, <https://www.patreon.com/collection/909011> |
| `power-blocks-v22-0-8.rev-1.txt`    | EARN Power Blocks (v22.0.8)               | ElderAxe                  | 2.0.55  | <https://www.patreon.com/collection/672495>                     |
| `quick-start-v22-0-11.txt`          | ElderAxe's Quick Start Base (v22.0.11)    | ElderAxe                  | 2.0.45  | <https://www.patreon.com/collection/585174>                     |

`pocket-base-space-age-v22.1.2.txt` gives no collection link of its own; the one
above is the EARN 22 collection its description names for rail and station
compatibility.

## JEPAKAZOL - factorio.school

Retrieved 2026-08-05 from <https://www.factorio.school>, via
`https://facorio-blueprints.firebaseio.com/blueprints/<key>.json`, field
`blueprintString`, trimmed. Heart counts are as of that date. Files are named by
target rather than by title so the set reads as one per planet plus a space
platform.

| File                           | Title                                            | Key                                                                             | Hearts | Version |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------- | ------ | ------- |
| `nauvis-starter-bot-rush.txt`  | Starter Base, Bot Rush + Early Mall              | [`-OP64HC3ibqmtD4bCM8l`](https://www.factorio.school/view/-OP64HC3ibqmtD4bCM8l) | 71     | 2.0.76  |
| `nauvis-midgame-science.txt`   | Mid-game Science                                 | [`-Oe7Ua7QavpUFi7znoaM`](https://www.factorio.school/view/-Oe7Ua7QavpUFi7znoaM) | 8      | 2.0.72  |
| `vulcanus-starter-mk2.txt`     | Vulcanus Starter Mk2                             | [`-On2A94-dyLTSW4Riapk`](https://www.factorio.school/view/-On2A94-dyLTSW4Riapk) | 37     | 2.1.12  |
| `gleba-base-mall-all.txt`      | Gleba Base (Mall + All)                          | [`-OFa_ZWh1hQypFqucMTy`](https://www.factorio.school/view/-OFa_ZWh1hQypFqucMTy) | 320    | 2.1.12  |
| `gleba-mall-5-planets.txt`     | Gleba Mall - 5 Planets Tech (2000 SPM)           | [`-OYaLsmRoZfPAT5cm7p4`](https://www.factorio.school/view/-OYaLsmRoZfPAT5cm7p4) | 107    | 2.0.76  |
| `fulgora-mall-4-planets.txt`   | Fulgora Mall - 4 planets tech, normal quality    | [`-OX4QBKmwEZ6dIBJY5C5`](https://www.factorio.school/view/-OX4QBKmwEZ6dIBJY5C5) | 82     | 2.0.77  |
| `aquilo-cryogenic-science.txt` | Aquilo Cryogenic Science - 233 / Min, No Quality | [`-OHdIUzkrhCJUlzZRo33`](https://www.factorio.school/view/-OHdIUzkrhCJUlzZRo33) | 9      | 2.0.32  |
| `space-platform-factory.txt`   | Space Platform Factory                           | [`-OL_E6IO4gmQUdqFgTjq`](https://www.factorio.school/view/-OL_E6IO4gmQUdqFgTjq) | 30     | 2.0.76  |

All eight are by the same author, [Jepakazol](https://www.factorio.school/user/I6YX1Ar1cWUwhbQgMcW4nyZkDs52).

## UPSTREAM-277 - reporters' blueprints from the old repo

Recovered 2026-09-04 from
[`teoxoy/factorio-blueprint-editor` issue #277](https://github.com/teoxoy/factorio-blueprint-editor/issues/277),
a feedback round-up on the upstream project this fork continues. Its section
headed "Blueprints that don't load" is seven bare blueprint strings with no
prose between them: no author names, no titles, no explanation of what each one
was meant to show. Four of those seven are kept here.

| File                               | Book or blueprint label                                     | Declared version | Entities |
| ---------------------------------- | ----------------------------------------------------------- | ---------------- | -------- |
| `beacon-mall-2-0-43.txt`           | `Blueprint`                                                 | 2.0.43           | 1,145    |
| `combat-robot-capsules-1-1-69.txt` | `Capsules[item=destroyer-capsule][item=distractor-capsule]` | 1.1.69           | 186      |
| `corner-defense-1-1-34.txt`        | `Corner Defense`                                            | 1.1.34           | 438      |
| `mining-outpost-2-0-73.txt`        | (unlabelled)                                                | 2.0.73           | 1,368    |

Authorship is the one thing this collection cannot record. Each string was
pasted into a public issue by whoever hit the bug, and neither the issue nor
the strings themselves name a designer. The removal-on-request offer at the top
of this file applies to them the same way it applies to the two named
collections.

**"Doesn't load" was mostly a version gap, not a defect that reproduces here.**
Five of the seven declare 2.0.x, and upstream stopped at Factorio 1.1 - it has
no 2.0 prototypes to resolve them against, so it could not have loaded them
whatever their contents. That covers `beacon-mall` and `mining-outpost`.

It does not cover the two 1.1-era files, and honesty is better than a tidy
story: nobody has run upstream against them, so why they were reported is
unknown. `combat-robot-capsules` at least has a mechanism worth writing down.
It carries four `logistic-chest-storage`, and upstream applied its rename table
unconditionally, with the version conditions written as comments rather than
code - the same bug this fork fixed in issue #40. Against a 1.1 dataset that
rewrite produces `storage-chest`, a name 1.1 does not have. That is a
hypothesis, not a measurement.

What _is_ measured, on 2026-09-04, is the property this directory rests on:
every one of the four inflates, parses, and resolves every entity name against
`packages/exporter/data/output/data.json` - `logistic-chest-storage` through
the pre-2.0 gate in `nameMigrations.ts`, which is exactly the path it is here
to exercise.

### Why these four and not the other three

`combat-robot-capsules-1-1-69.txt` is the one that pays for itself. Before it,
the note further down this file was flatly true - the corpus was entirely
post-2.0 and so could reach no pre-2.0 branch at all. This file declares
1.1.69 and carries both kinds of pre-2.0 work: four `logistic-chest-storage`
for the rename table, and eight `control_behavior.filters` without `sections`
for the combinator shape migration in `Blueprint.ts`. Both were covered only by
hand-built blueprints from `tests/helpers/encode-blueprint.ts` until now. It
costs 2,545 characters, about 0.05% of the corpus.

`corner-defense-1-1-34.txt` is the second pre-2.0 file and buys the corpus's
thinnest grid-reading family. Gates pick a sprite from their neighbours, and
the whole corpus held 240 of them; this adds 24, plus 196 `stone-wall` in a
defensive line rather than a factory wall.

`beacon-mall-2-0-43.txt` is kept for underground-belt pairing density. Pairing
is one of the grid-reading `draw_*` functions, and the ratio is what matters
rather than the count: the corpus runs 28,376 undergrounds against 110,008
belts, about 26%, while this file runs 230 against 440, about 52%. Nothing else
here weaves undergrounds that tightly.

`mining-outpost-2-0-73.txt` carries the only entity name in all seven that the
real half of the suite lacked: `electric-mining-drill`, 175 of them. It was
reachable before only through the synthetic blueprint, which by construction
spaces entities so none of them touch.

The three left out add nothing the corpus does not already hold, and a corpus
file is not free - see "Facts the test suite depends on" at the end of this
file.

### The pinned fixtures for these four are not recorded yet

Adding these files changes every corpus-derived fixed point in the browser
suite, and **none of them has been moved**. Until they are, the Playwright job
fails and this collection is not mergeable. That is deliberate rather than an
oversight: those values are fixed points, the only honest way to change one is
to measure it, and the machine these files were added on cannot run Playwright
at all. A guessed fixture is worse than a red one - it passes.

What has to be re-recorded, against a run with all 16 files present:

- `tests/blueprint-round-trip.spec.ts`, `EXPECTED` - all of it. `blueprints`
  367 to 372 and `entities` 347,725 to 350,862 are already known from decoding
  the strings, but `tiles`, `wires` and `icons` should be re-measured rather
  than copied from this file, and `positionChecksum`,
  `modelPositionChecksum` and `serializedHash` can only come from a run.
- `tests/sprite-data.spec.ts` - the bare `expect(blueprintCount).toBe(367)`,
  plus `real` and `noGridReal` in `tests/__fixtures__/sprite-data.json`. The
  `synthetic`, `noGrid` and `paintPreview` halves are built from `data.json`
  rather than from the corpus and should not move; if one does, that is a
  finding, not a re-record.
- `tests/entity-accessors.spec.ts`, `EXPECTED` - `entityCount`,
  `blueprintCount`, and every bucket in `shape` and `values`.
- `tests/overlay-container.spec.ts`, `EXPECTED_REAL`. Watch
  `electric-mining-drill` in particular: it is in `EXPECTED_SYNTHETIC` and not
  in `EXPECTED_REAL`, and `mining-outpost` is what puts it there.
- `tests/sprite-generation.spec.ts`, `EXPECTED_FAILURES` - only if the new
  files reach a sprite path the corpus did not. Expected to stay empty.

`tests/helpers/blueprint-files.test.ts` is the one that moved with these files,
because it names the collections and runs under `vp test` rather than
Playwright, so it could be measured here.

- The 653-character one, `起手红瓶`, holds 21 entities across 4 names and not a
  single member of any grid-reading family. It was reported alongside a "click
  on assembler, screen goes blank" complaint, and that is a real thing to chase,
  but not here: these specs cover decode to model to render and serialize, and
  none of them clicks an entity. A click crash needs a targeted spec with a
  blueprint built for it.
- The `Micro grid` book, 651 entities, is 492 pipes and 88 rails against a
  corpus that already holds 27,275 pipes and 34,740 rails, the latter including
  a book that is nothing but a rail network.
- The 267-entity unlabelled one is 147 belts and 12 undergrounds, the same
  families `beacon-mall` carries at four times the density. Its one distinction
  is declaring 2.0.15, below this corpus's old floor of 2.0.32 - which buys
  nothing, because every version gate in the editor sits at 2.0.0 or below, so
  2.0.15 and 2.0.32 fall on the same side of all of them.

## What the set is chosen for

Not popularity. Two of the most-favourited blueprints on factorio.school for
these planets are deliberately **excluded**: `Fulgora Starter Factory` (104
hearts) and `Vulcanus Mall` (54 hearts) both contain `ee-infinity-loader`, an
Editor Extensions mod entity that is not in `data.json`. It would be stripped
with a warning, which breaks the one property this whole directory rests on -
that every file loads clean.

What the set is chosen for is **junction coverage**. Thirteen `draw_*` functions
in `spriteDataBuilder.ts` read the position grid to pick a sprite - pipes
picking a junction, belts picking a corner, undergrounds pairing up, heat pipes
and walls picking a connection, gates picking a rail base. The synthetic corpus
(`tests/helpers/all-entities-blueprint.ts`) cannot reach any of them by
construction: it spaces entities so that none of them touch. Only real bases do.

Measured against what the corpus held before this directory existed:
`stone-wall` 3,989 -> 6,130, `gate` 192 -> 240, loaders 4 -> 135. That last is
the one grid-reading family the ElderAxe books alone did not carry - four
`turbo-loader` and no `loader`, `fast-loader` or `express-loader` at all.

The swap was not pure gain. Five entity types left the real halves of the
suite entirely - `agricultural-tower`, `heat-interface`, `lightning-rod`,
`offshore-pump`, `thruster` - none of them present anywhere in this directory.
None has a grid-reading `draw_*` function, so none of the junction coverage
above depends on them, and all five stay covered by the synthetic, noGrid and
paintPreview halves (`tests/helpers/all-entities-blueprint.ts`), which place
every entity in `data.json` whatever the corpus holds. That is what made the
loss survivable rather than a reason not to.

`nauvis-midgame-science.txt` adds no entity type and no tile type the rest of
the set does not already carry. It is here for its arrangements - 1,428 pipes,
173 heat pipes, 3,683 belts, 1,220 undergrounds, 261 splitters, 28 loaders in
mid-game Nauvis geometry - and because it is a book of 11, which exercises the
book-walking path.

`vulcanus-starter-mk2.txt` is the largest file here at 389 KB and 32,638
entities and adds zero new entity types. It is kept for the same reason: 8,776
pipes in arrangements nothing else covers.

## Facts the test suite depends on

Re-derive these rather than trusting them. The first line was re-measured on
2026-09-04, when UPSTREAM-277 was added; the rest date from 2026-08-05.

- **16 files, 372 flattened blueprints** (a nested book contributes its contents,
  not itself), 350,862 entities, 232,815 tiles, 49,182 wires, 970 icons,
  4,910,200 bytes on disk (4.68 MiB).
  The flattened count excludes 17 planners - 11 deconstruction and 6 upgrade -
  which are nodes in these books but are not blueprints and are not counted as
  such by any spec. Before UPSTREAM-277 the figures were 12 files, 367
  blueprints, 347,725 entities, 48,869 wires, 956 icons.
- **Zero unknown prototypes.** Every entity name and tile name resolves against
  `packages/exporter/data/output/data.json`. Adding a file that does not hold
  this breaks `blueprint-loading.spec.ts` and `tests/unknown-prototypes.spec.ts`
  at once. One name needs a migration to get there: the four
  `logistic-chest-storage` in `UPSTREAM-277/combat-robot-capsules-1-1-69.txt`
  resolve only because `nameMigrations.ts` renames them to `storage-chest`
  under its pre-2.0 gate. That is the point of the file, and it also means a
  regression in that gate now shows up as an unknown prototype.
- **Declared versions run 1.1.34 to 2.1.12.** Until UPSTREAM-277 they were all
  post-2.0 and no pre-2.0 branch was reachable from here at all. Two files now
  reach some of it - the rename table in `nameMigrations.ts` and the combinator
  shape migration in `Blueprint.ts`. The rest still needs a synthetic blueprint
  at a chosen version, which is what `tests/helpers/encode-blueprint.ts` is for:
  nothing here holds an array-shaped `request_filters`, so that half of the
  shape migrations stays synthetic-only.
- **Every file starts with `0`**, the plain blueprint-string form, so the
  `?source=` handlers in `bpString.ts` are unreachable from here by
  construction. `tests/blueprint-sources.spec.ts` covers those instead.

Adding a file moves five sets of pinned fixture values -
`tests/__fixtures__/sprite-data.json` and the inline `EXPECTED` blocks in
`entity-accessors`, `blueprint-round-trip` and `overlay-container`, plus
possibly `EXPECTED_FAILURES` in `sprite-generation`. Those are fixed points with
no re-record path on purpose. Weigh what a new file buys against that.

Two of those are worth naming exactly, because they are counts rather than
tallies and so read as harmless: `blueprint-round-trip.spec.ts` pins
`blueprints: 367` alongside two position checksums and a hash of every
serialized blueprint, and `sprite-data.spec.ts` asserts `blueprintCount` is
367 on its own line. Both are now 372.
