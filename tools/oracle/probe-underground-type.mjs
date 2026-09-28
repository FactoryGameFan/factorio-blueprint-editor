/*
    What the game does with an underground belt that carries no `type` (#547).

    Every underground belt in the committed corpus carries `type`, so a belt
    without one only comes from a hand-made string. The editor reads a missing
    `type` as an output - `Entity.undergroundSearchDirection` and the drawing
    both do - and before #547 its hover-line code read it as an input. This asks
    the game which it is.

    One case per blueprint string, so each import code is attributable. For each
    case the probe records what `import_stack` reads back, then builds the
    blueprint as ghosts, revives them, and records each built belt's
    `belt_to_ground_type`, the partner the game paired it with, and what a fresh
    blueprint of the built belts writes.

    Usage: node tools/oracle/probe-underground-type.mjs [--write-fixture]
*/
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'

const BIN = factorioBin
const MOD = 'bp_underground_type'
const DUMP = 'underground-type-dump.json'
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/underground-type.json')

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
const BP_VERSION = v[0] * 2 ** 48 + v[1] * 2 ** 32 + v[2] * 2 ** 16

const encode = blueprint =>
    `0${deflateSync(Buffer.from(JSON.stringify({ blueprint }))).toString('base64')}`

// 16-way east. Partners share one direction; the output is the one downstream.
const EAST = 4
const belt = (n, x, type) => ({
    entity_number: n,
    name: 'underground-belt',
    position: { x, y: 0.5 },
    direction: EAST,
    ...(type && { type }),
})

const CASES = [
    { label: 'solo, no type', entities: [belt(1, 0.5)] },
    { label: 'solo, input (control)', entities: [belt(1, 0.5, 'input')] },
    { label: 'solo, output (control)', entities: [belt(1, 0.5, 'output')] },
    {
        label: 'no type upstream, output downstream',
        entities: [belt(1, 0.5), belt(2, 4.5, 'output')],
    },
    {
        label: 'input upstream, no type downstream',
        entities: [belt(1, 0.5, 'input'), belt(2, 4.5)],
    },
    { label: 'no type upstream, no type downstream', entities: [belt(1, 0.5), belt(2, 4.5)] },
].map(({ label, entities }) => ({
    label,
    bp: encode({ item: 'blueprint', entities, version: BP_VERSION }),
}))

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'What an underground belt with no type becomes',
    author: 'oracle',
    factorio_version: MOD_FACTORIO_VERSION,
    dependencies: ['base'],
})

writeFileSync(
    join(modPath, 'control.lua'),
    `
local CASES = {
${CASES.map(c => `  {label = [==[${c.label}]==], bp = [==[${c.bp}]==]},`).join('\n')}
}

script.on_init(function()
  local surface = game.surfaces[1]
  local force = game.forces.player
  surface.request_to_generate_chunks({0, 0}, 4)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -20, 40 do
    for y = -20, 60 do
      tiles[#tiles + 1] = {name = "grass-1", position = {x, y}}
    end
  end
  surface.set_tiles(tiles)
  for _, e in pairs(surface.find_entities_filtered{area = {{-20, -20}, {40, 60}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end

  local inv = game.create_inventory(2)
  local out = {}

  for i, c in ipairs(CASES) do
    local row = {label = c.label, errors = {}}
    local y = i * 6
    inv[1].set_stack{name = "blueprint"}
    row.import_code = inv[1].import_stack(c.bp)
    row.imported = inv[1].get_blueprint_entities()

    local ok, err = pcall(function()
      local ghosts = inv[1].build_blueprint{
        surface = surface, force = force, position = {10, y},
        build_mode = defines.build_mode.forced,
      }
      row.ghost_count = #ghosts
      for _, g in pairs(ghosts) do
        if g.valid then g.revive() end
      end
    end)
    if not ok then row.errors[#row.errors + 1] = "build: " .. tostring(err) end

    row.built = {}
    local area = {{0, y - 2}, {20, y + 2}}
    for _, e in pairs(surface.find_entities_filtered{area = area, type = "underground-belt"}) do
      local partner = e.neighbours
      row.built[#row.built + 1] = {
        x = e.position.x,
        direction = e.direction,
        belt_to_ground_type = e.belt_to_ground_type,
        partner_x = partner and partner.position.x or nil,
      }
    end
    table.sort(row.built, function(a, b) return a.x < b.x end)
    row.ghosts_left = #surface.find_entities_filtered{area = area, type = "entity-ghost"}

    inv[2].set_stack{name = "blueprint"}
    inv[2].create_blueprint{surface = surface, force = force, area = area}
    row.recaptured = inv[2].get_blueprint_entities()

    out[#out + 1] = row
  end

  helpers.write_file("${DUMP}", helpers.table_to_json({cases = out}))
  error("DUMPED-OK")
end)
`
)

const { text } = runProbe({ bin: BIN, work, writeData, modDir, dump: DUMP })
const { cases } = JSON.parse(text)
// Lua's JSON writer turns an empty list into {}, so every list is read through this.
const list = x => (Array.isArray(x) ? x : [])

console.log(`=== binary: ${versionLine} (mod declared factorio_version ${MOD_FACTORIO_VERSION})\n`)
for (const c of cases) {
    const imported = list(c.imported).map(e => `${e.position.x}:${e.type ?? '(none)'}`)
    const built = list(c.built).map(
        b => `${b.x}:${b.belt_to_ground_type}${b.partner_x !== undefined ? `->${b.partner_x}` : ''}`
    )
    const recaptured = list(c.recaptured).map(e => `${e.position.x}:${e.type ?? '(none)'}`)
    console.log(c.label)
    console.log(`  import code ${c.import_code}; imported  ${imported.join('  ')}`)
    console.log(`  built       ${built.join('  ')}   (ghosts left ${c.ghosts_left})`)
    console.log(`  recaptured  ${recaptured.join('  ')}`)
    for (const e of list(c.errors)) console.log(`  ERROR ${e}`)
}
console.log(`\nraw: ${join(writeData, 'script-output', DUMP)}`)

if (process.argv.includes('--write-fixture')) {
    writeFileSync(FIXTURE, `${JSON.stringify({ captured_on: versionLine, cases }, null, 4)}\n`)
    console.log(`fixture written: ${FIXTURE}`)
}
