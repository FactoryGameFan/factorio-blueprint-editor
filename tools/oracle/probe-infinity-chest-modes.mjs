/*
    How a 2.1 blueprint stores an infinity chest's logistic mode (#611).

    Factorio 2.1.0 "Added logistic mode selector to infinity containers", and
    the 2.1 data drops the chest's `max_logistic_slots` of 1, which it had only
    inherited from the storage chest it copies. This asks the game two things:

    1. Export. One chest per case, created by the API, given one infinity
       filter so the export shows `infinity_settings` beside the logistic
       fields, set to a mode, then asked for requests in two sections,
       `trash_not_requested`, `request_from_buffers` and a storage filter. The
       probe records which of those writes the game refuses, blueprints the
       chest on its own, and re-imports the game's own string as a control.
       Two more cases switch a requester away and back, and clear the mode.
    2. Import. Strings an editor might write, one per blueprint so each
       `import_stack` code is attributable: requests with no mode, an explicit
       "none", an unknown mode, requests on a provider, `saved_*` fields alone,
       a 2.0-declared string, and 1000 against 1001 filters in one section.
       The 1000 case is the control for the 1001 one: both repeat two items,
       and the game merges repeats, so it reads back 2 filters. The refusal
       of 1001 is therefore the count, not the repeats.

    Two instrument controls run on ordinary chests: a requester with
    `trash_not_requested` and a storage chest with a filter. They show the
    probe can see those keys at all, so a key missing from the infinity chest
    is the game's answer, not a blind spot.

    Usage: FACTORIO_BIN=... node tools/oracle/probe-infinity-chest-modes.mjs [--write-fixture]
*/
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'

const BIN = factorioBin
const MOD = 'bp_infinity_chest_modes'
const DUMP = 'infinity-chest-modes-dump.json'
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/infinity-chest-modes.json')

const versionLine = (spawnSync(BIN, ['--version'], { encoding: 'utf8' }).stdout ?? '')
    .split('\n')[0]
    .trim()
const v = (versionLine.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number)
if (v.length !== 3) {
    console.error(`Could not read a version out of ${BIN}: ${JSON.stringify(versionLine)}`)
    process.exit(1)
}
// Derived, not hardcoded: a mod declaring another major.minor is skipped in silence.
const MOD_FACTORIO_VERSION = `${v[0]}.${v[1]}`
const pack = (a, b, c) => a * 2 ** 48 + b * 2 ** 32 + c * 2 ** 16
const V_OWN = pack(...v)
const V_20 = pack(2, 0, 76)

const encode = blueprint =>
    `0${deflateSync(Buffer.from(JSON.stringify({ blueprint }))).toString('base64')}`
const decode = s => JSON.parse(inflateSync(Buffer.from(s.slice(1), 'base64')).toString('utf8'))

const INFINITY = {
    remove_unfiltered_items: false,
    filters: [{ name: 'iron-ore', count: 50, mode: 'at-least', index: 1 }],
}
const request = (index, name, count) => ({ index, name, quality: 'normal', comparator: '=', count })
const REQUESTS = { sections: [{ index: 1, filters: [request(1, 'iron-plate', 10)] }] }
const chest = extra => ({
    entity_number: 1,
    name: 'infinity-chest',
    position: { x: 0.5, y: 0.5 },
    infinity_settings: INFINITY,
    ...extra,
})
const repeated = n =>
    Array.from({ length: n }, (_, i) =>
        request(i + 1, i % 2 ? 'iron-plate' : 'copper-plate', i + 1)
    )

