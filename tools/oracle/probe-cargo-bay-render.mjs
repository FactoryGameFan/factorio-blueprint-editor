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

/** [name, bay positions, screenshot centre]. Positions are entity centres. */
const CASES = [
    ['lone', [[0, 0]], [0, 0]],
    [
        'h-pair',
        [
            [40, 0],
            [44, 0],
        ],
        [42, 0],
    ],
    [
        'v-pair',
        [
            [80, 0],
            [80, 4],
        ],
        [80, 2],
    ],
    [
        'row3',
        [
            [120, 0],
            [124, 0],
            [128, 0],
        ],
        [124, 0],
    ],
    [
        'block',
        [
            [160, 0],
            [164, 0],
            [160, 4],
            [164, 4],
        ],
        [162, 2],
    ],
    [
        'ell',
        [
            [200, 0],
            [204, 0],
            [200, 4],
        ],
        [202, 2],
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
  -- a flat, uniform floor, so differencing the two shots gives a clean mask
  local tiles = {}
  for x = -20, 240 do for y = -20, 20 do tiles[#tiles+1] = {name="refined-concrete", position={x,y}} end end
  s.set_tiles(tiles)
  local placed = {}
  for _, c in pairs(CASES) do
    for _, xy in pairs(c[2]) do
      local e = s.create_entity{name="cargo-bay", position={xy[1], xy[2]}, force="player", raise_built=true}
      local b = e.bounding_box
      placed[#placed+1] = { case = c[1], asked = xy, got = {e.position.x, e.position.y},
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
      surface = s, position = {c[3][1], c[3][2]}, resolution = {512, 512}, zoom = 2,
      path = c[1] .. suffix .. ".png", show_gui = false, show_entity_info = false,
      daytime = 0, water_tick = 0, anti_alias = false,
    }
  end
end

script.on_event(defines.events.on_tick, function()
  local s = game.surfaces[1]
  if game.tick == 30 then shoot("") end
  if game.tick == 70 then
    for _, e in pairs(s.find_entities_filtered{name="cargo-bay"}) do e.destroy() end
  end
  if game.tick == 110 then shoot("-empty") end
  if game.tick > 170 then
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

const scriptOutput = join(p.writeData, 'script-output')
if (!existsSync(scriptOutput)) throw new Error(`Factorio produced nothing. Work dir: ${p.work}`)
mkdirSync(OUT, { recursive: true })
const files = readdirSync(scriptOutput)
for (const f of files) copyFileSync(join(scriptOutput, f), join(OUT, f))
console.log(`wrote ${files.length} files to ${OUT}`)
console.log(files.join(' '))
