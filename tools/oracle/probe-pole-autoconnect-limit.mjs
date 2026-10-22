/*
    How `auto_connect_up_to_n_wires` limits auto-wiring, and at which end (#343).

    Since 2.0 a pole has no cap on hand-drawn copper wires; this field caps only
    the wires the game makes by itself, and no vanilla pole sets it, so every
    vanilla pole takes the default of 5. To see what it does, this probe's mod
    adds two copies of `medium-electric-pole` (reach 9), one with the field at 2
    and one at 0, then builds one pole - by blueprint or by `create_entity` -
    next to map poles of another kind, and reads back every copper wire.

    The answer, which `getAutoConnectWireCount` and `autoConnectPoles` follow:
    each end of a candidate wire is held to its own pole's value. A new
    2-pole amid four free medium poles takes 2 wires; a 2-pole already on the
    map with 2 wires refuses a new medium pole, while a medium pole with 4
    accepts a new 2-pole as its fifth. A 0 at either end makes no wire.
    `create_entity` and a blueprint build agree in every case run both ways.

    The two `amid-4` cases with a 2-pole in the middle tie four ways on
    distance, so which 2 of the 4 the game took says nothing; only the count is
    meant to be read from them.

    Usage: FACTORIO_BIN=... node tools/oracle/probe-pole-autoconnect-limit.mjs [--write-fixture]
*/
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'

const BIN = factorioBin
const DUMP = 'pole-autoconnect-limit.json'
const FIXTURE = join(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures/pole-autoconnect-limit.json'
)
const M = 'medium-electric-pole'
const C2 = 'capped-2-pole'
const C0 = 'capped-0-pole'

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

/** A blueprint of one pole of this name. */
const bp = name =>
    `0${deflateSync(
        Buffer.from(
            JSON.stringify({
                blueprint: {
                    item: 'blueprint',
                    version: BP_VERSION,
                    entities: [{ entity_number: 1, name, position: { x: 0.5, y: 0.5 } }],
                },
            })
        )
    ).toString('base64')}`

const ring4 = name => [
    [4, 0, name],
    [-4, 0, name],
    [0, 4, name],
    [0, -4, name],
]

/*
    existing: map poles as [x, y, name] relative to the case origin. wires:
    1-based index pairs to wire among them; every other wire is cut. place: the
    pole built at `at`, by blueprint (`bp`) or `create_entity` (`create`).
*/
const CASES = [
    { name: 'new-c2-paste-amid-4-medium', existing: ring4(M), place: C2, how: 'bp', at: [0, 0] },
    {
        name: 'new-c2-create-amid-4-medium',
        existing: ring4(M),
        place: C2,
        how: 'create',
        at: [0, 0],
    },
    { name: 'new-c0-paste-amid-4-medium', existing: ring4(M), place: C0, how: 'bp', at: [0, 0] },
    {
        name: 'new-c0-create-amid-4-medium',
        existing: ring4(M),
        place: C0,
        how: 'create',
        at: [0, 0],
    },
    { name: 'new-medium-paste-amid-4-c2', existing: ring4(C2), place: M, how: 'bp', at: [0, 0] },
    { name: 'new-medium-paste-amid-4-c0', existing: ring4(C0), place: M, how: 'bp', at: [0, 0] },
    {
        name: 'new-medium-create-amid-4-c0',
        existing: ring4(C0),
        place: M,
        how: 'create',
        at: [0, 0],
    },
    {
        name: 'old-c2-with-2-wires-new-medium-paste',
        // the map pole at 0,0 is wired to 2 poles beyond the new pole's reach
        existing: [
            [0, 0, C2],
            [-8, 0, M],
            [-6, -6, M],
        ],
        wires: [
            [1, 2],
            [1, 3],
        ],
        place: M,
        how: 'bp',
        at: [8, 0],
    },
    {
        name: 'old-c2-with-2-wires-new-medium-create',
        existing: [
            [0, 0, C2],
            [-8, 0, M],
            [-6, -6, M],
        ],
        wires: [
            [1, 2],
            [1, 3],
        ],
        place: M,
        how: 'create',
        at: [8, 0],
    },
    {
        name: 'old-c2-with-1-wire-new-medium-paste',
        existing: [
            [0, 0, C2],
            [-8, 0, M],
        ],
        wires: [[1, 2]],
        place: M,
        how: 'bp',
        at: [8, 0],
    },
    {
        name: 'old-medium-with-2-wires-new-c2-paste',
        existing: [
            [0, 0, M],
            [-8, 0, M],
            [-6, -6, M],
        ],
        wires: [
            [1, 2],
            [1, 3],
        ],
        place: C2,
        how: 'bp',
        at: [8, 0],
    },
    {
        name: 'old-medium-with-4-wires-new-c2-paste',
        existing: [
            [0, 0, M],
            [-8, 0, M],
            [-6, -6, M],
            [-6, 6, M],
            [0, -8, M],
        ],
        wires: [
            [1, 2],
            [1, 3],
            [1, 4],
            [1, 5],
        ],
        place: C2,
        how: 'bp',
        at: [8, 0],
    },
]

const { work, writeData, modDir, modPath } = prepareProbe({
    name: 'pole_autoconnect_limit',
    version: '0.0.1',
    title: 'auto_connect_up_to_n_wires on pole build',
    factorio_version: MOD_FACTORIO_VERSION,
    dependencies: ['base'],
})

