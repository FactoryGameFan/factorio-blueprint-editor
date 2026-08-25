# Does a rail's collision box rotate, and does `data.json` match the game?

A headless probe, written to de-risk run 2 of `probe-blueprint-grid-position-gui`
before a person spent time on it. It found three things that would each have
corrupted that run silently, and one that is bigger than the run.

## Why it exists

Run 2 of the grid-position probe puts a `half-diagonal-rail` at one spot and
depends on it producing three distinct floors on the y axis - centre, tile
footprint edge, collision box edge. That spread is the only thing separating
"the corner is the footprint edge" from "the corner is the collision box edge",
which is the open half of PR #243's finding 15.

The numbers came from `data.json`. Half-diagonal rails exist only at diagonal
orientations, so a rail stored rotated would put the long extent on the wrong
axis, collapse the spread, and report no surviving reading - which reads as
"the rule is wrong" rather than "the instrument was pointed sideways".

None of that needs a player, so this is a `create` run rather than an
interactive one. `docs/method.md`: ask the cheapest question that settles the
thing.

## What it found

**The box does not rotate.** All 16 requested directions produce one identical
bounding box, folding to stored directions 0, 2, 4 and 6. The orientation fear
was unfounded.

**The rail snaps.** Asked for `(20, 20)`, the game places it at `(21, 21)`. Every
prediction computed for a centre of 20 was for a position that cannot exist.

**`data.json` and the running game disagree about collision boxes, and only
about rails.** Across all 155 entities:

|                                 | count  |
| ------------------------------- | ------ |
| agree to within one 1/256 step  | 139    |
| disagree beyond that            | 16     |
| of those 16, how many are rails | **16** |

The 139 are not a finding: Factorio stores positions in 1/256 of a tile, so a
runtime box is the declared one snapped to that grid, and the worst deviation
among them is 0.00375 against a quantum of 0.00390625. Separating the two
mattered, because lumping them together buries 16 real differences under 139
uninteresting ones.

The 16 are every rail prototype plus its `dummy-` and `elevated-` variants.
`legacy-curved-rail` is the worst at 1.45 tiles, and its runtime box is not even
symmetric where `data.json` says it is:

```
legacy-curved-rail   data.json [-2, -2, 2, 2]
                     runtime   [-0.75, -0.546875, 0.75, 1.5976562]
half-diagonal-rail   data.json [-0.75, -2.236, 0.75, 2.236]
                     runtime   [-0.75, -1.8984375, 0.75, 1.8984375]
straight-rail        data.json [-1, -1, 1, 1]
                     runtime   [-0.6992188, -0.9882812, 0.6992188, 0.9882812]
```

That is worth knowing beyond this probe. `CLAUDE.md` already records rails as
the place where the editor's geometry is wrong in both directions (#133, #142);
this says the editor's own **data** disagrees with the game there too, and
nowhere else.

## Should `data.json` adopt the runtime boxes?

No. Running both sets of boxes through `getEntitySize` changes only
`legacy-curved-rail`, from 4x4 to 2x3; the other 15 differences round to the
same footprint or are masked by a declared dimension. Against the 38
orientations in `fixtures/rail-occupancy.json`, the runtime boxes trade one
error for another rather than improving the result:

| boxes       | occupied but not keyed | keyed but empty |
| ----------- | ---------------------- | --------------- |
| `data.json` | 180                    | 96              |
| runtime     | 220                    | 56              |

The committed fixture can recompute this comparison without rerunning Factorio:

```fish
node tools/oracle/analyze-rail-box-orientation.mjs tools/oracle/fixtures/rail-box-orientation.json
```

## Controls

A control has to be able to fail while the hypothesis holds.

| Control                                          | Fails when                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| every direction produced a placement             | a refused placement is being read as a geometry answer                                           |
| the sweep covered more than one stored direction | only one orientation was ever placed, which would report a single box and look identically clean |
| the probe recorded no Lua errors                 | a `pcall` swallowed something                                                                    |

The middle one is the load-bearing one for the "it does not rotate" finding,
which is otherwise unfalsifiable.

## Running it

```fish
cd ~/GitHub/factorio-blueprint-editor; and cargo run --quiet --manifest-path ~/GitHub/factorio-oracle/Cargo.toml -- run --probe tools/oracle/probe-rail-box-orientation/probe.json --work-dir /tmp/railbox --factorio ~/GitHub/factorio-oracle/installs/factorio-2.0.77.app --version 2.0.77 >/tmp/railbox-run.json
```

```fish
node tools/oracle/analyze-rail-box-orientation.mjs /tmp/railbox/write/script-output/oracle-dump.json --write-fixture
```

The `cd` is load-bearing: `control_lua_file` is repo-relative and the CLI reads
it against the shell's working directory.

## One thing that cost two runs

**A `]]` inside a `--[[` Lua comment closes the comment.** This probe's header
explains a collision box in Lua table notation, whose own brackets terminated
the comment early, so everything after it parsed as code and the mod silently
never registered its `on_init`. The failure names nothing useful: the run
reports "no oracle-dump.json was written", which is the same message a
`factorio_version` mismatch produces.

Two notes on finding it. What located it was running the CLI's own
`examples/pumpjack-terminals` probe as a **control** - it passed on the same
binary and the same command shape, which moved the fault from the environment
to this file in one step. And the tell in the log is a line that is _absent_:
a working run prints `Checksum for script __<mod>__/control.lua` and a broken
one does not, while both print everything else identically.

The header is a level-1 long comment now. Note that the fix has the same trap
one level up - writing the level-1 terminator inside the comment closes it too,
which is what broke the first attempt at the fix.
