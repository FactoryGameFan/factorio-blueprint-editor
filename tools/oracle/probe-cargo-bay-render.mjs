/*
    Issue #378. Renders cargo bay arrangements in the real game and hands back
    screenshots, so "does this look right" can be answered against Factorio
    rather than against our own reading of the prototype data.

    This is the only probe here that needs the game to DRAW. The others run
    `--create`, which loads mods and runs `on_init` but never renders, so
    `game.take_screenshot` produces nothing. The trick is two runs:

      1. `--create` a map with a mod that builds the arrangements in `on_init`.
      2. `--load-game` that map, which opens the graphical client. The mod
         screenshots on a later tick, then `error("DUMPED-OK")` to quit.

    So unlike every other probe here this one needs a GPU and a windowed
    session. It cannot run in CI, and nothing in CI depends on it.

    Each case is captured twice, with the bays and then with them destroyed, so
    the consumer can difference the pair into an exact entity mask instead of
    guessing which pixels are ground.

    Two things the difference still catches that are not the entity's own art.
    An entity lights the ground around it, so a soft halo a tile or two wide
    reads as "the game drew something here"; and its shadow falls outside its
    footprint. Score a candidate piece over the pixels it would itself cover,
    where both are absent, rather than over a window of open ground.

    WHAT IT ALREADY ANSWERED, so nobody re-derives it:

    - Connection pieces are placed per 2x2 cell, not once per entity. Scored
      against the game, the shipped entity-wide version is 46.1% of the
      entity's pixels wrong on two adjacent bays; per-cell is 16.3%.
    - The `bridge_*` pieces are needed, and are anchored on the shared edge
      BETWEEN two entities rather than on a cell - which is why no cell mask
      ever selects one, and why reading `tileset_mapping` alone says they are
      unreachable. Adding one per seam takes two adjacent bays to 11.6% and a
      row of three to 8.9%, with only ~300 of 129,287 pixels left missing.
    - Vertical adjacency is the worst case without them, at 34.5%.
    - Which bridge goes where. The key names the direction the bridge spans, so
      entities side by side take `bridge_horizontal_*` and stacked ones take
      `bridge_vertical_*`; a 4-tile shared edge takes `_wide` and a 2-tile one
      `_narrow`; and a cell corner where the covering entity changes both left
      to right and top to bottom takes `bridge_crossing`. At every seam measured
      exactly one of the eight candidates beats drawing nothing.
    - Nothing at all spans a 2-tile gap - the `gap2` case is the control for
      that, and it is why "bridge" does not mean what the word suggests.

    Run it directly; there is no fixture. FACTORIO_BIN must point at a full
    (non-headless) install - the 2.0.77 build this editor targets is at
    ~/GitHub/factorio-oracle/installs/factorio-2.0.77.app.
*/
import { prepareProbe } from './factorio-probe.mjs'
import { writeFileSync, existsSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const BIN =
    process.env.FACTORIO_BIN ??
    `${process.env.HOME}/GitHub/factorio-oracle/installs/factorio-2.0.77.app/Contents/MacOS/factorio`
const OUT = process.env.OUT_DIR ?? '/tmp/cargo-bay-render'

/**
 * [name, entities, screenshot centre, zoom]. An entity is [prototype, x, y] and
 * the coordinates are entity centres. Zoom 2 shows 8x8 tiles in the 512 px shot,
 * zoom 1 shows 16x16 - a case only needs the smaller zoom when it does not fit.
 *
 * The first six cases are what pinned per-cell placement and the wide bridges.
 * The rest were added to reach the pieces those could not: the two `*_narrow`
 * keys, `bridge_crossing` at more than one place, and the two 8x8 entities.
 */
const CASES = [
    ['lone', [['cargo-bay', 0, 0]], [0, 0], 2],
    [
        'h-pair',
        [
            ['cargo-bay', 40, 0],
            ['cargo-bay', 44, 0],
        ],
        [42, 0],
        2,
    ],
    [
        'v-pair',
        [
            ['cargo-bay', 80, 0],
            ['cargo-bay', 80, 4],
        ],
        [80, 2],
        2,
    ],
    [
        'row3',
        [
            ['cargo-bay', 120, 0],
            ['cargo-bay', 124, 0],
            ['cargo-bay', 128, 0],
        ],
        [124, 0],
        2,
    ],
    [
        'block',
        [
            ['cargo-bay', 160, 0],
            ['cargo-bay', 164, 0],
            ['cargo-bay', 160, 4],
            ['cargo-bay', 164, 4],
        ],
        [162, 2],
        2,
    ],
    [
        'ell',
        [
            ['cargo-bay', 200, 0],
            ['cargo-bay', 204, 0],
            ['cargo-bay', 200, 4],
        ],
        [202, 2],
        2,
    ],

    // A 2-tile offset. A cargo bay declares no `build_grid_size`, so it snaps to
    // whole tiles and both of these are legally placed; they share only 2 tiles
    // of edge instead of 4. This is the case the `*_narrow` keys answer.
    [
        'h-offset',
        [
            ['cargo-bay', 240, 0],
            ['cargo-bay', 244, 2],
        ],
        [242, 1],
        2,
    ],
    [
        'v-offset',
        [
            ['cargo-bay', 280, 0],
            ['cargo-bay', 282, 4],
        ],
        [281, 2],
        2,
    ],

    // A 2-tile gap, to separate "a bridge spans a gap" from "a bridge covers a
    // seam". Nothing should join these two.
    [
        'gap2',
        [
            ['cargo-bay', 320, 0],
            ['cargo-bay', 326, 0],
        ],
        [323, 0],
        2,
    ],

    // An 8x8 entity against a 4x4 one, and two 8x8 entities against each other.
    // A landing pad's side is 4 cells long where a bay's is 2.
    [
        'pad-bay',
        [
            ['cargo-landing-pad', 360, 0],
            ['cargo-bay', 366, -2],
        ],
        [364, -2],
        2,
    ],
    [
        'pad-bays',
        [
            ['cargo-landing-pad', 400, 0],
            ['cargo-bay', 406, -2],
            ['cargo-bay', 406, 2],
        ],
        [402, 0],
        1,
    ],

    // Two crossings, so a position-dependent crossing variant would show up as
    // different art at the two of them.
    [
        'block2x3',
        [
            ['cargo-bay', 440, 0],
            ['cargo-bay', 444, 0],
            ['cargo-bay', 440, 4],
            ['cargo-bay', 444, 4],
            ['cargo-bay', 440, 8],
            ['cargo-bay', 444, 8],
        ],
        [442, 4],
        1,
    ],
]

/* JSON is not Lua: `[a,b]` has to become `{a,b}` or the mod fails to load. */
const toLua = v =>
    Array.isArray(v)
        ? `{${v.map(toLua).join(',')}}`
        : typeof v === 'string'
          ? JSON.stringify(v)
          : String(v)

const p = prepareProbe({
    name: 'cargobayrender',
    title: 'cargo bay render',
    factorio_version: '2.0',
    dependencies: ['space-age'],
})

writeFileSync(
    join(p.modPath, 'control.lua'),
    `
local CASES = ${toLua(CASES)}

script.on_init(function()
  local s = game.surfaces[1]
  s.always_day = true
  s.daytime = 0
  for _, e in pairs(s.find_entities()) do if e.type ~= "character" then e.destroy() end end
  -- a flat, uniform floor, so differencing the two shots gives a clean mask.
  -- set_tiles is silent on an ungenerated chunk, so the chunks have to exist
  -- first: without this the far cases land on natural ground with rocks and
  -- bushes on it, and the pair no longer differs only by the entity.
  s.request_to_generate_chunks({240, 0}, 20)
  s.force_generate_chunk_requests()
  local tiles = {}
  for x = -20, 480 do for y = -24, 28 do tiles[#tiles+1] = {name="refined-concrete", position={x,y}} end end
  s.set_tiles(tiles)
  s.destroy_decoratives{area = {{-20, -24}, {480, 28}}}
  local placed = {}
  for _, c in pairs(CASES) do
    for _, ent in pairs(c[2]) do
      local e = s.create_entity{name=ent[1], position={ent[2], ent[3]}, force="player", raise_built=true}
      local b = e.bounding_box
      placed[#placed+1] = { case = c[1], name = ent[1], asked = {ent[2], ent[3]},
                            got = {e.position.x, e.position.y},
                            box = {b.left_top.x, b.left_top.y, b.right_bottom.x, b.right_bottom.y} }
    end
  end
  -- the control: what the game actually placed, so a geometry mistake in the
  -- caller cannot be mistaken for a rendering difference
  helpers.write_file("placed.json", helpers.table_to_json(placed))
end)

local function shoot(suffix)
  local s = game.surfaces[1]
  for _, c in pairs(CASES) do
    game.take_screenshot{
      surface = s, position = {c[3][1], c[3][2]}, resolution = {512, 512}, zoom = c[4],
      path = c[1] .. suffix .. ".png", show_gui = false, show_entity_info = false,
      daytime = 0, water_tick = 0, anti_alias = false,
    }
  end
end

script.on_event(defines.events.on_tick, function()
  local s = game.surfaces[1]
  if game.tick == 60 then shoot("") end
  if game.tick == 140 then
    for _, e in pairs(s.find_entities_filtered{name={"cargo-bay", "cargo-landing-pad", "space-platform-hub"}}) do e.destroy() end
  end
  if game.tick == 220 then shoot("-empty") end
  if game.tick > 320 then
    helpers.write_file("done.txt", "ok")
    error("DUMPED-OK")
  end
end)
`
)

const config = join(p.work, 'config.ini')
writeFileSync(
    config,
    `[path]\nread-data=__PATH__executable__/../data\nwrite-data=${p.writeData}\n[general]\n[graphics]\nfull-screen=false\nwindow-size=640x480\n[other]\n`
)
const map = join(p.work, 'probe.zip')
const common = ['--mod-directory', p.modDir, '--config', config]

// run 1 builds and saves; it renders nothing
spawnSync(BIN, ['--create', map, ...common], { encoding: 'utf8' })
// run 2 opens the graphical client, which is the only way a screenshot happens
spawnSync(BIN, ['--load-game', map, ...common], { encoding: 'utf8', timeout: 240_000 })

/*
    The dump decides whether the run worked, not Factorio's exit code - which is
    the rule for every probe here, and it needs stating in full for this one.
    The dump is not one file: it is `done.txt`, the `placed.json` control, and a
    pair of screenshots per case. A run that dies partway still leaves a
    script-output directory behind, so checking only that the directory exists
    reports a truncated capture as a success, and the consumer then scores
    whichever cases happen to be there.
*/
const scriptOutput = join(p.writeData, 'script-output')
if (!existsSync(scriptOutput)) throw new Error(`Factorio produced nothing. Work dir: ${p.work}`)

const expected = ['done.txt', 'placed.json']
// String() because CASES is a heterogeneous tuple, so c[0] widens to the union
// of every element type even though the name is always the first one
for (const c of CASES) expected.push(`${String(c[0])}.png`, `${String(c[0])}-empty.png`)
const missing = expected.filter(f => !existsSync(join(scriptOutput, f)))
if (missing.length > 0) {
    throw new Error(
        `Factorio wrote ${expected.length - missing.length} of ${expected.length} expected files. ` +
            `Missing: ${missing.join(' ')}. Work dir: ${p.work}`
    )
}

mkdirSync(OUT, { recursive: true })
const files = readdirSync(scriptOutput)
for (const f of files) copyFileSync(join(scriptOutput, f), join(OUT, f))
console.log(`wrote ${files.length} files to ${OUT}, all ${expected.length} expected ones present`)
console.log(files.join(' '))
