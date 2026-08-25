/*
    Does Factorio's settings copy carry a locomotive's schedule, and what shape
    does it land in? Issue #115, the last item split out of #94.

    The other #94 pairs were field copies on one entity. A schedule is not: it
    lives on the *blueprint*, as a top-level `schedules` array of
    `{locomotives: number[], schedule: ...}`, and 2.0 added interrupts and
    schedule groups to what used to be a flat list of `{station, wait_conditions}`
    records. So there are two questions, and the second only matters if the first
    is yes:

      1. does `LuaEntity.copy_settings` carry a schedule between locomotives?
      2. what does the copied schedule look like in the *blueprint* - which is
         the only form this editor deals in?

    (1) is read from runtime state, (2) from an exported blueprint string decoded
    on this side. Reading both matters: a schedule the game copies at runtime but
    does not blueprint is not something `pasteSettings` can reproduce, and the
    two answers could disagree.

    The API was not guessed. `LuaTrain.schedule`, the 1.1 property, is **nil** in
    2.1 - measured by probe-schedule-api.mjs - and the method list here comes from
    `doc-html/runtime-api.json`, which the install ships.

    Controls, because this probe can lie in three separate ways:

      - "no copy at all" is the load-bearing one. Both locomotives exist and are
        blueprinted together, and `copy_settings` is never called. If the target
        still shows the schedule then this is measuring how `create_blueprint`
        groups trains, not what a copy carries.
      - "target already had a schedule" separates overwrite from merge, which a
        blank target cannot.
      - "source has no schedule" asks whether a copy *clears* the target - the
        case an implementation is most likely to get wrong by only ever writing.

    Each case gets its own pair of disconnected rail segments. Two locomotives on
    one segment are one train and share a schedule automatically, which would
    look exactly like a successful copy.

    Usage: node tools/oracle/probe-copy-settings-schedule.mjs
*/
import { writeFileSync, readFileSync } from 'node:fs'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const BIN = factorioBin

const MOD = 'bp_copy_schedule'
const DUMP = 'copy-schedule-dump.json'

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'Does copy_settings carry a locomotive schedule',
    author: 'oracle',
    factorio_version: '2.1',
    dependencies: ['base'],
})

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {}