/** @type {Array<[string, number, object]>} */
const IMPORT_CASES = [
    ['2.0, corpus shape', V_20, {}],
    ['2.0, requests and no mode', V_20, { request_filters: REQUESTS }],
    [
        '2.0, requester mode',
        V_20,
        { override_logistic_mode: 'requester', request_filters: REQUESTS },
    ],
    ['requests and no mode', V_OWN, { request_filters: REQUESTS }],
    ['requester', V_OWN, { override_logistic_mode: 'requester', request_filters: REQUESTS }],
    [
        'requester, two sections',
        V_OWN,
        {
            override_logistic_mode: 'requester',
            request_filters: {
                sections: [REQUESTS.sections[0], { index: 2, filters: [request(1, 'coal', 3)] }],
            },
        },
    ],
    [
        'requester, trash_not_requested',
        V_OWN,
        {
            override_logistic_mode: 'requester',
            request_filters: { ...REQUESTS, trash_not_requested: true },
        },
    ],
    [
        'buffer, request_from_buffers',
        V_OWN,
        {
            override_logistic_mode: 'buffer',
            request_filters: { ...REQUESTS, request_from_buffers: true },
        },
    ],
    [
        'storage, one filter',
        V_OWN,
        {
            override_logistic_mode: 'storage',
            request_filters: { sections: [{ index: 1, filters: [request(1, 'iron-plate', 0)] }] },
        },
    ],
    [
        'passive-provider with requests',
        V_OWN,
        { override_logistic_mode: 'passive-provider', request_filters: REQUESTS },
    ],
    ['explicit none', V_OWN, { override_logistic_mode: 'none' }],
    ['unknown mode', V_OWN, { override_logistic_mode: 'bogus' }],
    [
        'saved fields only',
        V_OWN,
        { saved_request_filters: REQUESTS, saved_request_from_buffers: true },
    ],
    [
        'requester, 1000 filters',
        V_OWN,
        {
            override_logistic_mode: 'requester',
            request_filters: { sections: [{ index: 1, filters: repeated(1000) }] },
        },
    ],
    [
        'requester, 1001 filters',
        V_OWN,
        {
            override_logistic_mode: 'requester',
            request_filters: { sections: [{ index: 1, filters: repeated(1001) }] },
        },
    ],
]
const IMPORTS = IMPORT_CASES.map(([label, version, extra]) => ({
    label,
    large: /\d{4} filters/.test(label),
    bp: encode({ item: 'blueprint', version, entities: [chest(extra)] }),
}))

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'Infinity chest logistic modes',
    author: 'oracle',
    factorio_version: MOD_FACTORIO_VERSION,
    dependencies: ['base'],
})

