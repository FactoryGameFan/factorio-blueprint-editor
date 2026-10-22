/*
    What copper wires Factorio 2.0 makes when a blueprint holding electric poles
    is built next to poles already on the map (#343).

    Each case lays its map poles with `create_entity`, cuts every copper wire
    among them and adds back only the ones the case names, then builds the
    blueprint with `LuaItemStack.build_blueprint`. The copper neighbours of every
    pole are read while the pasted poles are still ghosts, then again after
    reviving them - the two readings agreed in every case when this was first
    run. Two cases use a plain `create_entity` instead of a blueprint, as the
    control for single placement.

    The answer, in short, which `WireConnections.autoConnectPoles` follows and
    `packages/editor/src/core/poleAutoConnect.test.ts` pins row by row: pasted
    poles wire to map poles in reach and never to each other; pairs are taken
    closest first by straight-line distance; a pair is skipped when either end
    already has 5 copper wires or the two share a copper neighbour. Ties, power
    switches and mixed pole types are `probe-pole-autoconnect-edges.mjs`'s, and
    the cap is `probe-pole-autoconnect-limit.mjs`'s.

    Every pole is a `medium-electric-pole` (reach 9). `relTo1` cases place the
    map poles relative to where the blueprint's first entity actually lands,
    found by a dry-run build, because the build position is the blueprint's
    centre and not its first entity.

    Usage: FACTORIO_BIN=... node tools/oracle/probe-pole-autoconnect.mjs [--write-fixture]
*/
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'

const BIN = factorioBin
const DUMP = 'pole-autoconnect.json'
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/pole-autoconnect.json')
const POLE = 'medium-electric-pole' // reach 9

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

const encode = bp =>
    `0${deflateSync(Buffer.from(JSON.stringify({ blueprint: { item: 'blueprint', version: BP_VERSION, ...bp } }))).toString('base64')}`

/** Blueprint poles at [x, y] tiles; wires are pairs of 1-based indexes. 5 is pole_copper. */
const bp = (poles, wires = []) =>
    encode({
        entities: poles.map(([x, y], i) => ({
            entity_number: i + 1,
            name: POLE,
            position: { x: x + 0.5, y: y + 0.5 },
        })),
        ...(wires.length > 0 && { wires: wires.map(([a, b]) => [a, 5, b, 5]) }),
    })

const ring = (n, r) =>
    Array.from({ length: n }, (_, i) => [
        Math.round(r * Math.cos((2 * Math.PI * i) / n)),
        Math.round(r * Math.sin((2 * Math.PI * i) / n)),
    ])

