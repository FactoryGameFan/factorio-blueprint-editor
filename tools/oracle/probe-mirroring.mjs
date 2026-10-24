/*
    What `mirror` does to an entity (#612).

    A blueprint entity can carry `mirror: true`. This asks the game three
    things the prototype data cannot answer on its own:

    1. Geometry. Each candidate entity is created at all four directions, once
       plain and once mirrored, and the probe records where each fluid box
       connection lands, plus an inserter's or drill's drop and pickup points.
       Comparing the two arms gives the transform `mirror` applies.
    2. Flipping. On 2.1, where `LuaEntity.flip` exists, each candidate is
       flipped horizontally and vertically from every direction, and the probe
       records the direction and `mirroring` it ends up with. That is what the
       editor's mirror tool has to reproduce per entity.
    3. Blueprints. A string carrying `mirror` is imported, built and
       recaptured, once at the binary's own version and once declared 2.0.77,
       so a 2.1 binary shows what it migrates on import.

    Each entity is created by `create_entity` on a cleared grass surface, and
    pumpjacks get a crude-oil patch under them, so the geometry does not depend
    on what is nearby.

    Usage: FACTORIO_BIN=... node tools/oracle/probe-mirroring.mjs [--write-fixture]
    The fixture name carries the binary's version, so captures from 2.0 and 2.1
    sit side by side.
*/
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'

const BIN = factorioBin
const MOD = 'bp_mirroring'
const DUMP = 'mirroring-dump.json'

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
const bpVersion = (a, b, c) => a * 2 ** 48 + b * 2 ** 32 + c * 2 ** 16
const FIXTURE = join(
    dirname(fileURLToPath(import.meta.url)),
    `fixtures/mirroring-${v.join('.')}.json`
)

/*
    The entities the corpus or the 2.1 data marks as mirrorable, plus controls.
    Each carries recipes to try, first that the machine accepts wins, so its
    fluid boxes are switched on. A name missing from the binary is skipped and
    reported, which is how 2.0 drops the 2.1-only entries.
*/
const CANDIDATES = [
    { name: 'chemical-plant', recipes: ['sulfuric-acid'] },
    { name: 'oil-refinery', recipes: ['advanced-oil-processing'] },
    { name: 'assembling-machine-2', recipes: ['processing-unit'] },
    { name: 'assembling-machine-3', recipes: ['processing-unit'] },
    { name: 'foundry', recipes: ['iron-ore-melting', 'molten-iron'] },
    { name: 'electromagnetic-plant', recipes: ['electrolyte', 'supercapacitor'] },
    { name: 'biochamber', recipes: ['biolubricant', 'nutrients-from-biter-egg'] },
    { name: 'cryogenic-plant', recipes: ['fluoroketone'] },
    { name: 'recycler', recipes: [] },
    { name: 'electric-mining-drill', recipes: [] },
    { name: 'burner-mining-drill', recipes: [] },
    { name: 'big-mining-drill', recipes: [] },
    { name: 'pumpjack', recipes: [], resource: 'crude-oil' },
    { name: 'inserter', recipes: [] },
    { name: 'long-handed-inserter', recipes: [] },
    // controls: no mirroring in either version
    { name: 'steam-engine', recipes: [] },
    { name: 'storage-tank', recipes: [] },
]

const encode = blueprint =>
    `0${deflateSync(Buffer.from(JSON.stringify({ blueprint }))).toString('base64')}`

// 16-way directions throughout.
const BP_ENTITIES = [
    { name: 'chemical-plant', direction: 4, mirror: true, recipe: 'sulfuric-acid' },
    { name: 'chemical-plant', direction: 4 },
    { name: 'assembling-machine-3', direction: 0, mirror: true, recipe: 'processing-unit' },
    { name: 'assembling-machine-3', direction: 4, mirror: true, recipe: 'processing-unit' },
    { name: 'oil-refinery', direction: 8, mirror: true, recipe: 'advanced-oil-processing' },
    { name: 'pumpjack', direction: 4 },
    { name: 'pumpjack', direction: 12 },
    { name: 'pumpjack', direction: 0, mirror: true },
    { name: 'burner-mining-drill', direction: 4 },
    { name: 'burner-mining-drill', direction: 0, mirror: true },
    { name: 'inserter', direction: 4, mirror: true },
]
const BP_CASES = [
    ['own version', bpVersion(...v)],
    ['2.0.77', bpVersion(2, 0, 77)],
].flatMap(([versionLabel, version]) =>
    BP_ENTITIES.map(e => ({
        label: `${versionLabel}: ${e.name} dir ${e.direction}${e.mirror ? ' mirror' : ''}`,
        name: e.name,
        bp: encode({
            item: 'blueprint',
            version,
            entities: [
                {
                    entity_number: 1,
                    position: { x: 0.5, y: 0.5 },
                    ...e,
                    ...(e.direction === 0 && { direction: undefined }),
                },
            ],
        }),
    }))
)

