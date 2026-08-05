# A public, committed blueprint corpus

Closes #186.

## The problem

Nine Playwright specs source their blueprints from `wormeyman-tests/`, which is
gitignored at `.gitignore:10` and not distributed. On any clone without it, those
specs do not degrade to reduced coverage - they fail at
`expect(files.length).toBeGreaterThan(0)` before generating anything.

For `tests/sprite-data.spec.ts` that is 2,095 of 3,645 digests, 57% of the
characterization harness for `spriteDataBuilder.ts` - the largest and most-churned
file in the repo. And it is specifically the half carrying the neighbour-reading
branches, which the synthetic corpus cannot reach by construction:
`buildAllEntitiesBlueprint` spaces entities so none of them touch.

`CONTRIBUTING.md:126-128` already documents the failure so it is not mistaken for
a regression. This spec fixes the cause instead.

## What was measured before deciding

The plan originally chosen was to build the junction cases synthetically. Measuring
the corpus killed that plan, which is the main reason this document exists.

**The four ElderAxe (EARN) books alone contain 11 of the 12 grid-reading entity
families** - every one except `loader`. The thirteen `draw_*` functions that read
`PositionGrid` cover `boiler`, `cargo_bay`, `cargo_landing_pad`, `gate`,
`heat_pipe`, `straight_rail`, `loader`, `pipe`, `reactor`, `splitter`,
`transport_belt`, `underground_belt` and `wall`. So a corpus that can be committed
closes #186 outright, with no new scaffolding and no new ground truth to invent.

Two findings that a selection by popularity would have gotten wrong:

- **`Fulgora Starter Factory` (104 hearts) and `Vulcanus Mall` (54 hearts) both
  contain `ee-infinity-loader`**, an Editor Extensions mod entity absent from
  `data.json`. It would be stripped with a warning, breaking the documented
  property that every corpus file loads clean and injecting strip warnings into
  `blueprint-loading.spec.ts`. Both are excluded.
- **`Vulcanus Starter Mk2` adds zero new entity types** despite being the largest
  file in the set at 389 KB and 32,638 entities. It is kept deliberately - it
  contributes 8,776 pipes in arrangements nothing else covers, and the digest sets
  are per-distinct-digest, so fresh junction geometry does earn its place - but the
  cost/coverage divergence is recorded here rather than discovered later.

## Decisions

### The corpus

`test-blueprints/` replaces `wormeyman-tests/`, committed rather than gitignored.
The old name is personal for what becomes a public, multi-author fixture, and the
rename is mechanical now while the directory is being rebuilt anyway.

**`test-blueprints/EARN/`** - the four ElderAxe books already on disk, byte-identical:

| File                                | Book label                                | Blueprint version | Entries |
| ----------------------------------- | ----------------------------------------- | ----------------- | ------- |
| `earn-v22-0-12.rev-2.txt`           | EARN - ElderAxe's Rail Network (v22.0.12) | 2.0.55            | 14      |
| `pocket-base-space-age-v22.1.2.txt` | Pocket Base - Space Age Edition (22.1.2)  | 2.0.73            | 11      |
| `power-blocks-v22-0-8.rev-1.txt`    | EARN Power Blocks (v22.0.8)               | 2.0.55            | 9       |
| `quick-start-v22-0-11.txt`          | ElderAxe's Quick Start Base (v22.0.11)    | 2.0.45            | 25      |

**`test-blueprints/JEPAKAZOL/`** - eight blueprints from factorio.school, one per
planet plus a space platform, named by target rather than by title:

| File                           | factorio.school key    | Hearts | Size   | Version | Blueprints | Entities |
| ------------------------------ | ---------------------- | ------ | ------ | ------- | ---------- | -------- |
| `nauvis-starter-bot-rush.txt`  | `-OP64HC3ibqmtD4bCM8l` | 71     | 57 KB  | 2.0.76  | 1          | 5,960    |
| `nauvis-midgame-science.txt`   | `-Oe7Ua7QavpUFi7znoaM` | 8      | 157 KB | 2.0.72  | 11         | 13,768   |
| `vulcanus-starter-mk2.txt`     | `-On2A94-dyLTSW4Riapk` | 37     | 389 KB | 2.1.12  | 5          | 32,638   |
| `gleba-base-mall-all.txt`      | `-OFa_ZWh1hQypFqucMTy` | 320    | 130 KB | 2.1.12  | 1          | 8,915    |
| `gleba-mall-5-planets.txt`     | `-OYaLsmRoZfPAT5cm7p4` | 107    | 254 KB | 2.0.76  | 1          | 21,974   |
| `fulgora-mall-4-planets.txt`   | `-OX4QBKmwEZ6dIBJY5C5` | 82     | 90 KB  | 2.0.77  | 1          | 7,495    |
| `aquilo-cryogenic-science.txt` | `-OHdIUzkrhCJUlzZRo33` | 9      | 6 KB   | 2.0.32  | 1          | 533      |
| `space-platform-factory.txt`   | `-OL_E6IO4gmQUdqFgTjq` | 30     | 52 KB  | 2.0.76  | 8          | 4,394    |

Retrieved 2026-08-05 via
`https://facorio-blueprints.firebaseio.com/blueprints/<key>.json`, field
`blueprintString`.

`nauvis-midgame-science.txt` ("Mid-game Science") is included **by request, and
measured as type-neutral**: it adds no entity type and no tile type the rest of
the set does not already carry. What it does add is 11 more blueprints and 13,768
entities of mid-game Nauvis arrangement - `pipe:1428`, `heat-pipe:173`,
`belt:3683`, `underground:1220`, `splitter:261`, `loader:28` - which do produce
distinct junction digests, and it is a **book** of 11, which exercises the
book-walking path in the specs that iterate every blueprint of every book. Clean
against `data.json`, no unknown prototypes.

`AVADII/` is deleted from the working tree and never enters history. The stray
top-level `a.txt` goes with it - it was never discovered anyway, since
`discoverBlueprintFiles()` only walks directories. The empty `NILAUS/` goes too.

Result: 12 files, 4.65 MB, against today's 10 files and 5.75 MB.

### What leaves with AVADII, and why it is survivable

Five entity types (`agricultural-tower`, `heat-interface`, `lightning-rod`,
`offshore-pump`, `thruster`) and three tile types (`foundation`, `landfill`,
`overgrowth-yumako-soil`) drop out of the real halves. Entity type coverage goes
115 -> 113 of the types the corpus reaches.

This costs nothing in junction coverage, which is what #186 is about:

- **None of the five has a grid-reading `draw_*` function.** Their sprites do not
  depend on neighbours, so a real-base arrangement of them tests nothing a
  synthetic placement does not.
- **All five stay covered** in the `synthetic`, `noGrid` and `paintPreview` halves,
  which place every entity in `data.json` regardless of corpus contents.
- **Both tile render branches survive** - the remaining eight tile types are six
  `variants.material_background` and two falling back to `variants.main`, so
  `tests/tiles.spec.ts` still exercises both.

Against that, the new corpus is _better_ where junctions are concerned:
`stone-wall` 3,989 -> 6,130, `gate` 192 -> 240, loaders 4 -> 135. The loader
figure was 107 while this document was being written and is 135 with Mid-game
Science in the set; it is also the interesting one, being the single
grid-reading family the EARN books alone did not carry. The old corpus held four
`turbo-loader` and no `loader`, `fast-loader` or `express-loader` at all, so
`draw_loader`'s neighbour branches had almost nothing to run against.

Scanning all 79 of Jepakazol's blueprints found no source for `offshore-pump`,
`thruster` or `heat-interface`, so chasing exact parity would mean sourcing from
further third-party authors. Rejected as not worth the attribution surface for
types with no neighbour-reading code.

