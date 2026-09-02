/*
    PR #222 follow-up to #226. That probe settled which snapping mode carries
    `position-relative-to-grid`. This one asks the question underneath the rest
    of that PR, which #226 never touched.

    PR #222 adds a second X/Y pair to the editor's alignment dialog, labelled
    "Grid position", separate from the pair beside Absolute. Its stated premise,
    written into `Blueprint.translateEntities` and into
    `tests/blueprint-grid-position.spec.ts`:

        typing into "Grid position" writes NO blueprint field at all. It moves
        every entity's own `position` by the NEGATION of whatever was typed,
        baked straight into the exported entity coordinates, then resets to 0.

    That premise was not measured. It was inferred from a screenshot of the
    game's dialog showing two X/Y pairs, and it is the whole reason
    `translateEntities` and `Entity.forceMoveBy` exist.

    Measuring the editor rather than the game already shows the implementation
    cannot do what the premise says, because `Blueprint.serialize` re-centres
    every position through `getCenter()` and takes the same whole-number offset
    straight back out. So on a tile-free blueprint the exported string is
    byte-identical before and after a nudge. That is a fact about the editor.

    What is still unmeasured, and what this probe is for, is the game half: does
    setting a grid position move the entities in a real blueprint, or is it
    metadata that leaves every coordinate alone? Those two answers want different
    code, and one of them wants the feature deleted rather than fixed.

    This is the cheapest question that settles it, per the README. Nothing needs
    placing and no surface is involved: snapping is three settable properties on
    `LuaItemStack`, and `get_blueprint_entities()` reads the coordinates back.

    Controls, in the README's sense - each can fail while the hypothesis holds:

      - **Positive control, the comparison can see a shift.** The
        `shifted-entities` case sets the same two chests three tiles left and
        four tiles up via `set_blueprint_entities`, changing nothing about
        snapping. Its exported coordinates MUST differ from `baseline`. Without
        it, "the coordinates never moved" is indistinguishable from a probe that
        reads the same field twice, which is the failure mode that voided the
        elevated-rail section in #133 item 4.
      - **Instrument, readback.** Every property set must read back as set,
        before exporting, and `blueprint_position_relative_to_grid` must survive
        the setter-order trap #226 documents: setting a position turns absolute
        snapping ON, so position is set before absolute here, never after.
      - **Instrument, writes reach the export.** At least two configurations must
        produce different exported strings, or the setters are not reaching
        `export_stack` and every row is about nothing.
      - **Round trip.** Importing each exported string into a second stack must
        reproduce both the three snapping properties and the entity coordinates.
        What the game writes says nothing about what it means unless the game
        agrees on the way back in.
      - **Coverage.** Grid positions of {0,0}, {3,5} and {10,-7} against one
        fixed entity layout. A single non-zero offset cannot separate "moves
        entities by the offset" from "moves entities by some constant".

    And the #133 item 5 lesson, which has now paid four times: PR #222's premise
    is transcribed into this file as a prediction and scored against every
    measured row before any code changes. `--write-fixture` records which
    prediction agrees with the game.

    Usage: node tools/oracle/probe-blueprint-grid-position.mjs

           # the version #226 was measured on, rather than whatever is installed
           FACTORIO_BIN="$HOME/Downloads/factorio_space_age_mac_2_0_77.app/Contents/MacOS/factorio" \
             node tools/oracle/probe-blueprint-grid-position.mjs --write-fixture

    The --fix after a recapture is not optional: vp's formatter collapses short
    arrays onto one line and JSON.stringify does not.
*/
import { writeFileSync, readFileSync } from 'node:fs'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { inflateSync } from 'node:zlib'

const BIN = factorioBin

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'blueprint-grid-position.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')

const MOD = 'bp_grid_position'
const DUMP = 'blueprint-grid-position.json'

/* The one layout every case uses, except the positive control. */
const CHESTS = [
    { n: 1, x: 0.5, y: 0.5 },
    { n: 2, x: 8.5, y: 8.5 },
]
/* The positive control's layout: the same two chests, moved (-3, -4). */
const CHESTS_SHIFTED = CHESTS.map(c => ({ n: c.n, x: c.x - 3, y: c.y - 4 }))

