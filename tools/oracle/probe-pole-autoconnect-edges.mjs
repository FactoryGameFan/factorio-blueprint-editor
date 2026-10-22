/*
    Three questions `probe-pole-autoconnect.mjs` left open about the copper
    wires Factorio 2.0 makes by itself when a pole is built (#343):

    - Ties. When two candidate wires are the same length, which is tried
      first? Asked with the triangle rule: two map poles A and B, wired to each
      other, at the same distance from a new pole P. P wires to whichever comes
      first, and the other is then skipped for sharing it as a neighbour. Each
      layout is run with A and B created in both orders, and at two places on
      the map - straddling a chunk corner and inside one chunk - in case the
      order comes from the map's spatial index rather than from the poles.
      Then two pasted poles at the same distance from a map pole with one free
      slot left, with the blueprint's entity order swapped.
    - Power switches. Does a switch's copper wire count toward a pole's
      auto-connect cap? Asked from both sides: a map pole holding 4 pole wires
      and a switch wire, and a pasted pole that brings a switch wire with it.
    - Mixed pole types. Is the reach of a pair the shorter of the two, and are
      candidates still taken closest first when the reaches differ?

    Positions are entity centres relative to each case's origin, which sits on
    a chunk corner. `base` moves a whole case; [16, 16] puts it inside a chunk.
    A pole of a 1x1 type centres on a half tile, a 2x2 one on a whole tile.

    Usage: FACTORIO_BIN=... node tools/oracle/probe-pole-autoconnect-edges.mjs [--write-fixture]
*/
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'

const BIN = factorioBin
const DUMP = 'pole-autoconnect-edges.json'
const FIXTURE = join(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures/pole-autoconnect-edges.json'
)
const SMALL = 'small-electric-pole' // reach 7.5
const MEDIUM = 'medium-electric-pole' // reach 9
const BIG = 'big-electric-pole' // reach 32, 2x2
const SUB = 'substation' // reach 18, 2x2
const SWITCH = 'power-switch' // reach 10, 2x2

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

// 2.0 wire connector ids
const POLE_COPPER = 5
const SWITCH_LEFT_COPPER = 5

/**
 * entities: [name, x, y, entity_number?], the number defaulting to the list
 * position; wires: [i, connector, j, connector] by entity number.
 */
const bp = (entities, wires = []) =>
    `0${deflateSync(
        Buffer.from(
            JSON.stringify({
                blueprint: {
                    item: 'blueprint',
                    version: BP_VERSION,
                    entities: entities.map(([name, x, y, n], i) => ({
                        entity_number: n ?? i + 1,
                        name,
                        position: { x, y },
                    })),
                    ...(wires.length > 0 && { wires }),
                },
            })
        )
    ).toString('base64')}`

/** A 1x1 pole's centre for the tile at x, y. */
const m = (x, y, name = MEDIUM) => [name, x + 0.5, y + 0.5]

/*
    existing: map entities as [name, x, y]. wires: 1-based pairs of map poles to
    join with copper; every other copper wire among them is cut. switchWires:
    [pole, switch] pairs, joined pole copper to the switch's left copper.
    create: one entity built with create_entity, as [name, x, y]. bp + at: a
    blueprint built with its centre at `at`.
*/
const CASES = []

// --- Ties, by the triangle trick. P lands on the tile at 0,0.
const TIE_PAIRS = {
    'W-E': [
        [-4, 0],
        [4, 0],
    ],
    'N-S': [
        [0, -4],
        [0, 4],
    ],
    'NW-SE': [
        [-3, -3],
        [3, 3],
    ],
    'NE-SW': [
        [3, -3],
        [-3, 3],
    ],
    'W-N': [
        [-4, 0],
        [0, -4],
    ],
    'E-S': [
        [4, 0],
        [0, 4],
    ],
}
for (const [label, [a, b]] of Object.entries(TIE_PAIRS)) {
    for (const base of [
        [0, 0],
        [16, 16],
        [0, 16],
    ]) {
        for (const order of ['AB', 'BA']) {
            const [first, second] = order === 'AB' ? [a, b] : [b, a]
            CASES.push({
                name: `tie-${label}-created-${order}-at-${base.join('-')}`,
                base,
                existing: [m(...first), m(...second)],
                wires: [[1, 2]],
                create: m(0, 0),
            })
        }
        CASES.push({
            name: `tie-${label}-pasted-at-${base.join('-')}`,
            base,
            existing: [m(...a), m(...b)],
            wires: [[1, 2]],
            bp: bp([m(0, 0)]),
            at: [0.5, 0.5],
        })
    }
}

