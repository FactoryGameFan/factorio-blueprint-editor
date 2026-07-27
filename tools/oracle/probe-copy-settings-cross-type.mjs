/*
    Which CROSS-TYPE settings copies does Factorio allow, and what do they write?

    The rest of #94. `Entity.canPasteSettings` is `sourceEntity.type === this.type`,
    so every cross-type pair the TODO lists is refused before `pasteSettings`
    runs. Relaxing that gate means knowing which pairs the game itself accepts -
    guessing would either refuse something Factorio allows or allow something it
    does not.

    The assembling-machine -> requester-chest case is the one the issue calls the
    most used, and it carries a formula:

        Math.min(ingredientAmount,
                 Math.ceil((ingredientAmount * craftingSpeed) / recipe.energy_required))

    Two recipes are probed against it rather than one, chosen so the two terms of
    that `min` disagree. For assembling-machine-2 (crafting speed 0.75):

      - electronic-circuit (0.5s): copper-cable x3 -> ceil(3 * 0.75 / 0.5) = 5,
        so the min is the ingredient amount, 3.
      - processing-unit (10s): electronic-circuit x20 -> ceil(20 * 0.75 / 10) = 2,
        so the min is the formula, 2.

    A recipe where both terms agree would confirm nothing. processing-unit also
    takes a fluid, which a chest cannot request - worth seeing what the game does
    with it rather than assuming.

    Usage: node tools/oracle/probe-copy-settings-cross-type.mjs
*/
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const BIN =
    process.env.FACTORIO_BIN ??
    `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`

const MOD = 'bp_copy_cross'
const DUMP = 'copy-cross-dump.json'

const work = mkdtempSync(join(tmpdir(), 'fbe-oracle-'))
const writeData = join(work, 'write-data')
const modDir = join(work, 'mods')
const modPath = join(modDir, `${MOD}_0.0.1`)
mkdirSync(writeData, { recursive: true })
mkdirSync(modPath, { recursive: true })

writeFileSync(
    join(modPath, 'info.json'),
    JSON.stringify({
        name: MOD,
        version: '0.0.1',
        title: 'Cross-type copy_settings',
        author: 'oracle',
        factorio_version: '2.1',
        dependencies: ['base'],
    })
)