### Attribution

`test-blueprints/README.md` credits both authors by name, with source links, heart
counts and the retrieval date, and states plainly that these are third-party
blueprints included as test fixtures. Provenance is recorded the way
`tools/oracle/fixtures/` records its own.

### Fixture regeneration, and the control that makes it reviewable

Five sets of pinned values are keyed to corpus membership and all move:

- `tests/__fixtures__/sprite-data.json` - the `real` and `noGridReal` halves
- `tests/entity-accessors.spec.ts` - inline `EXPECTED`, including `blueprintCount: 578`
- `tests/blueprint-round-trip.spec.ts` - inline `EXPECTED`, including
  `blueprints: 578`, both checksums and the output hash
- `tests/overlay-container.spec.ts` - inline `EXPECTED_REAL`
- `tests/sprite-generation.spec.ts` - `EXPECTED_FAILURES` may shrink;
  `railgun-turret` is in it only because the corpus places it at diagonal
  directions 2 and 14

Four other corpus specs need no fixture edits - `position-grid`,
`wire-connections`, `entity-container-mappings` and `blueprint-loading` assert
self-consistency and error-freedom, not pinned values.

2,000+ digests is past hand-editing, and the repo deliberately has no re-record
path. So: **a throwaway recorder, deleted in the same PR**, matching how
`tools/oracle/` treats probes - a measuring instrument, not a test.

The recorder gets a control for itself before its output is trusted:

1. Run it against the corpus **exactly as it is today**, AVADII included. Its
   output must be **byte-identical** to the committed fixtures. If it cannot
   reproduce what is already there, nothing it produces afterwards means anything.
2. Only then run it against the new corpus. Every remaining difference is
   attributable to the corpus change and nothing else.

Step 1 is the reason the recorder must be built and run **before** AVADII is
deleted. A subset check was considered and rejected: adding blueprints introduces
genuinely new digests, so `new ⊆ old` does not hold and would prove nothing.

## What does not change

- **The `expect(files.length).toBeGreaterThan(0)` guards stay as hard assertions.**
  With the corpus committed they are correct - a missing corpus is now a real
  failure rather than an expected local condition.
- **No synthetic junction scaffolding.** The measurement removed the need.
- The corpus stays post-2.0 throughout, so `CLAUDE.md`'s standing note that
  version-conditional code needs synthetic blueprints (`tests/helpers/encode-blueprint.ts`)
  is unaffected. The declared range widens from "2.0.45 to 2.0.73" to
  "2.0.32 to 2.1.12"; all twelve files were checked against `data.json` and carry
  zero unknown prototypes, so the 2.1.12 files load clean.

## Documentation

- `.gitignore:10` - remove `/wormeyman-tests`
- `tests/helpers/blueprint-files.ts` - the `TESTS_DIR` constant
- `CONTRIBUTING.md:126-128` - the "gitignored and not distributed" paragraph
  becomes obsolete and is replaced by a pointer to the corpus README
- `CLAUDE.md` - the corpus path in ~8 places, the 578-blueprint counts in the
  `entity-accessors` and `blueprint-round-trip` entries, and the "Every blueprint
  in the corpus declares 2.0.45 to 2.0.73" paragraph

## Verification

- `npx playwright test` green with both dev servers up (`npm run localpreview`)
- `vp check` and `vp test` clean
- The recorder's step-1 control reproduced the committed fixtures byte-identically
  before any corpus change
- The recorder is deleted before the PR lands; `git grep` confirms no reference to
  `wormeyman-tests` or `AVADII` survives

## Out of scope

- Moving Playwright into CI. It becomes _possible_ once the corpus is committed,
  and #186 notes the two are the same problem, but it is a separate change with its
  own cost.
- Refreshing the EARN books to their latest Patreon versions. Deliberately deferred
  so that "the corpus went public" and "the corpus versions moved" stay readable as
  separate diffs, given both regenerate every pinned fixture.
