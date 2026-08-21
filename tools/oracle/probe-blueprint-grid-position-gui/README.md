# What does the blueprint GUI's "Grid position" field do?

The first probe here to run on the shared `factorio-oracle` CLI (issue #235),
and the first that needs a person at the keyboard since the zoom probe.

## The question

PR #243 ships a `getGridPositionDisplay()` in `packages/editor/src/core/Blueprint.ts`
built on this rule:

> Setting Grid position to `T` shifts the exported content so that
> `-floor(min position over entities and tiles)` equals `T`, and writes no
> snapping field.

`tools/oracle/fixtures/blueprint-grid-position.json` appears to refute that. It
scores the "grid position moves entities" premise **0 of 2**, with
`entitiesMovedOn: 0`, measured on 2.0.77 - the version this editor targets.
`factorio-oracle/docs/method.md` cites it as settled.

Both cannot be right about the same field, and they are not about the same
field. The earlier capture set `blueprint_position_relative_to_grid`. The game's
own locale separates the two concepts in a single line:

```
core.cfg:274  grid-position-and-absolute-position-need-to-match=
              Grid position and blueprint grid position coordinates need to be
              either all even or all odd.
```

So the old fixture measured the neighbour. Its answer stands and is not an
answer to this question.

## Why a person has to drive it

Checked before choosing the expensive route, per `docs/order-of-attack.md`.

- `LuaItemCommon` on 2.0.77 exposes exactly three blueprint snapping
  attributes - `blueprint_snap_to_grid`, `blueprint_absolute_snapping` and
  `blueprint_position_relative_to_grid`. None is this field.
- `create_blueprint` takes no anchor parameter.
- The game's own tooltip says how the field is set:
  `grid-position-tooltip=SHIFT + LEFT-CLICK in the preview to change the grid
position.`

There is no script that can set it. "No headless probe can reach it" is not
"not worth measuring".

## What the layout is for

Each axis answers one question, because each axis's corner is set by exactly
one thing. Run 1 needed two questions. Run 2 needs three, so one axis carries
two of them.

**Run 1** (the committed fixture's `layout`):

| Axis | Decided by                                    | Separates                                                 |
| ---- | --------------------------------------------- | --------------------------------------------------------- |
| x    | a 3x3 assembling machine at 10.5              | entity **centres** (floor 10) against **edges** (floor 9) |
| y    | a tile at y=10, six tiles clear of everything | whether **tiles** count towards the corner at all         |

Both were answered: the corner reads edges, and tiles do count. What run 1
could not say is **which** edge - a tile footprint edge or a `collision_box`
edge - because for every entity it placed the two floor to the same integer.
`assembling-machine-1` is 9.0 against 9.3.

**Run 2** replaces the assembling machine with a `half-diagonal-rail`, which is
close to the only entity that can settle it:

| Axis | Decided by                     | Separates                                                  |
| ---- | ------------------------------ | ---------------------------------------------------------- |
| y    | a `half-diagonal-rail` at y=20 | centre **20**, footprint edge **19**, box edge **17.764**  |
| x    | stone-path tiles at x=2        | whether tiles count, against the nearest entity reading, 9 |

The editor derives a footprint by _ceiling_ the collision box
(`factorioData.ts:617`), so a box cannot escape its own footprint unless a
declared `tile_width`/`tile_height` overrides it. Five of the 155 entities in
`data.json` manage that, and this is the only one splitting all three readings
apart on one axis. `offshore-pump` is the near miss: it separates the two edges
on both axes but not centre from footprint edge, being 1x1.

**The rail is this layout's risk, and a known one.** `data.json` carries one box
orientation, and half-diagonal rails exist only at diagonal orientations, so a
rail stored at a rotated direction makes the numbers above wrong. That surfaces
as y readings matching none of the three predictions, which the recorded
`layout` and per-case `minCornerReadings` make visible. It is not silent.

The content deliberately does not start at the origin, and the session asks for
a second change on top of a first, because "an absolute target" and "a relative
nudge of `-T`" agree whenever the corner already sits at 0.

## The three pairs in the panel

Measured 2026-08-21, and worth knowing before driving it, because two of the
three look alike and only one is the subject of this probe:

```
☑ Snap to grid
  Grid size        Width 12   Height 17    <- snap-to-grid
  Grid position        X 3    Y 5          <- THIS ONE: shifts the exported content
  ● Absolute           X 9    Y 10         <- position-relative-to-grid
  ○ Relative
```

Both lower pairs were on screen at once holding different values, which is what
proves they are separate fields rather than one field read twice. The Grid
position pair writes **no key at all** into the export - it moves the entity and
tile coordinates instead, which is exactly the model PR #243 is built on, and is
why no scripting API can reach it.

Absolute is selected by default the moment Snap to grid is ticked, so the
session's step 6 sets that row's own pair rather than picking the mode. Relative
is the only side of the toggle a person has to travel to.

## Running it

Name the install with `--factorio`. `--version` on its own is not enough: a bare
discovery finds only the Steam 2.1.14, so there is no 2.0.77 for it to filter
down to. `--factorio` puts that root at the front of the candidate list, and
`--version` is then a guard that makes picking the wrong game impossible rather
than merely unlikely.

Run it from this repo's root. `control_lua_file` in `probe.json` is a
repo-relative path and `read_control_lua` in the CLI reads it verbatim, so it
resolves against the shell's working directory rather than against the probe
file's own directory. An absolute `--probe` from elsewhere therefore fails with
`reading control_lua_file ... No such file or directory`, which names the Lua
file rather than the real cause. Not a CLI bug to fix: its own
`examples/pumpjack-terminals/probe.json` uses the same convention, and
resolving relative to the probe file would break that one.

```fish
cd ~/GitHub/factorio-blueprint-editor; and cargo run --quiet --manifest-path ~/GitHub/factorio-oracle/Cargo.toml -- run --probe tools/oracle/probe-blueprint-grid-position-gui/probe.json --work-dir /tmp/gridpos --factorio ~/GitHub/factorio-oracle/installs/factorio-2.0.77.app --version 2.0.77 >/tmp/gridpos-run.json
```

The game opens. There is no timeout - an interactive run lasts as long as you
play. The mod builds the layout, hands you a blueprint, runs its four scripted
controls, and prints the steps in the console.

Press `~` for the console. The steps, which the game will also print:

1. `/gp-cap untouched`
2. Open the blueprint GUI, tick **Snap to grid**, close. `/gp-cap snap-on`
3. Set **Grid position** to X=3 Y=5, close. `/gp-cap gridpos-3-5`
4. Set **Grid position** to X=8 Y=9, close. `/gp-cap gridpos-8-9`
5. Set **Grid position** back to X=0 Y=0, close. `/gp-cap gridpos-0-0`
6. On the **Absolute** row set X=2 Y=6 (it is already picked), close. `/gp-cap abs-2-6`
7. Untick **Snap to grid**, close. `/gp-cap snap-off`

Step 4 is the one that separates a target from a nudge. Do not skip it.

`/gp-note <text>` records anything surprising - a value the game refused, a
field that reset itself, a parity warning. Those are findings, not noise. The
locale carries two refusal strings and a parity rule, so expect at least one.

`/gp-reset` rebuilds and starts over. `/gp-help` reprints the steps.

Quit the game when done. Nothing is lost by quitting: the mod appends each
capture as it happens.

## Reading the result

```fish
node ~/GitHub/factorio-blueprint-editor/tools/oracle/analyze-blueprint-grid-position-gui.mjs --run /tmp/gridpos-run.json --write-fixture
```

It exits non-zero if a control failed, in which case the numbers are void
rather than a finding.

`survivingReadings` is the answer. It lists the readings that match **every**
scored row, not the one that fits the last. If it is empty, all four candidate
rules are wrong and the real one has not been written down yet - which is a
result, and a more interesting one.

## The controls, and why each is there

A control has to be able to fail while the hypothesis holds. PR #222's original
capture had four cases that would have reported "the coordinates did not
change" whether the probe was right or reading the same field twice.

| Control             | Fails when                                                                         |
| ------------------- | ---------------------------------------------------------------------------------- |
| `instrument-repeat` | export is not deterministic, which voids every "it moved" row                      |
| `positive-shift`    | the comparison cannot see a shift at all, which makes "nothing moved" mean nothing |
| `rival-field`       | the neighbouring field is not reachable, so the two cannot be told apart           |

`rival-field` is the one that matters most here. It sets
`blueprint_position_relative_to_grid` on the same rig, so if the human-driven
rows move the same numbers as the scripted ones, the two fields are one field
after all and the old fixture was right.

Everything the script set is tagged `script` and excluded from the scoring by
tag rather than by value, because a script-set value is not a measured one.

## Instrument check

The analysis was validated against a synthetic capture stream with known
answers before any game time was spent:

- All four readings computed as hand-derived, and all four differ, so the
  instrument can discriminate.
- Planting a world where entity-centres-plus-tiles is the true rule leaves
  exactly that one reading surviving and kills the other three on every row.
- Mutating the repeat captures to differ fails the instrument control and only
  that one. Mutating the positive control not to move fails that one and only
  that one. Both exit non-zero.
- A session that captures no scored step reports `unmeasured` rather than four
  vacuously surviving readings, which is what `every()` over an empty list
  would otherwise have produced.