writeFileSync(
    join(modPath, 'control.lua'),
    `
local function try(case, label, fn)
  local ok, err = pcall(fn)
  if not ok then case.errors[#case.errors + 1] = label .. ": " .. tostring(err) end
  return ok
end

script.on_init(function()
  local surface = game.surfaces[1]
  local force = game.forces.player
  local out = {}

  surface.request_to_generate_chunks({0, 0}, 4)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -20, 90 do
    for y = -20, 60 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end
  end
  surface.set_tiles(tiles)
  for _, e in pairs(surface.find_entities_filtered{area = {{-20, -20}, {90, 60}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end

  for x = -16, 80, 2 do
    pcall(function()
      surface.create_entity{name = "straight-rail", position = {x, 40}, direction = defines.direction.east, force = force}
    end)
  end

  local inv = game.create_inventory(1)
  local function capture(area)
    inv[1].set_stack{name = "blueprint"}
    inv[1].create_blueprint{surface = surface, force = force, area = area,
                            include_trains = true, include_station_names = true, include_fuel = false}
    return inv[1].get_blueprint_entities()
  end

  local CASES = {
    {
      label = "assembling-machine-2 (electronic-circuit) -> requester-chest",
      src = {name = "assembling-machine-2", position = {2, 2}, recipe = "electronic-circuit"},
      dst = {name = "requester-chest", position = {8, 2}},
      area = {{0, 0}, {12, 6}},
    },
    {
      label = "assembling-machine-2 (processing-unit) -> requester-chest",
      src = {name = "assembling-machine-2", position = {18, 2}, recipe = "processing-unit"},
      dst = {name = "requester-chest", position = {24, 2}},
      area = {{16, 0}, {28, 6}},
    },
    {
      label = "assembling-machine-3 (processing-unit) -> requester-chest (faster machine)",
      src = {name = "assembling-machine-3", position = {34, 2}, recipe = "processing-unit"},
      dst = {name = "requester-chest", position = {40, 2}},
      area = {{32, 0}, {44, 6}},
    },
    {
      label = "assembling-machine-2 (electronic-circuit) -> fast-inserter",
      src = {name = "assembling-machine-2", position = {2, 12}, recipe = "electronic-circuit"},
      dst = {name = "fast-inserter", position = {8, 12}},
      area = {{0, 10}, {12, 16}},
    },
    {
      label = "assembling-machine-2 (electronic-circuit) -> steel-chest (plain container)",
      src = {name = "assembling-machine-2", position = {18, 12}, recipe = "electronic-circuit"},
      dst = {name = "steel-chest", position = {24, 12}},
      area = {{16, 10}, {28, 16}},
    },
    {
      label = "train-stop -> locomotive",
      src = {name = "train-stop", position = {2, 41}, color = {r = 0.9, g = 0.1, b = 0.1, a = 0.5}, station = "Iron Pickup"},
      dst = {name = "locomotive", position = {12, 41}},
      area = {{-2, 36}, {22, 45}},
    },
    {
      label = "locomotive -> train-stop",
      src = {name = "locomotive", position = {30, 41}, color = {r = 0.1, g = 0.2, b = 0.9, a = 0.5}},
      dst = {name = "train-stop", position = {44, 41}},
      area = {{26, 36}, {50, 45}},
    },
    {
      label = "requester-chest -> requester-chest (control: a pair known to copy)",
      src = {name = "requester-chest", position = {2, 20}, request = true},
      dst = {name = "requester-chest", position = {8, 20}},
      area = {{0, 18}, {12, 24}},
    },
    -- A third crafting speed, to tell a rule from a coincidence. AM1 is 0.5
    -- where AM2 is 0.75 and AM3 is 1.25.
    {
      label = "assembling-machine-1 (electronic-circuit) -> requester-chest",
      src = {name = "assembling-machine-1", position = {18, 20}, recipe = "electronic-circuit"},
      dst = {name = "requester-chest", position = {24, 20}},
      area = {{16, 18}, {28, 24}},
    },
    -- Does the machine's actual speed count, or its prototype's? The editor
    -- knows an entity's modules, so this decides whether it has to.
    {
      label = "assembling-machine-2 + 2 speed modules (electronic-circuit) -> requester-chest",
      src = {name = "assembling-machine-2", position = {34, 20}, recipe = "electronic-circuit", modules = "speed-module"},
      dst = {name = "requester-chest", position = {40, 20}},
      area = {{32, 18}, {44, 24}},
    },
    {
      label = "assembling-machine-2 (electronic-circuit) -> buffer-chest",
      src = {name = "assembling-machine-2", position = {50, 20}, recipe = "electronic-circuit"},
      dst = {name = "buffer-chest", position = {56, 20}},
      area = {{48, 18}, {60, 24}},
    },
    -- A source with no recipe onto a chest that already holds requests: does the
    -- game clear them or leave them alone?
    {
      label = "assembling-machine-2 (no recipe) -> requester-chest holding requests",
      src = {name = "assembling-machine-2", position = {66, 20}},
      dst = {name = "requester-chest", position = {72, 20}, request = true},
      area = {{64, 18}, {76, 24}},
    },
  }

  for _, c in ipairs(CASES) do
    local case = {label = c.label, errors = {}}
    local src, dst

    try(case, "create source", function()
      src = surface.create_entity{name = c.src.name, position = c.src.position, force = force}
      if not src then error("create_entity returned nil") end
      if c.src.recipe then src.set_recipe(c.src.recipe) end
      if c.src.color then src.color = c.src.color end
      if c.src.station then src.backer_name = c.src.station end
      if c.src.modules then
        local mi = src.get_module_inventory()
        mi.insert{name = c.src.modules, count = 2}
      end
      if c.src.request then
        local s = src.get_logistic_sections()
        s.add_section()
        s.sections[1].set_slot(1, {value = {type = "item", name = "iron-plate", quality = "normal"}, min = 100})
      end
    end)

    try(case, "create target", function()
      dst = surface.create_entity{name = c.dst.name, position = c.dst.position, force = force}
      if not dst then error("create_entity returned nil") end
      if c.dst.request then
        local s = dst.get_logistic_sections()
        s.add_section()
        s.sections[1].set_slot(1, {value = {type = "item", name = "stone", quality = "normal"}, min = 77})
      end
    end)

    if src and dst then
      try(case, "copy_settings", function()
        local returned = dst.copy_settings(src)
        case.returned = returned and helpers.table_to_json(returned) or "nil"
      end)
    end

    try(case, "capture", function() case.entities = capture(c.area) end)
    out[#out + 1] = case
  end

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

writeFileSync(
    join(work, 'config.ini'),
    `[path]\nread-data=__PATH__executable__/../data\nwrite-data=${writeData}\n[general]\n[other]\n`
)

const res = spawnSync(
    BIN,
    [
        '--create',
        join(work, 'p.zip'),
        '--mod-directory',
        modDir,
        '--config',
        join(work, 'config.ini'),
    ],
    { encoding: 'utf8' }
)

const dumpPath = join(writeData, 'script-output', DUMP)
if (!existsSync(dumpPath)) {
    console.error(
        'No dump. Factorio tail:\n' + ((res.stdout ?? '') + (res.stderr ?? '')).slice(-4000)
    )
    process.exit(1)
}

const SKIP = new Set(['entity_number', 'name', 'position', 'direction', 'orientation'])
const rows = JSON.parse(readFileSync(dumpPath, 'utf8'))
for (const r of rows) {
    console.log(`\n=== ${r.label}`)
    for (const e of Object.values(r.errors ?? {})) console.log(`    ! ${e}`)
    if (r.returned) console.log(`    copy_settings returned: ${r.returned}`)
    for (const e of Object.values(r.entities ?? {})) {
        if (e.name === 'straight-rail') continue
        const settings = Object.fromEntries(Object.entries(e).filter(([k]) => !SKIP.has(k)))
        console.log(`    ${e.name}: ${JSON.stringify(settings)}`)
    }
}

const raw = join(work, 'cross-rows.json')
writeFileSync(raw, JSON.stringify(rows, null, 2))
console.log(`\nraw: ${raw}`)