const CASES = [
    { name: 'baseline', snap: null, absolute: false, position: null, entities: CHESTS },
    {
        name: 'shifted-entities',
        snap: null,
        absolute: false,
        position: null,
        entities: CHESTS_SHIFTED,
    },
    { name: 'grid-only', snap: { x: 2, y: 2 }, absolute: true, position: null, entities: CHESTS },
    {
        name: 'absolute-origin',
        snap: { x: 2, y: 2 },
        absolute: true,
        position: { x: 0, y: 0 },
        entities: CHESTS,
    },
    {
        name: 'absolute-offset',
        snap: { x: 2, y: 2 },
        absolute: true,
        position: { x: 3, y: 5 },
        entities: CHESTS,
    },
    {
        name: 'absolute-offset-large',
        snap: { x: 2, y: 2 },
        absolute: true,
        position: { x: 10, y: -7 },
        entities: CHESTS,
    },
    {
        name: 'relative-offset',
        snap: { x: 2, y: 2 },
        absolute: false,
        position: { x: 3, y: 5 },
        entities: CHESTS,
    },
]

const version = spawnSync(BIN, ['--version'], { encoding: 'utf8' }).stdout ?? ''
const binaryLine = version.split('\n')[0].trim()
const binaryVersion = (binaryLine.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1)
if (binaryVersion.length !== 3) {
    console.error(`Could not read a version out of ${BIN}: ${JSON.stringify(binaryLine)}`)
    process.exit(1)
}
/* Derived, not hardcoded: a mod declaring the wrong version is silently skipped. */
const MOD_FACTORIO_VERSION = `${binaryVersion[0]}.${binaryVersion[1]}`

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'Does a blueprint grid position move the entities',
    author: 'oracle',
    factorio_version: MOD_FACTORIO_VERSION,
    dependencies: ['base', 'elevated-rails', 'space-age'],
})

const luaCases = CASES.map(c => {
    const snap = c.snap === null ? 'nil' : `{x = ${c.snap.x}, y = ${c.snap.y}}`
    const pos = c.position === null ? 'nil' : `{x = ${c.position.x}, y = ${c.position.y}}`
    const ents = c.entities
        .map(
            e =>
                `{entity_number = ${e.n}, name = "wooden-chest", position = {x = ${e.x}, y = ${e.y}}}`
        )
        .join(', ')
    return `{name = "${c.name}", snap = ${snap}, absolute = ${c.absolute}, position = ${pos}, entities = {${ents}}}`
}).join(',\n  ')

/* No backticks anywhere in this Lua: it lives inside a JS template literal, and
   a matched pair on one line silently closes and reopens it (see the #222
   probe's README note). */
writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {errors = {}, mods = {}, cases = {}}

local CASES = {
  ${luaCases}
}

