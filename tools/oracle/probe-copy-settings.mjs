/*
    What does Factorio's own settings copy actually carry?

    Issue #94 is a 2019-era TODO in `Entity.pasteSettings` listing eight things
    the editor does not copy - train stop colour and name, locomotive colour and
    schedule, speaker parameters, a rocket silo flag, container and wagon bar and
    filters, and two cross-type assembling-machine cases. Rather than implement
    from the list, ask the game: place a configured source and a blank target,
    call `LuaEntity.copy_settings(source)` - which is the same operation
    shift+RMB / shift+LMB performs - and blueprint the pair afterwards.

    Blueprinting the result rather than reading runtime fields is deliberate: the
    editor works in the blueprint format, so what shows up in the target's
    BlueprintEntity is exactly what `pasteSettings` has to reproduce.

    Every step is wrapped, and each case reports its own errors, because one
    renamed field (2.0 dropped `auto_launch`, for instance) would otherwise take
    the whole run down and look like the probe failing rather than a finding.

    Usage: node tools/oracle/probe-copy-settings.mjs
*/
import { writeFileSync, readFileSync } from 'node:fs'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'
import { join } from 'node:path'

const BIN = factorioBin

const MOD = 'bp_copy_settings'
const DUMP = 'copy-settings-dump.json'

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'What copy_settings carries',
    author: 'oracle',
    factorio_version: '2.1',
    dependencies: ['base'],
})

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {}

-- Every probe step runs through this, so a renamed field is a recorded finding
-- rather than a dead run.
local function try(case, label, fn)
  local ok, err = pcall(fn)
  if not ok then
    case.errors[#case.errors + 1] = label .. ": " .. tostring(err)
  end
  return ok
end

script.on_init(function()
  local surface = game.surfaces[1]
  local force = game.forces.player

  -- Flat, empty ground to build on: generate the chunks, lay grass over the
  -- working area, and clear whatever the map generator put there.
  surface.request_to_generate_chunks({0, 0}, 4)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -20, 80 do
    for y = -20, 60 do
      tiles[#tiles + 1] = {name = "grass-1", position = {x, y}}
    end
  end
  surface.set_tiles(tiles)
  for _, e in pairs(surface.find_entities_filtered{area = {{-20, -20}, {80, 60}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end

  local inv = game.create_inventory(1)
  local function capture(area)
    inv[1].set_stack{name = "blueprint"}
    inv[1].create_blueprint{surface = surface, force = force, area = area, include_trains = true, include_station_names = true, include_fuel = false}
    return inv[1].get_blueprint_entities()
  end

  -- Rails, so locomotives and wagons can exist at all.
  for x = -16, 60, 2 do
    pcall(function()
      surface.create_entity{name = "straight-rail", position = {x, 40}, direction = defines.direction.east, force = force}
    end)
  end

  local CASES = {
    {
      label = "train-stop -> train-stop",
      name = "train-stop", srcPos = {2, 41}, dstPos = {10, 41}, area = {{-2, 36}, {16, 46}},
      configure = function(e)
        e.backer_name = "Iron Pickup"
        e.color = {r = 0.9, g = 0.1, b = 0.1, a = 0.5}
        e.trains_limit = 3
      end,
    },
    {
      label = "locomotive -> locomotive",
      name = "locomotive", srcPos = {20, 41}, dstPos = {32, 41}, area = {{16, 36}, {40, 44}},
      configure = function(e)
        e.color = {r = 0.1, g = 0.2, b = 0.9, a = 0.5}
      end,
    },
    {
      label = "cargo-wagon -> cargo-wagon",
      name = "cargo-wagon", srcPos = {44, 41}, dstPos = {56, 41}, area = {{40, 36}, {64, 44}},
      configure = function(e)
        local i = e.get_inventory(defines.inventory.cargo_wagon)
        i.set_bar(11)
        i.set_filter(1, "iron-plate")
        i.set_filter(2, "copper-plate")
      end,
    },
    {
      label = "steel-chest -> steel-chest (bar)",
      name = "steel-chest", srcPos = {2, 2}, dstPos = {6, 2}, area = {{0, 0}, {10, 6}},
      configure = function(e)
        e.get_inventory(defines.inventory.chest).set_bar(5)
      end,
    },
    {
      label = "programmable-speaker -> programmable-speaker",
      name = "programmable-speaker", srcPos = {14, 2}, dstPos = {18, 2}, area = {{12, 0}, {22, 6}},
      configure = function(e)
        e.parameters = {playback_volume = 0.8, playback_mode = "global", allow_polyphony = true}
        e.alert_parameters = {
          show_alert = true,
          show_on_map = true,
          icon_signal_id = {type = "item", name = "iron-plate"},
          alert_message = "Probe alert",
        }
      end,
    },
    {
      label = "rocket-silo -> rocket-silo",
      name = "rocket-silo", srcPos = {30, 8}, dstPos = {46, 8}, area = {{22, 0}, {56, 18}},
      srcExtra = {launch_to_orbit_automatically = true, use_transitional_requests = true},
      configure = function(e) end,
    },
    {
      label = "requester-chest -> requester-chest (control)",
      name = "requester-chest", srcPos = {2, 14}, dstPos = {6, 14}, area = {{0, 12}, {10, 18}},
      configure = function(e)
        local s = e.get_logistic_sections()
        s.add_section()
        s.sections[1].set_slot(1, {value = {type = "item", name = "iron-plate", quality = "normal"}, min = 100})
      end,
    },
  }

  for _, c in ipairs(CASES) do
    local case = {label = c.label, errors = {}}
    local src, dst

    try(case, "create source", function()
      local args = {name = c.name, position = c.srcPos, force = force}
      -- Some settings are create-time only: 2.0 turned the rocket silo's
      -- auto_launch into launch_to_orbit_automatically, a create_entity
      -- parameter with no LuaEntity property to assign afterwards.
      if c.srcExtra then
        for k, v in pairs(c.srcExtra) do args[k] = v end
      end
      src = surface.create_entity(args)
      if not src then error("create_entity returned nil") end
    end)
    try(case, "create target", function()
      dst = surface.create_entity{name = c.name, position = c.dstPos, force = force}
      if not dst then error("create_entity returned nil") end
    end)
    if src then try(case, "configure source", function() c.configure(src) end) end

    if src and dst then
      try(case, "copy_settings", function() dst.copy_settings(src) end)
    end

    try(case, "capture", function()
      case.entities = capture(c.area)
    end)

    out[#out + 1] = case
  end

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const { dumpPath } = runProbe({ bin: BIN, work, writeData, modDir, dump: DUMP })

/** Fields that are position/name plumbing rather than a copied setting. */
const SKIP = new Set(['entity_number', 'name', 'position', 'direction', 'orientation'])

const rows = JSON.parse(readFileSync(dumpPath, 'utf8'))
for (const r of rows) {
    console.log(`\n=== ${r.label}`)
    for (const e of Object.values(r.errors ?? {})) console.log(`    ! ${e}`)
    const ents = Object.values(r.entities ?? {})
    if (ents.length === 0) console.log('    (no entities captured)')
    for (const e of ents) {
        const settings = Object.fromEntries(Object.entries(e).filter(([k]) => !SKIP.has(k)))
        const at = `${e.position?.x ?? '?'},${e.position?.y ?? '?'}`
        console.log(`    ${e.name} @ ${at}: ${JSON.stringify(settings)}`)
    }
}

const raw = join(work, 'copy-settings-rows.json')
writeFileSync(raw, JSON.stringify(rows, null, 2))
console.log(`\nraw: ${raw}`)