local function try(case, label, fn)
  local ok, err = pcall(fn)
  if not ok then case.errors[#case.errors + 1] = label .. ": " .. tostring(err) end
  return ok
end

-- ScheduleRecord carries a LuaEntity in \`rail\`, which table_to_json cannot
-- take. Keep the fields that describe the schedule and drop the references.
local function cleanRecord(r)
  local wc = {}
  for i, c in ipairs(r.wait_conditions or {}) do
    wc[i] = {type = c.type, compare_type = c.compare_type, ticks = c.ticks}
  end
  return {
    station = r.station,
    temporary = r.temporary,
    allows_unloading = r.allows_unloading,
    created_by_interrupt = r.created_by_interrupt,
    has_rail = r.rail ~= nil,
    wait_conditions = wc,
  }
end

local function cleanRecords(list)
  local o = {}
  for i, r in ipairs(list or {}) do o[i] = cleanRecord(r) end
  return o
end

local function cleanInterrupts(list)
  local o = {}
  for i, it in ipairs(list or {}) do
    local conds = {}
    for j, c in ipairs(it.conditions or {}) do
      conds[j] = {type = c.type, compare_type = c.compare_type, ticks = c.ticks}
    end
    o[i] = {
      name = it.name,
      inside_interrupt = it.inside_interrupt,
      conditions = conds,
      targets = cleanRecords(it.targets),
    }
  end
  return o
end

-- What a locomotive's train says about itself, at runtime.
local function readSchedule(case, label, loco)
  local o = {}
  try(case, label, function()
    local s = loco.train.get_schedule()
    o.group = s.group
    o.record_count = s.get_record_count()
    o.interrupt_count = s.interrupt_count
    o.records = cleanRecords(s.get_records())
    o.interrupts = cleanInterrupts(s.get_interrupts())
  end)
  return o
end

script.on_init(function()
  local surface = game.surfaces[1]
  local force = game.forces.player

  surface.request_to_generate_chunks({0, 0}, 6)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -30, 40 do
    for y = -10, 100 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end
  end
  surface.set_tiles(tiles)
  for _, e in pairs(surface.find_entities_filtered{area = {{-30, -10}, {40, 100}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end

  local inv = game.create_inventory(1)
  local function capture(area)
    inv[1].set_stack{name = "blueprint"}
    inv[1].create_blueprint{
      surface = surface, force = force, area = area,
      include_trains = true, include_station_names = true, include_fuel = false,
    }
    return inv[1].export_stack()
  end

  -- One pair of disconnected segments per case: source at y, target at y + 10.
  local function layRails(y)
    for x = -24, 24, 2 do
      pcall(function()
        surface.create_entity{name = "straight-rail", position = {x, y}, direction = defines.direction.east, force = force}
      end)
    end
  end

  local SRC_SCHEDULE = {
    group = "Ore Run",
    records = {
      {station = "Alpha", wait_conditions = {{type = "time", compare_type = "and", ticks = 600}}},
      {station = "Beta", wait_conditions = {{type = "full", compare_type = "and"}}},
    },
    interrupts = {
      {
        name = "Refuel",
        inside_interrupt = false,
        conditions = {{type = "passenger_not_present", compare_type = "and"}},
        targets = {{station = "Depot", wait_conditions = {{type = "inactivity", compare_type = "and", ticks = 300}}}},
      },
    },
  }

  local OTHER_SCHEDULE = {
    group = "",
    records = {{station = "Gamma", wait_conditions = {{type = "empty", compare_type = "and"}}}},
    interrupts = {},
  }

  local function applySchedule(loco, spec)
    local s = loco.train.get_schedule()
    s.set_records(spec.records)
    if #spec.interrupts > 0 then s.set_interrupts(spec.interrupts) end
    if spec.group and spec.group ~= "" then s.group = spec.group end
  end

  local CASES = {
    {
      label = "loco -> loco, source has a schedule, target blank",
      srcSpec = SRC_SCHEDULE, dstSpec = nil, doCopy = true,
    },
    {
      label = "CONTROL no copy_settings called at all",
      srcSpec = SRC_SCHEDULE, dstSpec = nil, doCopy = false,
    },
    {
      label = "CONTROL target already had a different schedule",
      srcSpec = SRC_SCHEDULE, dstSpec = OTHER_SCHEDULE, doCopy = true,
    },
    {
      label = "CONTROL source has no schedule, target does",
      srcSpec = nil, dstSpec = OTHER_SCHEDULE, doCopy = true,
    },
  }

  -- Stations the records name. A record referencing a stop that does not exist
  -- is legal, but blueprinting one is not what a real base looks like.
  for i, nm in ipairs({"Alpha", "Beta", "Depot", "Gamma"}) do
    pcall(function()
      surface.create_entity{
        name = "train-stop", position = {-28 + (i - 1) * 2, 92}, force = force,
        direction = defines.direction.east,
      }.backer_name = nm
    end)
  end

  for i, c in ipairs(CASES) do
    local case = {label = c.label, errors = {}}
    local y = (i - 1) * 20
    local src, dst

    try(case, "lay rails", function() layRails(y); layRails(y + 10) end)
    try(case, "create source", function()
      src = surface.create_entity{name = "locomotive", position = {0, y}, force = force}
      if not src then error("create_entity returned nil") end
    end)
    try(case, "create target", function()
      dst = surface.create_entity{name = "locomotive", position = {0, y + 10}, force = force}
      if not dst then error("create_entity returned nil") end
    end)

    if src and c.srcSpec then try(case, "configure source", function() applySchedule(src, c.srcSpec) end) end
    if dst and c.dstSpec then try(case, "configure target", function() applySchedule(dst, c.dstSpec) end) end

    -- Separate trains, or the whole measurement is void.
    try(case, "trains differ", function()
      case.same_train = src.train.id == dst.train.id
    end)

    case.src_before = readSchedule(case, "read source", src)
    case.dst_before = readSchedule(case, "read target before", dst)

    if c.doCopy and src and dst then
      try(case, "copy_settings", function() dst.copy_settings(src) end)
    end
    case.copied = c.doCopy

    case.dst_after = readSchedule(case, "read target after", dst)

    try(case, "capture", function()
      case.bp = capture({{-26, y - 4}, {26, y + 14}})
    end)

    out[#out + 1] = case
  end

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const { dumpPath } = runProbe({ bin: BIN, work, writeData, modDir, dump: DUMP })

/** The editor's own decode, minus the validation: version byte, base64, inflate. */
const decode = str => {
    if (typeof str !== 'string' || str.length < 2) return undefined
    try {
        return JSON.parse(inflateSync(Buffer.from(str.slice(1), 'base64')).toString('utf8'))
    } catch (e) {
        return { decodeError: String(e) }
    }
}

const summarise = s =>
    s === undefined
        ? '(unread)'
        : `group=${JSON.stringify(s.group)} records=${s.record_count ?? 0} interrupts=${
              s.interrupt_count ?? 0
          } ${JSON.stringify(Object.values(s.records ?? {}).map(r => r.station))}`

const rows = Object.values(JSON.parse(readFileSync(dumpPath, 'utf8')))
const out = []
for (const r of rows) {
    console.log(`\n=== ${r.label}`)
    for (const e of Object.values(r.errors ?? {})) console.log(`    ! ${e}`)
    console.log(`    same train (must be false):  ${r.same_train}`)
    console.log(`    copy_settings called:        ${r.copied}`)
    console.log(`    source:                      ${summarise(r.src_before)}`)
    console.log(`    target before:               ${summarise(r.dst_before)}`)
    console.log(`    target after:                ${summarise(r.dst_after)}`)

    const bp = decode(r.bp)?.blueprint
    const schedules = bp?.schedules
    console.log(`    blueprint schedules:         ${JSON.stringify(schedules ?? null)}`)
    out.push({ ...r, bp: undefined, blueprint: bp })
}

const raw = join(work, 'copy-schedule-rows.json')
writeFileSync(raw, JSON.stringify(out, null, 2))
console.log(`\nraw (decoded blueprints included): ${raw}`)