/*
    existing: map poles at [x, y] relative to the case origin. existingWires:
    1-based index pairs to wire among them; every other wire is cut.
    build: where the blueprint is built. createNear: a single create_entity
    instead of a blueprint.
*/
const CASES = [
    // control: create_entity alone auto-connects (instrument check)
    { name: 'control-create-entity', existing: [[0, 0]], createNear: [5, 0] },
    { name: 'lone-near-existing', existing: [[0, 0]], bp: bp([[0, 0]]), build: [5, 0] },
    { name: 'lone-out-of-reach', existing: [[0, 0]], bp: bp([[0, 0]]), build: [20, 0] },
    {
        name: 'bp-unwired-pair-alone',
        existing: [],
        bp: bp([
            [0, 0],
            [4, 0],
        ]),
        build: [0, 0],
    },
    {
        name: 'bp-wired-pair-alone',
        existing: [],
        bp: bp(
            [
                [0, 0],
                [4, 0],
            ],
            [[1, 2]]
        ),
        build: [0, 0],
    },
    {
        name: 'bp-wired-pair-both-in-reach-of-existing',
        existing: [[0, 0]],
        bp: bp(
            [
                [0, 0],
                [4, 0],
            ],
            [[1, 2]]
        ),
        build: [5, 0],
    },
    {
        name: 'bp-unwired-pair-both-in-reach-of-existing',
        existing: [[0, 0]],
        bp: bp([
            [0, 0],
            [4, 0],
        ]),
        build: [5, 0],
    },
    { name: 'fan-out-7-unconnected', existing: ring(7, 4), bp: bp([[0, 0]]), build: [0, 0] },
    {
        name: 'fan-out-7-chain-connected',
        existing: ring(7, 4),
        existingWires: [
            [1, 2],
            [2, 3],
            [3, 4],
            [4, 5],
            [5, 6],
            [6, 7],
        ],
        bp: bp([[0, 0]]),
        build: [0, 0],
    },
    {
        name: 'fan-out-7-all-to-one-hub-far',
        // seven map poles in one network through a hub out of the new pole's reach
        existing: [...ring(7, 4), [0, 12]],
        existingWires: [
            [1, 8],
            [2, 8],
            [3, 8],
            [4, 8],
            [5, 8],
            [6, 8],
            [7, 8],
        ],
        bp: bp([[0, 0]]),
        build: [0, 0],
    },
    {
        name: 'target-already-has-5',
        // X at 0,0 wired to 5 poles beyond the new pole's reach; the new pole lands 8 east of X
        existing: [
            [0, 0],
            [-8, 0],
            [-6, -6],
            [-6, 6],
            [0, -8],
            [0, 8],
        ],
        existingWires: [
            [1, 2],
            [1, 3],
            [1, 4],
            [1, 5],
            [1, 6],
        ],
        bp: bp([[0, 0]]),
        build: [8, 0],
    },
    {
        name: 'bp-pole-with-3-wires-plus-4-existing',
        // bp centre pole wired to 3 bp poles to its west; 4 unconnected map poles to its east
        existing: [
            [3, -3],
            [3, 3],
            [5, -1],
            [5, 1],
        ],
        bp: bp(
            [
                [0, 0],
                [-4, 0],
                [-3, -3],
                [-3, 3],
            ],
            [
                [1, 2],
                [1, 3],
                [1, 4],
            ]
        ),
        build: [0, 0],
    },
    {
        name: 'bp-order-AB-unwired-existing-between',
        // two bp poles 8 apart, unwired, a map pole between them in reach of both
        existing: [[4, 3]],
        bp: bp([
            [0, 0],
            [8, 0],
        ]),
        build: [4, 0],
    },
    {
        name: 'bp-wired-pair-one-in-reach',
        // bp poles 6 apart and wired; the map pole is in reach of the near one only
        existing: [[0, 0]],
        bp: bp(
            [
                [0, 0],
                [6, 0],
            ],
            [[1, 2]]
        ),
        build: [8, 0],
    },
    {
        name: 'bp-wired-chain-of-4-all-in-reach-of-existing',
        existing: [[0, 0]],
        bp: bp(
            [
                [0, 0],
                [2, 0],
                [4, 0],
                [6, 0],
            ],
            [
                [1, 2],
                [2, 3],
                [3, 4],
            ]
        ),
        build: [4, 3],
    },
    {
        name: 'bp-wired-chain-of-4-REVERSED-numbering',
        existing: [[0, 0]],
        bp: bp(
            [
                [6, 0],
                [4, 0],
                [2, 0],
                [0, 0],
            ],
            [
                [1, 2],
                [2, 3],
                [3, 4],
            ]
        ),
        build: [4, 3],
    },
    {
        name: 'target-has-4-control',
        existing: [
            [0, 0],
            [-8, 0],
            [-6, -6],
            [-6, 6],
            [0, -8],
        ],
        existingWires: [
            [1, 2],
            [1, 3],
            [1, 4],
            [1, 5],
        ],
        bp: bp([[0, 0]]),
        build: [8, 0],
    },
    {
        name: 'cap-0-bp-wires-4-existing',
        relTo1: true,
        existing: [
            [2, -2],
            [2, 2],
            [3, 0],
            [3, -3],
        ],
        bp: bp([[0, 0]]),
        build: [0, 0],
    },
    {
        name: 'cap-3-bp-wires-4-existing',
        relTo1: true,
        existing: [
            [2, -2],
            [2, 2],
            [3, 0],
            [3, -3],
        ],
        bp: bp(
            [
                [0, 0],
                [-8, 0],
                [-8, -2],
                [-8, 2],
            ],
            [
                [1, 2],
                [1, 3],
                [1, 4],
            ]
        ),
        build: [0, 0],
    },
    {
        name: 'chain-E-east-numbered-west-to-east',
        relTo1: true,
        existing: [[8, -3]],
        bp: bp(
            [
                [0, 0],
                [2, 0],
                [4, 0],
                [6, 0],
            ],
            [
                [1, 2],
                [2, 3],
                [3, 4],
            ]
        ),
        build: [0, 0],
    },
    {
        name: 'chain-E-east-numbered-east-to-west',
        relTo1: true,
        existing: [[-6, -3]],
        bp: bp(
            [
                [6, 0],
                [4, 0],
                [2, 0],
                [0, 0],
            ],
            [
                [1, 2],
                [2, 3],
                [3, 4],
            ]
        ),
        build: [0, 0],
    },
    {
        name: 'target-has-4-two-unwired-pasted',
        existing: [
            [0, 0],
            [-8, 0],
            [-6, -6],
            [-6, 6],
            [0, -8],
        ],
        existingWires: [
            [1, 2],
            [1, 3],
            [1, 4],
            [1, 5],
        ],
        bp: bp([
            [0, 0],
            [0, 6],
        ]),
        build: [5, 3],
    },
    {
        name: 'euclid-vs-manhattan-paste',
        relTo1: true,
        existing: [
            [3, 0],
            [-3, 0],
            [0, 3],
            [0, -3],
            [4, 4],
            [-6, 0],
        ],
        bp: bp([[0, 0]]),
        build: [0, 0],
    },
    {
        name: 'euclid-vs-manhattan-create',
        existing: [
            [3, 0],
            [-3, 0],
            [0, 3],
            [0, -3],
            [4, 4],
            [-6, 0],
        ],
        createNear: [0, 0],
    },
]