// --- Ties between two pasted poles for one map pole's last free slot. X at
// 0,0 holds 4 wires to spokes beyond either pasted pole's reach.
const SLOT = {
    'W-E': {
        spokes: [
            [-1, -8],
            [1, -8],
            [-1, 8],
            [1, 8],
        ],
        p: [
            [-6, 0],
            [6, 0],
        ],
    },
    'N-S': {
        spokes: [
            [-8, -1],
            [-8, 1],
            [8, -1],
            [8, 1],
        ],
        p: [
            [0, -6],
            [0, 6],
        ],
    },
}
for (const [label, { spokes, p }] of Object.entries(SLOT)) {
    for (const base of [
        [0, 0],
        [16, 16],
    ]) {
        for (const order of ['12', '21']) {
            const [first, second] = order === '12' ? p : [p[1], p[0]]
            CASES.push({
                name: `slot-tie-${label}-bp-order-${order}-at-${base.join('-')}`,
                base,
                existing: [m(0, 0), ...spokes.map(s => m(...s))],
                wires: spokes.map((_, i) => [1, i + 2]),
                bp: bp([m(...first), m(...second)]),
                at: [0.5, 0.5],
            })
        }
    }
}

// The same, with the blueprint's list order and its entity numbers disagreeing.
for (const swapped of [false, true]) {
    CASES.push({
        name: `slot-tie-W-E-list-12-numbers-${swapped ? '21' : '12'}`,
        base: [16, 16],
        existing: [m(0, 0), ...SLOT['W-E'].spokes.map(s => m(...s))],
        wires: SLOT['W-E'].spokes.map((_, i) => [1, i + 2]),
        bp: bp([
            [...m(...SLOT['W-E'].p[0]), swapped ? 2 : 1],
            [...m(...SLOT['W-E'].p[1]), swapped ? 1 : 2],
        ]),
        at: [0.5, 0.5],
    })
}

/*
    One sorted walk over every (pasted, map) pair, or each pasted pole wired in
    full before the next? X at 0,0 has one free slot; P1 is 7 west of it and
    P2 5 east. One walk gives the slot to P2 whatever the blueprint order. Each
    pasted pole in blueprint order gives it to whichever comes first. With map
    pole A 2 tiles from P1 as well, each pasted pole in order of its own nearest
    candidate takes P1 first, and P1 then takes the slot too.
*/
const FAR_SPOKES = [
    [0, -8],
    [0, 8],
    [-1, -8],
    [-1, 8],
]
for (const withA of [false, true]) {
    for (const order of ['12', '21']) {
        const p = [m(-7, 0), m(5, 0)]
        CASES.push({
            name: `walk-${withA ? 'with-A' : 'no-A'}-bp-order-${order}`,
            base: [16, 16],
            existing: [m(0, 0), ...FAR_SPOKES.map(s => m(...s)), ...(withA ? [m(-7, 2)] : [])],
            wires: FAR_SPOKES.map((_, i) => [1, i + 2]),
            bp: bp(order === '12' ? p : [p[1], p[0]]),
            // the centre of the two poles' tiles, so each lands where it says
            at: [-0.5, 0.5],
        })
    }
}

// --- Power switches. X at 0,0 with 4 pole wires to spokes beyond the new
// pole's reach, a new pole 8 east of it, and a switch beside X.
const SPOKES_4 = [
    [-8, 0],
    [-6, -6],
    [-6, 6],
    [0, -8],
]
for (const wired of [true, false]) {
    CASES.push({
        name: `switch-on-map-pole-${wired ? 'wired' : 'unwired'}`,
        base: [16, 16],
        existing: [m(0, 0), ...SPOKES_4.map(s => m(...s)), [SWITCH, -3, 5]],
        wires: SPOKES_4.map((_, i) => [1, i + 2]),
        switchWires: wired ? [[1, 6]] : [],
        create: m(8, 0),
    })
}
// A pasted pole carrying a switch wire, amid 5 free map poles.
const RING_5 = [
    [4, 0],
    [1, 4],
    [-3, 2],
    [-3, -2],
    [1, -4],
]
for (const wired of [true, false]) {
    CASES.push({
        name: `switch-on-pasted-pole-${wired ? 'wired' : 'unwired'}`,
        base: [16, 16],
        existing: RING_5.map(s => m(...s)),
        bp: bp([m(0, 0), [SWITCH, 6, 7]], wired ? [[1, POLE_COPPER, 2, SWITCH_LEFT_COPPER]] : []),
        at: [3.5, 3.5],
    })
}

