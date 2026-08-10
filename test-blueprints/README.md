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

Re-derive these rather than trusting them; they were measured on 2026-08-05.

- **12 files, 367 flattened blueprints** (a nested book contributes its contents,
  not itself), 347,725 entities, 232,815 tiles, 4.68 MB.
- **Zero unknown prototypes.** Every entity name and tile name resolves against
  `packages/exporter/data/output/data.json`. Adding a file that does not hold
  this breaks `blueprint-loading.spec.ts` and `tests/unknown-prototypes.spec.ts`
  at once.
- **Declared versions run 2.0.32 to 2.1.12**, all post-2.0. So the corpus still
  cannot reach any pre-2.0 branch - `nameMigrations.ts`, and the two shape
  migrations in `Blueprint.ts`. Those need a synthetic blueprint at a chosen
  version, which is what `tests/helpers/encode-blueprint.ts` is for.
- **Every file starts with `0`**, the plain blueprint-string form, so the
  `?source=` handlers in `bpString.ts` are unreachable from here by
  construction. `tests/blueprint-sources.spec.ts` covers those instead.

Adding a file moves five sets of pinned fixture values -
`tests/__fixtures__/sprite-data.json` and the inline `EXPECTED` blocks in
`entity-accessors`, `blueprint-round-trip` and `overlay-container`, plus
possibly `EXPECTED_FAILURES` in `sprite-generation`. Those are fixed points with
no re-record path on purpose. Weigh what a new file buys against that.