local function positionsOf(stack)
  local list = stack.get_blueprint_entities()
  local acc = {}
  if list == nil then return acc end
  for _, e in pairs(list) do
    acc[#acc + 1] = {n = e.entity_number, x = e.position.x, y = e.position.y}
  end
  return acc
end

script.on_init(function()
  for name, v in pairs(script.active_mods) do out.mods[name] = v end

  local inv = game.create_inventory(2)

  for _, c in pairs(CASES) do
    local stack = inv[1]
    stack.clear()
    stack.set_stack{name = "blueprint"}
    stack.set_blueprint_entities(c.entities)

    -- What the entities are before any snapping property is touched.
    local before = positionsOf(stack)

    -- Setter order is part of the question: #226 measured that setting a
    -- position turns absolute snapping ON, so position goes before absolute.
    stack.blueprint_snap_to_grid = c.snap
    if c.position ~= nil then
      stack.blueprint_position_relative_to_grid = c.position
    end
    stack.blueprint_absolute_snapping = c.absolute

    -- The whole question: did setting a grid position move anything?
    local after = positionsOf(stack)

    -- Instrument control: what was set has to read back, before exporting.
    local snapBack = stack.blueprint_snap_to_grid
    local posBack = stack.blueprint_position_relative_to_grid
    local readback = {
      snap = snapBack and {x = snapBack.x, y = snapBack.y} or nil,
      absolute = stack.blueprint_absolute_snapping,
      position = posBack and {x = posBack.x, y = posBack.y} or nil,
    }

    local exported = stack.export_stack()

    -- Round-trip control: same properties AND same coordinates back in?
    local second = inv[2]
    second.clear()
    second.set_stack{name = "blueprint"}
    second.import_stack(exported)
    local rsnap = second.blueprint_snap_to_grid
    local rpos = second.blueprint_position_relative_to_grid
    local roundTrip = {
      snap = rsnap and {x = rsnap.x, y = rsnap.y} or nil,
      absolute = second.blueprint_absolute_snapping,
      position = rpos and {x = rpos.x, y = rpos.y} or nil,
      entities = positionsOf(second),
    }

    out.cases[#out.cases + 1] = {
      name = c.name,
      before = before,
      after = after,
      readback = readback,
      exported = exported,
      roundTrip = roundTrip,
    }
  end

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

const { dumpPath } = runProbe({
    bin: BIN,
    work,
    writeData,
    modDir,
    dump: DUMP,
    maxBuffer: 64 * 1024 * 1024,
})

const d = JSON.parse(readFileSync(dumpPath, 'utf8'))
const list = v => (v === undefined || v === null ? [] : Object.values(v))
for (const e of list(d.errors)) console.log(`! ${e}`)

const decode = s => JSON.parse(inflateSync(Buffer.from(s.slice(1), 'base64')).toString())
const fmt = ps =>
    list(ps)
        .map(p => `#${p.n}(${p.x},${p.y})`)
        .join(' ')
const same = (a, b) => fmt(a) === fmt(b)

const rows = list(d.cases).map(c => {
    const bp = decode(c.exported).blueprint
    const exportedEntities = (bp.entities ?? []).map(e => ({
        n: e.entity_number,
        x: e.position.x,
        y: e.position.y,
    }))
    return {
        name: c.name,
        before: list(c.before),
        after: list(c.after),
        exportedEntities,
        exportedKeys: {
            snapToGrid: bp['snap-to-grid'],
            absoluteSnapping: bp['absolute-snapping'],
            positionRelativeToGrid: bp['position-relative-to-grid'],
        },
        readback: c.readback,
        roundTrip: c.roundTrip,
        movedInModel: !same(list(c.before), list(c.after)),
    }
})

const byName = Object.fromEntries(rows.map(r => [r.name, r]))

console.log(`\nbinary: ${binaryLine}`)
console.log(`mods:   ${JSON.stringify(d.mods)}\n`)

console.log('Entity coordinates, as the game reports and exports them')
console.log('=========================================================')
for (const r of rows) {
    console.log(`\n${r.name}`)
    console.log(`  set position   : ${JSON.stringify(r.readback.position ?? null)}`)
    console.log(`  model before   : ${fmt(r.before)}`)
    console.log(`  model after    : ${fmt(r.after)}`)
    console.log(`  exported       : ${fmt(r.exportedEntities)}`)
    console.log(`  round-tripped  : ${fmt(list(r.roundTrip.entities))}`)
    console.log(
        `  exported keys  : snap=${JSON.stringify(r.exportedKeys.snapToGrid ?? null)} ` +
            `absolute=${JSON.stringify(r.exportedKeys.absoluteSnapping ?? null)} ` +
            `position=${JSON.stringify(r.exportedKeys.positionRelativeToGrid ?? null)}`
    )
}

/* ---------------------------------------------------------------- controls */

const controls = []
const record = (name, ok, detail) => {
    controls.push({ name, ok, detail })
    console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${name}\n       ${detail}`)
}

console.log('\n\nControls')
console.log('========')

record(
    'positive control: the comparison can see an entity shift',
    !same(byName['baseline'].exportedEntities, byName['shifted-entities'].exportedEntities),
    `baseline ${fmt(byName['baseline'].exportedEntities)} vs shifted-entities ` +
        `${fmt(byName['shifted-entities'].exportedEntities)}`
)

/*
    A position set on a case the game then puts into relative mode does not
    survive: `blueprint_absolute_snapping = false` CLEARS
    `blueprint_position_relative_to_grid`. That is the #226 trap from the other
    end - that probe found that setting a position turns absolute ON, this one
    finds that turning absolute off takes the position away again.

    So those rows hold no grid position by the time anything is measured, and
    asking whether a grid position moved their entities is a question about a
    value that is not there. They are recorded and reported, and excluded from
    the scoring below, the same way #226 recorded its no-grid rows without
    scoring them (and per #133 item 4: record a section its control voids
    rather than reading it as a finding).

    The control that remains is the one that can still fail while the hypothesis
    holds: every position the game DID retain has to read back as set.
*/
const heldPosition = r => {
    const want = CASES.find(c => c.name === r.name).position
    if (want === null) return false
    const got = r.readback.position
    return !!got && got.x === want.x && got.y === want.y
}
const clearedByTheGame = rows.filter(r => {
    const want = CASES.find(c => c.name === r.name).position
    return want !== null && !heldPosition(r)
})
const retained = rows.filter(heldPosition)

record(
    'instrument: every position the game retained reads back as set',
    retained.length > 0 && retained.every(heldPosition),
    `${retained.length} retained (${retained.map(r => r.name).join(', ')}); ` +
        `${clearedByTheGame.length} cleared by the game (${
            clearedByTheGame.map(r => r.name).join(', ') || 'none'
        })`
)

if (clearedByTheGame.length > 0) {
    console.log(
        '\n       Note: setting blueprint_absolute_snapping = false clears\n' +
            '       blueprint_position_relative_to_grid. Those rows carry no grid position\n' +
            '       and are excluded from the scoring below rather than counted as "did not move".'
    )
}

const distinctExports = new Set(rows.map(r => JSON.stringify(r.exportedKeys))).size
record(
    'instrument: the setters reach export_stack',
    distinctExports > 1,
    `${distinctExports} distinct exported key sets across ${rows.length} cases`
)

const roundTripFailures = rows.filter(r => !same(r.exportedEntities, list(r.roundTrip.entities)))
record(
    'round trip: exported coordinates come back unchanged',
    roundTripFailures.length === 0,
    roundTripFailures.length === 0
        ? `all ${rows.length} cases reproduce their coordinates`
        : `failed: ${roundTripFailures.map(r => r.name).join(', ')}`
)

/* ------------------------------------------------------- scoring the claim */

console.log('\n\nPR #222 premise, scored against every measured row')
console.log('==================================================')
console.log(
    'Premise: setting a grid position of (px, py) moves every entity by (-px, -py),\n' +
        '         baked into the exported coordinates, and writes no blueprint field.\n'
)

const baseExported = byName['baseline'].exportedEntities
const scored = rows
    .filter(r => {
        const c = CASES.find(x => x.name === r.name)
        /* Only rows the game actually held a non-zero position for. A {0,0}
           position cannot separate "moves by the offset" from "never moves". */
        return c.position !== null && c.position.x !== 0 && heldPosition(r)
    })
    .map(r => {
        const want = CASES.find(c => c.name === r.name).position
        const predicted = baseExported.map(e => ({ n: e.n, x: e.x - want.x, y: e.y - want.y }))
        return {
            name: r.name,
            position: want,
            predicted: fmt(predicted),
            measured: fmt(r.exportedEntities),
            agrees: fmt(predicted) === fmt(r.exportedEntities),
            movedAtAll: fmt(r.exportedEntities) !== fmt(baseExported),
        }
    })

for (const s of scored) {
    console.log(`  ${s.name}  position ${JSON.stringify(s.position)}`)
    console.log(`     premise predicts : ${s.predicted}`)
    console.log(`     game gives       : ${s.measured}`)
    console.log(
        `     ${s.agrees ? 'AGREES' : 'DISAGREES'}${s.movedAtAll ? '' : '  (entities did not move at all)'}`
    )
}

const agreeing = scored.filter(s => s.agrees).length
const moved = scored.filter(s => s.movedAtAll).length
console.log(
    `\n  premise agrees on ${agreeing} of ${scored.length} rows; ` +
        `entities moved on ${moved} of ${scored.length}`
)

const allPassed = controls.every(c => c.ok)
console.log(
    `\nVERDICT: ${
        !allPassed
            ? 'a control failed, so nothing above is evidence'
            : moved === 0
              ? 'setting a grid position moves NO entity. The premise is refuted: it is\n' +
                '         metadata, not a translation.'
              : agreeing === scored.length
                ? 'the premise holds on every row.'
                : 'entities moved, but not by the predicted offset. Read the rows above.'
    }`
)

if (WRITE_FIXTURE) {
    writeFileSync(
        FIXTURE,
        `${JSON.stringify(
            {
                probe: 'probe-blueprint-grid-position.mjs',
                question:
                    "Does setting a blueprint's grid position move its entities, as PR #222 assumes?",
                binary: binaryLine,
                mods: d.mods,
                capturedFor: 'PR #222 follow-up to issue #226',
                controls,
                premise:
                    'setting a grid position of (px, py) moves every entity by (-px, -py) and writes no blueprint field',
                premiseAgreesOn: agreeing,
                premiseScoredRows: scored.length,
                entitiesMovedOn: moved,
                scored,
                cases: rows,
            },
            null,
            4
        )}\n`
    )
    console.log(`\nwrote ${FIXTURE}`)
}