// --- Mixed pole types: reach.
/** @type {[string, (string | number)[], (string | number)[]][]} */
const REACH = [
    ['medium-on-map-small-new-at-8', m(0, 0), m(8, 0, SMALL)],
    ['small-on-map-medium-new-at-8', m(0, 0, SMALL), m(8, 0)],
    ['small-on-map-medium-new-at-7', m(0, 0, SMALL), m(7, 0)],
    ['big-on-map-medium-new-at-10', [BIG, 0, 0], m(9, 0)],
    ['medium-on-map-big-new-at-10', m(0, 0), [BIG, 10, 1]],
    ['sub-on-map-big-new-at-20', [SUB, 0, 0], [BIG, 20, 0]],
    ['sub-on-map-big-new-at-17', [SUB, 0, 0], [BIG, 17, 0]],
    ['medium-on-map-medium-new-at-exactly-9', m(0, 0), m(9, 0)],
    ['big-on-map-big-new-at-exactly-32', [BIG, 0, 0], [BIG, 32, 0]],
    ['sub-on-map-sub-new-at-exactly-18', [SUB, 0, 0], [SUB, 18, 0]],
]
for (const [name, onMap, built] of REACH) {
    CASES.push({ name, base: [16, 16], existing: [onMap], create: built })
}

// --- Mixed pole types: order. A new big pole; a medium and a substation on
// the map, wired to each other, so the triangle rule keeps only the first.
// Closest first takes the medium; "most of its reach used" would take the
// substation (8.5 of 9 against 15 of 18).
for (const dir of [1, -1]) {
    CASES.push({
        name: `order-big-new-medium-8.5-sub-15-${dir === 1 ? 'east' : 'west'}`,
        base: [16, 16],
        existing: [
            [MEDIUM, dir * 8.5, 0.5],
            [SUB, dir * 15, 0],
        ],
        wires: [[1, 2]],
        create: [BIG, 0, 0],
    })
}

const { work, writeData, modDir, modPath } = prepareProbe({
    name: 'pole_autoconnect_edges',
    version: '0.0.1',
    title: 'pole autoconnect ties, switches and mixed types',
    factorio_version: MOD_FACTORIO_VERSION,
    dependencies: ['base'],
})

const luaList = list =>
    (list ?? []).map(x => `{${x.map(y => JSON.stringify(y)).join(', ')}}`).join(', ')
const lua = CASES.map(
    (c, i) =>
        `{name = "${c.name}", ox = ${i * 256 + (c.base?.[0] ?? 0)}, oy = ${c.base?.[1] ?? 0}, ` +
        `existing = {${luaList(c.existing)}}, wires = {${luaList(c.wires)}}, ` +
        `switchWires = {${luaList(c.switchWires)}}, ` +
        `create = ${c.create ? `{${c.create.map(y => JSON.stringify(y)).join(', ')}}` : 'nil'}, ` +
        `bp = ${c.bp ? `[==[${c.bp}]==]` : 'nil'}, at = ${c.at ? `{${c.at.join(', ')}}` : 'nil'}}`
).join(',\n  ')

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {cases = {}, errors = {}}
local CU = defines.wire_connector_id.pole_copper
local SL = defines.wire_connector_id.power_switch_left_copper
local SR = defines.wire_connector_id.power_switch_right_copper
local CASES = {
  ${lua}
}