// The copies differ from the medium pole only in the field, and in having no
// upgrade or fast-replace link back to it.
writeFileSync(
    join(modPath, 'data.lua'),
    `
for _, spec in pairs({{"${C2}", 2}, {"${C0}", 0}}) do
  local e = table.deepcopy(data.raw["electric-pole"]["${M}"])
  e.name = spec[1]
  e.auto_connect_up_to_n_wires = spec[2]
  e.minable.result = spec[1]
  e.next_upgrade = nil
  e.fast_replaceable_group = nil
  local it = table.deepcopy(data.raw.item["${M}"])
  it.name = spec[1]
  it.place_result = spec[1]
  data:extend{e, it}
end
`
)

const luaCase = (c, i) =>
    `{name = "${c.name}", ox = ${i * 200}, existing = {${c.existing
        .map(([x, y, n]) => `{${x}, ${y}, "${n}"}`)
        .join(', ')}}, wires = {${(c.wires ?? []).map(([a, b]) => `{${a}, ${b}}`).join(', ')}}, ` +
    `place = "${c.place}", how = "${c.how}", at = {${c.at[0]}, ${c.at[1]}}, bp = [==[${bp(c.place)}]==]}`

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {cases = {}, errors = {}}
local CU = defines.wire_connector_id.pole_copper
local CASES = {
  ${CASES.map(luaCase).join(',\n  ')}
}

local function snapshot(s, ox)
  local acc = {}
  for _, e in pairs(s.find_entities_filtered{area = {{ox - 40, -40}, {ox + 40, 40}}, type = "electric-pole"}) do
    local list = {}
    for _, w in pairs(e.get_wire_connector(CU, true).connections) do
      local o = w.target.owner
      list[#list + 1] = {x = o.position.x - ox, y = o.position.y}
    end
    acc[#acc + 1] = {name = e.name, x = e.position.x - ox, y = e.position.y, neighbours = list}
  end
  return acc
end

script.on_init(function()
  local s = game.surfaces[1]
  s.always_day = true
  for _, c in pairs(CASES) do s.request_to_generate_chunks({c.ox, 0}, 3) end
  s.force_generate_chunk_requests()
  local inv = game.create_inventory(1)
  local force = game.forces.player

  for _, c in pairs(CASES) do
    local ok, err = pcall(function()
      for _, e in pairs(s.find_entities_filtered{area = {{c.ox - 50, -50}, {c.ox + 50, 50}}}) do e.destroy() end
      local tiles = {}
      for x = c.ox - 50, c.ox + 49 do for y = -50, 49 do tiles[#tiles + 1] = {name = "refined-concrete", position = {x, y}} end end
      s.set_tiles(tiles)

      local existing = {}
      for i, p in ipairs(c.existing) do
        existing[i] = s.create_entity{name = p[3], position = {c.ox + p[1] + 0.5, p[2] + 0.5}, force = force}
      end
      -- start from no wires at all among map poles, then add the ones asked for
      for _, e in pairs(existing) do e.get_wire_connector(CU, true).disconnect_all() end
      for _, pr in pairs(c.wires) do
        existing[pr[1]].get_wire_connector(CU, true).connect_to(existing[pr[2]].get_wire_connector(CU, true), false)
      end

      local result = {name = c.name, how = c.how}
      if c.how == "create" then
        s.create_entity{name = c.place, position = {c.ox + c.at[1] + 0.5, c.at[2] + 0.5}, force = force}
      else
        local stack = inv[1]
        stack.clear()
        stack.set_stack{name = "blueprint"}
        result.importCode = stack.import_stack(c.bp)
        local built = stack.build_blueprint{surface = s, force = force, position = {c.ox + c.at[1] + 0.5, c.at[2] + 0.5}, build_mode = defines.build_mode.normal}
        result.built = #built
        for _, g in pairs(built) do if g.valid then g.revive{} end end
      end
      result.after = snapshot(s, c.ox)
      out.cases[#out.cases + 1] = result
    end)
    if not ok then out.errors[#out.errors + 1] = c.name .. ": " .. tostring(err) end
  end
  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const { text } = runProbe({ bin: BIN, work, writeData, modDir, dump: DUMP })
const out = JSON.parse(text)

// table_to_json writes an empty Lua table as {}, not [].
const arr = x => (Array.isArray(x) ? x : [])
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const at = p => `(${p.x},${p.y})`

const cases = arr(out.cases).map(c => ({
    name: c.name,
    how: c.how,
    ...(c.importCode !== undefined && { import_code: c.importCode, built: c.built }),
    poles: arr(c.after)
        .map(p => ({
            pole: `${p.name}${at(p)}`,
            wires: arr(p.neighbours).length,
            to: arr(p.neighbours).map(at).sort(byString),
        }))
        .sort((a, b) => byString(a.pole, b.pole)),
}))

console.log(versionLine)
const errors = arr(out.errors)
if (errors.length > 0) console.log('ERRORS', errors)
for (const c of cases) {
    console.log(
        `\n## ${c.name}${c.import_code !== undefined ? `  import=${c.import_code} built=${c.built}` : ''}`
    )
    for (const p of c.poles)
        console.log(`  ${p.pole.padEnd(34)} wires=${p.wires}  ${p.to.join(' ')}`)
}

if (process.argv.includes('--write-fixture')) {
    writeFileSync(
        FIXTURE,
        `${JSON.stringify({ captured_on: versionLine, errors, cases }, null, 4)}\n`
    )
    console.log(`\nfixture written: ${FIXTURE}`)
}