const lua = s => `[==[${s}]==]`

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'What mirror does to an entity',
    author: 'oracle',
    factorio_version: MOD_FACTORIO_VERSION,
    dependencies: ['base', 'elevated-rails', 'quality', 'space-age', '? recycler'],
})

writeFileSync(
    join(modPath, 'control.lua'),
    `
local CANDIDATES = {
${CANDIDATES.map(
    c =>
        `  {name = ${lua(c.name)}, recipes = {${c.recipes.map(lua).join(', ')}}${
            c.resource ? `, resource = ${lua(c.resource)}` : ''
        }},`
).join('\n')}
}
local BP_CASES = {
${BP_CASES.map(c => `  {label = ${lua(c.label)}, name = ${lua(c.name)}, bp = ${lua(c.bp)}},`).join('\n')}
}

local function rel(p, origin)
  if not p then return nil end
  return {p.x - origin.x, p.y - origin.y}
end

local function clear(surface, area)
  for _, e in pairs(surface.find_entities_filtered{area = area}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end
end

local function snapshot(e)
  local o = e.position
  local row = {direction = e.direction, mirroring = e.mirroring, fluidboxes = {}}
  local ok, recipe = pcall(function() return e.get_recipe() end)
  if ok and recipe then row.recipe = recipe.name end
  -- 2.0 reaches connections through LuaEntity.fluidbox; 2.1 removed it for
  -- get_fluid_box_pipe_connections, and indexing a missing key throws.
  local has_fb, fb = pcall(function() return e.fluidbox end)
  local get = has_fb and fb and function(i)
    if i > #fb then return nil end
    return fb.get_pipe_connections(i)
  end or function(i)
    local ok, res = pcall(function() return e.get_fluid_box_pipe_connections(i) end)
    return ok and res or nil
  end
  for i = 1, 16 do
    local found = get(i)
    if not found then break end
    do
      local conns = {}
      for _, c in pairs(found) do
        conns[#conns + 1] = {
          position = rel(c.position, o),
          target = rel(c.target_position, o),
          flow = c.flow_direction,
          type = c.connection_type,
        }
      end
      row.fluidboxes[#row.fluidboxes + 1] = conns
    end
  end
  if e.type == "inserter" or e.type == "mining-drill" then
    row.drop = rel(e.drop_position, o)
  end
  if e.type == "inserter" then
    row.pickup = rel(e.pickup_position, o)
  end
  return row
end

local function make(surface, force, c, position, direction, mirror)
  if c.resource then
    surface.create_entity{name = c.resource, position = position, amount = 100000}
  end
  -- The recipe goes in at creation. A machine whose fluid boxes are off
  -- without a fluid recipe cannot rotate, so one created bare snaps to
  -- north and stays there after set_recipe.
  local recipe
  for _, r in ipairs(c.recipes) do
    if prototypes.recipe[r] then recipe = r break end
  end
  return surface.create_entity{
    name = c.name, position = position, direction = direction,
    force = force, mirror = mirror, recipe = recipe, raise_built = false,
  }
end

script.on_init(function()
  local surface = game.surfaces[1]
  local force = game.forces.player
  surface.request_to_generate_chunks({0, 0}, 4)
  surface.force_generate_chunk_requests()
  local area = {{-40, -40}, {40, 40}}
  local tiles = {}
  for x = -40, 40 do
    for y = -40, 40 do
      tiles[#tiles + 1] = {name = "grass-1", position = {x, y}}
    end
  end
  surface.set_tiles(tiles)
  clear(surface, area)

  local out = {entities = {}, blueprints = {}, missing = {}}
  local has_flip = false
  local probe_ent = surface.create_entity{name = "wooden-chest", position = {0, 0}, force = force}
  has_flip = pcall(function() return probe_ent.flip end)
  probe_ent.destroy()
  out.has_flip = has_flip

  for _, c in ipairs(CANDIDATES) do
    local proto = prototypes.entity[c.name]
    if not proto then
      out.missing[#out.missing + 1] = c.name
    else
      local row = {name = c.name, type = proto.type, cases = {}, flips = {}}
      pcall(function() row.use_mirroring = proto.use_mirroring end)
      for _, dir in ipairs({0, 4, 8, 12}) do
        for _, mirror in ipairs({false, true}) do
          clear(surface, area)
          local e = make(surface, force, c, {0.5, 0.5}, dir, mirror)
          local case = {asked_direction = dir, asked_mirror = mirror}
          if e then
            case.got = snapshot(e)
          else
            case.error = "create_entity returned nil"
          end
          row.cases[#row.cases + 1] = case
        end
        if has_flip then
          for _, horizontal in ipairs({true, false}) do
           for _, from_mirror in ipairs({false, true}) do
            clear(surface, area)
            local e = make(surface, force, c, {0.5, 0.5}, dir, from_mirror)
            local flip = {from_direction = dir, from_mirroring = e and e.mirroring, horizontal = horizontal}
            if e then
              local ok, res = pcall(function() return e.flip{horizontal = horizontal} end)
              flip.ok = ok
              flip.result = ok and res or tostring(res)
              flip.got = snapshot(e)
            end
            row.flips[#row.flips + 1] = flip
           end
          end
        end
      end
      out.entities[#out.entities + 1] = row
    end
  end

  local inv = game.create_inventory(2)
  for _, c in ipairs(BP_CASES) do
    local row = {label = c.label, errors = {}}
    if not prototypes.entity[c.name] then
      row.skipped = "no prototype"
    else
      clear(surface, area)
      if c.name == "pumpjack" then
        surface.create_entity{name = "crude-oil", position = {0.5, 0.5}, amount = 100000}
      elseif c.name == "burner-mining-drill" then
        for x = -1, 1 do
          for y = -1, 1 do
            surface.create_entity{name = "iron-ore", position = {x + 0.5, y + 0.5}, amount = 1000}
          end
        end
      end
      inv[1].set_stack{name = "blueprint"}
      row.import_code = inv[1].import_stack(c.bp)
      row.imported = inv[1].get_blueprint_entities()
      local ok, err = pcall(function()
        local ghosts = inv[1].build_blueprint{
          surface = surface, force = force, position = {0.5, 0.5},
          build_mode = defines.build_mode.forced,
        }
        row.ghost_count = #ghosts
        for _, g in pairs(ghosts) do
          if g.valid then
            local _, built = g.revive()
            if built then row.built = snapshot(built) end
          end
        end
      end)
      if not ok then row.errors[#row.errors + 1] = "build: " .. tostring(err) end
      inv[2].set_stack{name = "blueprint"}
      inv[2].create_blueprint{surface = surface, force = force, area = {{-5, -5}, {6, 6}}}
      row.recaptured = inv[2].get_blueprint_entities()
    end
    out.blueprints[#out.blueprints + 1] = row
  end

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const { text } = runProbe({ bin: BIN, work, writeData, modDir, dump: DUMP })
const out = JSON.parse(text)
// Lua's JSON writer turns an empty list into {}, so every list is read through this.
const list = x => (Array.isArray(x) ? x : [])
const pt = p => (p ? `(${p[0]},${p[1]})` : '-')

console.log(`=== binary: ${versionLine} (mod declared factorio_version ${MOD_FACTORIO_VERSION})`)
console.log(`missing prototypes: ${list(out.missing).join(', ') || 'none'}`)
console.log(`LuaEntity.flip available: ${out.has_flip}\n`)

for (const e of list(out.entities)) {
    console.log(`${e.name} (${e.type}) use_mirroring=${e.use_mirroring ?? '?'}`)
    for (const c of list(e.cases)) {
        const g = c.got
        if (!g) {
            console.log(`  dir ${c.asked_direction} m=${c.asked_mirror}: ${c.error}`)
            continue
        }
        const fbs = list(g.fluidboxes)
            .map(conns =>
                list(conns)
                    .map(
                        x =>
                            `${pt(x.position)}->${pt(x.target)}${x.type === 'normal' ? '' : `[${x.type}]`}`
                    )
                    .join(' ')
            )
            .join(' | ')
        console.log(
            `  dir ${c.asked_direction} m=${c.asked_mirror}: got dir ${g.direction} mirroring=${g.mirroring}` +
                `${g.recipe ? ` recipe=${g.recipe}` : ''}${g.drop ? ` drop=${pt(g.drop)}` : ''}` +
                `${g.pickup ? ` pickup=${pt(g.pickup)}` : ''}${fbs ? `  fb: ${fbs}` : ''}`
        )
    }
    for (const f of list(e.flips)) {
        console.log(
            `  flip ${f.horizontal ? 'H' : 'V'} from ${f.from_direction}` +
                `${f.from_mirroring ? ' mirrored' : ''}: ok=${f.ok} result=${f.result}` +
                ` -> dir ${f.got?.direction} mirroring=${f.got?.mirroring}`
        )
    }
}
console.log('\nblueprints:')
for (const b of list(out.blueprints)) {
    if (b.skipped) {
        console.log(`  ${b.label}: skipped (${b.skipped})`)
        continue
    }
    const imp = list(b.imported)
        .map(x => `dir ${x.direction ?? 0}${x.mirror ? ' mirror' : ''}`)
        .join(', ')
    const rec = list(b.recaptured)
        .map(x => `${x.name} dir ${x.direction ?? 0}${x.mirror ? ' mirror' : ''}`)
        .join(', ')
    console.log(
        `  ${b.label}: code ${b.import_code}; imported [${imp}]; built dir ${b.built?.direction}` +
            ` mirroring=${b.built?.mirroring}; recaptured [${rec}]`
    )
    for (const err of list(b.errors)) console.log(`    ERROR ${err}`)
}
console.log(`\nraw: ${join(writeData, 'script-output', DUMP)}`)

if (process.argv.includes('--write-fixture')) {
    writeFileSync(FIXTURE, `${JSON.stringify({ captured_on: versionLine, ...out }, null, 4)}\n`)
    console.log(`fixture written: ${FIXTURE}`)
}