const { work, writeData, modDir, modPath } = prepareProbe({
    name: 'pole_autoconnect',
    version: '0.0.1',
    title: 'pole autoconnect on blueprint build',
    factorio_version: MOD_FACTORIO_VERSION,
    dependencies: ['base'],
})

const luaPairs = list => (list ?? []).map(([a, b]) => `{${a}, ${b}}`).join(', ')
const luaPoint = p => (p ? `{${p[0]}, ${p[1]}}` : 'nil')
const lua = CASES.map(
    (c, i) =>
        `{name = "${c.name}", ox = ${i * 200}, existing = {${luaPairs(c.existing)}}, ` +
        `existingWires = {${luaPairs(c.existingWires)}}, bp = ${c.bp ? `[==[${c.bp}]==]` : 'nil'}, ` +
        `build = ${luaPoint(c.build)}, createNear = ${luaPoint(c.createNear)}, ` +
        `relTo1 = ${c.relTo1 ? 'true' : 'false'}}`
).join(',\n  ')

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {cases = {}, errors = {}}
local POLE = "${POLE}"
local CU = defines.wire_connector_id.pole_copper
local CASES = {
  ${lua}
}

local function snapshot(surface, ox)
  local poles = surface.find_entities_filtered{area = {{ox - 40, -40}, {ox + 40, 40}}, type = {"electric-pole"}}
  local ghosts = surface.find_entities_filtered{area = {{ox - 40, -40}, {ox + 40, 40}}, ghost_type = "electric-pole"}
  local acc = {}
  local function add(e)
    local ok, conn = pcall(function() return e.get_wire_connector(CU, false) end)
    local list = {}
    if ok and conn then
      for _, w in pairs(conn.connections) do
        local o = w.target.owner
        list[#list + 1] = {x = o.position.x - ox, y = o.position.y, ghost = o.type == "entity-ghost"}
      end
    end
    acc[#acc + 1] = {x = e.position.x - ox, y = e.position.y, ghost = e.type == "entity-ghost", neighbours = list}
  end
  for _, e in pairs(poles) do add(e) end
  for _, e in pairs(ghosts) do add(e) end
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
      local area = {{c.ox - 50, -50}, {c.ox + 50, 50}}
      for _, e in pairs(s.find_entities_filtered{area = area}) do e.destroy() end
      local tiles = {}
      for x = c.ox - 50, c.ox + 49 do for y = -50, 49 do tiles[#tiles + 1] = {name = "refined-concrete", position = {x, y}} end end
      s.set_tiles(tiles)

      local bx, by = c.ox, 0
      if c.relTo1 then
        local stack = inv[1]
        stack.clear()
        stack.set_stack{name = "blueprint"}
        stack.import_stack(c.bp)
        local dry = stack.build_blueprint{surface = s, force = force, position = {c.ox + c.build[1], c.build[2]}, build_mode = defines.build_mode.normal}
        bx, by = math.floor(dry[1].position.x), math.floor(dry[1].position.y)
        for _, g in pairs(dry) do g.destroy() end
      end
      local existing = {}
      for i, p in ipairs(c.existing) do
        existing[i] = s.create_entity{name = POLE, position = {bx + p[1] + 0.5, by + p[2] + 0.5}, force = force}
      end
      -- start from no wires at all among map poles, then add the ones asked for
      for _, e in pairs(existing) do e.get_wire_connector(CU, true).disconnect_all() end
      for _, pr in pairs(c.existingWires) do
        existing[pr[1]].get_wire_connector(CU, true).connect_to(existing[pr[2]].get_wire_connector(CU, true), false)
      end

      local result = {name = c.name, before = snapshot(s, c.ox)}
      if c.createNear then
        s.create_entity{name = POLE, position = {c.ox + c.createNear[1] + 0.5, c.createNear[2] + 0.5}, force = force}
        result.after = snapshot(s, c.ox)
      end
      if c.bp then
        local stack = inv[1]
        stack.clear()
        stack.set_stack{name = "blueprint"}
        result.importCode = stack.import_stack(c.bp)
        local built = stack.build_blueprint{surface = s, force = force, position = {c.ox + c.build[1], c.build[2]}, build_mode = defines.build_mode.normal}
        result.builtOrder = {}
        for _, g in ipairs(built) do result.builtOrder[#result.builtOrder + 1] = {x = g.position.x - c.ox, y = g.position.y} end
        result.ghosts = snapshot(s, c.ox)
        for _, g in pairs(built) do if g.valid then g.revive{} end end
        result.revived = snapshot(s, c.ox)
      end
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
const fmt = p => `${p.ghost ? 'g' : 'R'}(${p.x},${p.y})`
const edges = snap => {
    const set = new Set()
    for (const p of arr(snap))
        for (const n of arr(p.neighbours)) {
            const a = fmt(p)
            const b = fmt(n)
            set.add(a < b ? `${a}-${b}` : `${b}-${a}`)
        }
    return [...set].sort(byString)
}
const counts = snap => Object.fromEntries(arr(snap).map(p => [fmt(p), arr(p.neighbours).length]))

const cases = arr(out.cases).map(c => ({
    name: c.name,
    ...(c.importCode !== undefined && { import_code: c.importCode }),
    before: edges(c.before),
    ...(c.after && { after: edges(c.after) }),
    ...(c.ghosts && { ghosts: edges(c.ghosts) }),
    ...(c.revived && { revived: edges(c.revived) }),
    ...(c.builtOrder && { built_order: arr(c.builtOrder).map(p => `(${p.x},${p.y})`) }),
    copper_count: counts(c.revived ?? c.after),
}))

console.log(versionLine)
const errors = arr(out.errors)
if (errors.length > 0) console.log('ERRORS', errors)
for (const c of cases) {
    console.log(`\n## ${c.name}  import=${c.import_code}`)
    console.log('  before :', c.before.join('  '))
    if (c.after) console.log('  after  :', c.after.join('  '))
    if (c.ghosts) console.log('  ghosts :', c.ghosts.join('  '))
    if (c.revived) console.log('  revived:', c.revived.join('  '))
    if (c.built_order) console.log('  builtOrder:', c.built_order.join(' '))
    console.log(
        '  per-pole copper count:',
        Object.entries(c.copper_count)
            .map(([k, n]) => `${k}=${n}`)
            .join(' ')
    )
}

// The instrument check: ghost and revived readings agreed in every case on the
// first run. If they ever differ, which one the editor should follow is a new
// question, so say so rather than fixture it silently.
const asReal = edge => {
    const [a, b] = edge.replaceAll('g(', 'R(').split(')-')
    const [x, y] = [`${a})`, b]
    return x < y ? `${x}-${y}` : `${y}-${x}`
}
for (const c of cases) {
    if (!c.ghosts || !c.revived) continue
    if (c.ghosts.map(asReal).sort(byString).join() !== c.revived.join()) {
        console.log(`\nNOTE ${c.name}: the ghost and revived readings differ`)
    }
}

if (process.argv.includes('--write-fixture')) {
    writeFileSync(
        FIXTURE,
        `${JSON.stringify({ captured_on: versionLine, errors, cases }, null, 4)}\n`
    )
    console.log(`\nfixture written: ${FIXTURE}`)
}