writeFileSync(
    join(modPath, 'control.lua'),
    `
local IMPORTS = {
${IMPORTS.map(c => `  {label = [==[${c.label}]==], large = ${c.large}, bp = [==[${c.bp}]==]},`).join('\n')}
}

local out = {modes = {}, exports = {}, imports = {}, controls = {}}
local surface, force, inv
local slot = 0

local function try(rec, label, fn)
  local ok, err = pcall(fn)
  rec.writes = rec.writes or {}
  rec.writes[label] = ok and "ok" or ("ERR: " .. tostring(err))
end

local function mode_name(v)
  if v == nil then return nil end
  for k, n in pairs(defines.logistic_mode) do if n == v then return k end end
  return tostring(v)
end

local function section_count(e)
  local ok, s = pcall(function() return e.get_logistic_sections() end)
  if not ok or not s then return nil end
  return s.sections_count
end

local function new_chest()
  slot = slot + 1
  local e = surface.create_entity{name = "infinity-chest", position = {slot * 3 + 0.5, 0.5}, force = force}
  e.set_infinity_container_filter(1, {name = "iron-ore", count = 50, mode = "at-least"})
  return e
end

local function blueprint(e, rec)
  local x, y = e.position.x, e.position.y
  inv[1].set_stack{name = "blueprint"}
  inv[1].create_blueprint{surface = surface, force = force, area = {{x - 0.4, y - 0.4}, {x + 0.4, y + 0.4}}}
  rec.exported = inv[1].export_stack()
  -- control: the game's own string must come back in
  inv[1].set_stack{name = "blueprint"}
  rec.reimport_code = inv[1].import_stack(rec.exported)
end

local function fill(e, rec)
  try(rec, "requests", function()
    local s = e.get_logistic_sections()
    if not s then error("get_logistic_sections returned nil") end
    local a = s.sections_count > 0 and s.get_section(1) or s.add_section()
    a.set_slot(1, {value = {type = "item", name = "iron-plate", quality = "normal"}, min = 10})
    a.set_slot(2, {value = {type = "item", name = "copper-plate", quality = "normal"}, min = 5, max = 100})
    local b = s.add_section()
    if not b then error("second add_section returned nil") end
    b.set_slot(1, {value = {type = "item", name = "coal", quality = "normal"}, min = 3})
  end)
  try(rec, "trash_not_requested", function()
    local p = e.get_requester_point()
    if not p then error("no requester point") end
    p.trash_not_requested = true
  end)
  try(rec, "request_from_buffers", function() e.request_from_buffers = true end)
  try(rec, "storage_filter", function() e.storage_filter = "iron-plate" end)
end

script.on_init(function()
  surface = game.surfaces[1]
  force = game.forces.player
  surface.request_to_generate_chunks({0, 0}, 3)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -5, 80 do for y = -5, 15 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end end
  surface.set_tiles(tiles)
  for _, e in pairs(surface.find_entities_filtered{area = {{-5, -5}, {80, 15}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end
  inv = game.create_inventory(1)

  for k, n in pairs(defines.logistic_mode) do out.modes[k] = n end
  out.prototype_logistic_mode = prototypes.entity["infinity-chest"].logistic_mode

  -- 1. export
  do
    local rec = {label = "left alone"}
    local e = new_chest()
    blueprint(e, rec)
    out.exports[#out.exports + 1] = rec
  end
  do
    local rec = {label = "no mode, settings attempted"}
    local e = new_chest()
    fill(e, rec)
    blueprint(e, rec)
    out.exports[#out.exports + 1] = rec
  end
  for _, m in ipairs({"none", "active_provider", "passive_provider", "storage", "requester", "buffer"}) do
    local rec = {label = "mode " .. m}
    local e = new_chest()
    try(rec, "set_mode", function() e.override_logistic_mode = defines.logistic_mode[m] end)
    fill(e, rec)
    rec.mode_read_back = mode_name(e.override_logistic_mode)
    rec.sections_count = section_count(e)
    blueprint(e, rec)
    out.exports[#out.exports + 1] = rec
  end
  do
    local rec = {label = "requester, slot cap"}
    local e = new_chest()
    e.override_logistic_mode = defines.logistic_mode.requester
    local a = e.get_logistic_sections().add_section()
    try(rec, "slot 1000", function() a.set_slot(1000, {value = {type = "item", name = "iron-plate", quality = "normal"}, min = 1}) end)
    try(rec, "slot 1001", function() a.set_slot(1001, {value = {type = "item", name = "copper-plate", quality = "normal"}, min = 1}) end)
    out.exports[#out.exports + 1] = rec
  end
  do
    local rec = {label = "requester switched to passive_provider"}
    local e = new_chest()
    e.override_logistic_mode = defines.logistic_mode.requester
    fill(e, rec)
    try(rec, "to passive_provider", function() e.override_logistic_mode = defines.logistic_mode.passive_provider end)
    blueprint(e, rec)
    try(rec, "back to requester", function() e.override_logistic_mode = defines.logistic_mode.requester end)
    rec.sections_count_after_switch_back = section_count(e)
    out.exports[#out.exports + 1] = rec
  end
  do
    local rec = {label = "requester, mode cleared to nil"}
    local e = new_chest()
    e.override_logistic_mode = defines.logistic_mode.requester
    try(rec, "set nil", function() e.override_logistic_mode = nil end)
    rec.mode_read_back = mode_name(e.override_logistic_mode)
    blueprint(e, rec)
    out.exports[#out.exports + 1] = rec
  end

  -- 2. import
  for _, c in ipairs(IMPORTS) do
    local rec = {label = c.label}
    local ok, err = pcall(function()
      inv[1].set_stack{name = "blueprint"}
      rec.import_code = inv[1].import_stack(c.bp)
      local entities = inv[1].get_blueprint_entities()
      if c.large then
        local n = 0
        for _, e in pairs(entities or {}) do
          local rf = e.request_filters
          if rf and rf.sections then for _, s in pairs(rf.sections) do n = n + #(s.filters or {}) end end
        end
        rec.filters_read_back = n
      elseif inv[1].is_blueprint_setup() then
        rec.exported = inv[1].export_stack()
      end
    end)
    if not ok then rec.error = tostring(err) end
    out.imports[#out.imports + 1] = rec
  end

  -- instrument controls
  local function control(label, name, fn)
    local rec = {label = label}
    local ok, err = pcall(function()
      local e = surface.create_entity{name = name, position = {#out.controls * 3 + 10.5, 10.5}, force = force}
      fn(e)
      local x, y = e.position.x, e.position.y
      inv[1].set_stack{name = "blueprint"}
      inv[1].create_blueprint{surface = surface, force = force, area = {{x - 0.4, y - 0.4}, {x + 0.4, y + 0.4}}}
      rec.exported = inv[1].export_stack()
    end)
    if not ok then rec.error = tostring(err) end
    out.controls[#out.controls + 1] = rec
  end
  control("requester-chest, trash_not_requested", "requester-chest", function(e)
    e.get_logistic_sections().get_section(1).set_slot(1, {value = {type = "item", name = "iron-plate", quality = "normal"}, min = 10})
    e.get_requester_point().trash_not_requested = true
  end)
  control("storage-chest, storage_filter", "storage-chest", function(e)
    e.storage_filter = "iron-plate"
  end)

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const { text } = runProbe({
    bin: BIN,
    work,
    writeData,
    modDir,
    dump: DUMP,
    maxBuffer: 64 * 1024 * 1024,
})
const dump = JSON.parse(text)
// Lua's JSON writer turns an empty list into {}, so every list is read through this.
const list = x => (Array.isArray(x) ? x : [])
// Keep the decoded entity beside each string, so the fixture reads without a decoder.
const entityOf = rec => (rec.exported ? decode(rec.exported).blueprint.entities[0] : undefined)
for (const rec of [...list(dump.exports), ...list(dump.imports), ...list(dump.controls)]) {
    if (rec.exported) rec.entity = entityOf(rec)
}

console.log(`=== binary: ${versionLine} (mod declared factorio_version ${MOD_FACTORIO_VERSION})`)
console.log(`prototype logistic_mode: ${dump.prototype_logistic_mode}\n`)
console.log('export')
for (const r of list(dump.exports)) {
    console.log(`  ${r.label}`)
    if (r.writes) console.log(`    writes  ${JSON.stringify(r.writes)}`)
    if (r.entity) {
        const { entity_number: _n, position: _p, infinity_settings: _i, ...rest } = r.entity
        console.log(`    exports ${JSON.stringify(rest)}  (re-import code ${r.reimport_code})`)
    }
}
console.log('\nimport')
for (const r of list(dump.imports)) {
    const back = r.entity
        ? (({ entity_number: _n, position: _p, infinity_settings: _i, ...rest }) =>
              JSON.stringify(rest))(r.entity)
        : (r.filters_read_back ?? '')
    console.log(`  ${r.label}: code ${r.import_code}${r.error ? ` ERROR ${r.error}` : ''}  ${back}`)
}
console.log('\ncontrols')
for (const r of list(dump.controls)) {
    console.log(`  ${r.label}: ${r.error ?? JSON.stringify(r.entity?.request_filters)}`)
}
console.log(`\nraw: ${join(writeData, 'script-output', DUMP)}`)

/*
    A dump only proves the script ran to its end, not that each case did. Every
    export must have come back in through the game's own import, and each
    control must show the key it exists to show, before the fixture is touched.
*/
const problems = [
    list(dump.imports).length !== IMPORTS.length &&
        `${list(dump.imports).length} import cases, expected ${IMPORTS.length}`,
    ...list(dump.exports)
        .filter(r => r.exported !== undefined && r.reimport_code !== 0)
        .map(r => `${r.label}: the game refused its own export (${r.reimport_code})`),
    ...list(dump.imports)
        .filter(r => r.error)
        .map(r => `${r.label}: ${r.error}`),
    list(dump.controls)[0]?.entity?.request_filters?.trash_not_requested !== true &&
        'the requester control did not export trash_not_requested',
    list(list(dump.controls)[1]?.entity?.request_filters?.sections)[0]?.filters?.[0]?.name !==
        'iron-plate' && 'the storage control did not export its filter',
].filter(Boolean)
if (problems.length) {
    console.error(`\nincomplete run, fixture left alone:\n  ${problems.join('\n  ')}`)
    process.exit(1)
}

if (process.argv.includes('--write-fixture')) {
    writeFileSync(FIXTURE, `${JSON.stringify({ captured_on: versionLine, ...dump }, null, 4)}\n`)
    console.log(`fixture written: ${FIXTURE}`)
}