local function snapshot(s, ox, oy)
  local acc = {}
  local area = {{ox - 40, oy - 40}, {ox + 40, oy + 40}}
  for _, e in pairs(s.find_entities_filtered{area = area, type = {"electric-pole", "power-switch"}}) do
    local list = {}
    local ids = e.type == "power-switch" and {SL, SR} or {CU}
    for _, id in pairs(ids) do
      local conn = e.get_wire_connector(id, false)
      if conn then
        for _, w in pairs(conn.connections) do
          local o = w.target.owner
          list[#list + 1] = {name = o.name, x = o.position.x - ox, y = o.position.y - oy}
        end
      end
    end
    acc[#acc + 1] = {name = e.name, x = e.position.x - ox, y = e.position.y - oy, unit = e.unit_number, neighbours = list}
  end
  return acc
end

script.on_init(function()
  local s = game.surfaces[1]
  s.always_day = true
  for _, c in pairs(CASES) do s.request_to_generate_chunks({c.ox, c.oy}, 3) end
  s.force_generate_chunk_requests()
  local inv = game.create_inventory(1)
  local force = game.forces.player

  for _, c in pairs(CASES) do
    local ok, err = pcall(function()
      for _, e in pairs(s.find_entities_filtered{area = {{c.ox - 50, c.oy - 50}, {c.ox + 50, c.oy + 50}}}) do e.destroy() end
      local tiles = {}
      for x = c.ox - 50, c.ox + 49 do for y = c.oy - 50, c.oy + 49 do tiles[#tiles + 1] = {name = "refined-concrete", position = {x, y}} end end
      s.set_tiles(tiles)

      local existing = {}
      for i, p in ipairs(c.existing) do
        existing[i] = s.create_entity{name = p[1], position = {c.ox + p[2], c.oy + p[3]}, force = force}
        if not existing[i] then error("could not create " .. p[1] .. " at " .. p[2] .. "," .. p[3]) end
      end
      -- start from no copper wires at all on the map, then add the ones asked for
      for _, e in pairs(existing) do
        if e.type == "power-switch" then
          e.get_wire_connector(SL, true).disconnect_all()
          e.get_wire_connector(SR, true).disconnect_all()
        else
          e.get_wire_connector(CU, true).disconnect_all()
        end
      end
      for _, pr in pairs(c.wires) do
        existing[pr[1]].get_wire_connector(CU, true).connect_to(existing[pr[2]].get_wire_connector(CU, true), false)
      end
      for _, pr in pairs(c.switchWires) do
        existing[pr[1]].get_wire_connector(CU, true).connect_to(existing[pr[2]].get_wire_connector(SL, true), false)
      end

      local result = {name = c.name, before = snapshot(s, c.ox, c.oy)}
      if c.create then
        local e = s.create_entity{name = c.create[1], position = {c.ox + c.create[2], c.oy + c.create[3]}, force = force}
        if not e then error("could not create the new " .. c.create[1]) end
      end
      if c.bp then
        local stack = inv[1]
        stack.clear()
        stack.set_stack{name = "blueprint"}
        result.importCode = stack.import_stack(c.bp)
        local built = stack.build_blueprint{surface = s, force = force, position = {c.ox + c.at[1], c.oy + c.at[2]}, build_mode = defines.build_mode.normal}
        result.built = #built
        for _, g in pairs(built) do if g.valid then g.revive{} end end
      end
      result.after = snapshot(s, c.ox, c.oy)
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
const at = p => `${p.name}(${p.x},${p.y})`
const edges = snap => {
    const set = new Set()
    for (const p of arr(snap))
        for (const n of arr(p.neighbours)) {
            const [a, b] = [at(p), at(n)]
            set.add(a < b ? `${a}-${b}` : `${b}-${a}`)
        }
    return [...set].sort(byString)
}

const cases = arr(out.cases).map(c => {
    const before = edges(c.before)
    const after = edges(c.after)
    return {
        name: c.name,
        ...(c.importCode !== undefined && { import_code: c.importCode, built: c.built }),
        poles: arr(c.after).map(at).sort(byString),
        before,
        added: after.filter(e => !before.includes(e)),
    }
})

console.log(versionLine)
const errors = arr(out.errors)
if (errors.length > 0) console.log('ERRORS', errors)
for (const c of cases) {
    console.log(
        `\n## ${c.name}${c.import_code !== undefined ? `  import=${c.import_code} built=${c.built}` : ''}`
    )
    console.log('  poles :', c.poles.join(' '))
    console.log('  before:', c.before.join('  '))
    console.log('  added :', c.added.join('  '))
}

if (process.argv.includes('--write-fixture')) {
    writeFileSync(
        FIXTURE,
        `${JSON.stringify({ captured_on: versionLine, errors, cases }, null, 4)}\n`
    )
    console.log(`\nfixture written: ${FIXTURE}`)
}
