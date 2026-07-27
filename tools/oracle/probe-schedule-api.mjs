/*
    Phase A of the locomotive-schedule question (issue #115): what is the 2.0
    schedule API actually called?

    1.1 had `LuaTrain.schedule`, a plain table of `{station, wait_conditions}`
    records. 2.0 added interrupts and schedule groups and moved the whole thing
    behind `LuaTrain.get_schedule()`. Guessing between the two costs a full run
    each time, and a wrong guess inside the real probe reads as "copy_settings
    does not carry a schedule" rather than as a broken call.

    So this asks the game for its own method list - `help()` on every object
    involved - and writes it out. Nothing here measures behaviour; it exists so
    probe-copy-settings-schedule.mjs can be written against the real API.

    Usage: node tools/oracle/probe-schedule-api.mjs
*/
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const BIN =
    process.env.FACTORIO_BIN ??
    `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`

const MOD = 'bp_schedule_api'
const DUMP = 'schedule-api-dump.json'

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
        title: 'What the schedule API is called',
        author: 'oracle',
        factorio_version: '2.1',
        dependencies: ['base'],
    })
)

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {errors = {}}

local function try(label, fn)
  local ok, err = pcall(fn)
  if not ok then out.errors[#out.errors + 1] = label .. ": " .. tostring(err) end
  return ok
end

script.on_init(function()
  local surface = game.surfaces[1]
  local force = game.forces.player

  surface.request_to_generate_chunks({0, 0}, 4)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -20, 40 do
    for y = -10, 10 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end
  end
  surface.set_tiles(tiles)
  for _, e in pairs(surface.find_entities_filtered{area = {{-20, -10}, {40, 10}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end

  for x = -16, 30, 2 do
    pcall(function()
      surface.create_entity{name = "straight-rail", position = {x, 0}, direction = defines.direction.east, force = force}
    end)
  end

  local loco
  try("create locomotive", function()
    loco = surface.create_entity{name = "locomotive", position = {0, 0}, force = force}
    if not loco then error("create_entity returned nil") end
  end)

  try("LuaEntity.help", function() out.entity_help = loco.help() end)
  try("LuaTrain.help", function() out.train_help = loco.train.help() end)
  try("LuaTrain.get_schedule", function()
    local s = loco.train.get_schedule()
    out.schedule_type = type(s)
    out.schedule_help = s.help()
  end)
  -- The 1.1 property, to record whether it still exists at all.
  try("LuaTrain.schedule (1.1 property)", function()
    out.legacy_schedule = loco.train.schedule
    out.legacy_schedule_type = type(loco.train.schedule)
  end)

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

const d = JSON.parse(readFileSync(dumpPath, 'utf8'))
for (const e of Object.values(d.errors ?? {})) console.log(`! ${e}`)
console.log(`\n=== LuaTrain.get_schedule() type: ${d.schedule_type ?? '(unavailable)'}`)
console.log(`=== LuaTrain.schedule (1.1) type: ${d.legacy_schedule_type ?? '(unavailable)'}`)
console.log(`\n=== LuaSchedule methods ===\n${d.schedule_help ?? '(none)'}`)
console.log(`\n=== LuaTrain methods ===\n${d.train_help ?? '(none)'}`)

const raw = join(work, 'schedule-api.json')
writeFileSync(raw, JSON.stringify(d, null, 2))
console.log(`\nraw: ${raw}`)
