/*
    PR #222. `Blueprint.serialize` was changed to write `position-relative-to-grid`
    only when snapping is **Relative**:

        'position-relative-to-grid':
            snapToGrid && !absoluteSnapping && !positionIsDefault ? ... : undefined

    A decode of the committed corpus says that branch is never taken on real
    data: of 367 blueprints, 325 carry `snap-to-grid` and every one of them is
    `absolute-snapping: true`, including the only one that also carries a grid
    position (`{80, 106}`, "Biolabs 750 SPM"). So the field is dropped on export,
    which is what fails `blueprint-round-trip.spec.ts`.

    That much is measured. What is *not* measured, and what this probe is for, is
    the claim underneath the proposed fix: that `position-relative-to-grid`
    belongs to Absolute rather than Relative. The corpus can only say the two
    co-occur, never that one requires the other, because no corpus blueprint uses
    relative snapping at all. Reasoning from 325 rows that all agree is exactly
    the shape of argument #133 item 5 and #142 both got wrong.

    This is the cheapest question that settles it, per the README. Snapping is
    three settable properties on `LuaItemStack` - `blueprint_snap_to_grid`,
    `blueprint_absolute_snapping`, `blueprint_position_relative_to_grid` - so
    nothing needs placing, no surface, no `can_place_entity`. Set each
    combination on a blueprint, `export_stack()`, and read which keys the game
    itself writes.

    What it asks, over the ten configurations in CASES below: which of the three
    keys appear in the exported string, and what the game reports for each
    property afterwards.

    THE ANSWER, so nobody has to re-derive it: `position-relative-to-grid` is
    written under ABSOLUTE snapping and omitted under RELATIVE. `relative-offset`
    sets a position of {3, 5} and the game writes no position key at all;
    `absolute-offset` sets the same and the game writes {3, 5}. So PR #222 has it
    exactly inverted, and the editor's existing pass-through behaviour is right.

    AND THE TRAP THAT COST THIS PROBE A RUN: setting
    `blueprint_position_relative_to_grid` turns `blueprint_absolute_snapping`
    ON. The first version set snap, then absolute, then position, so the
    position write flipped absolute back on afterwards and every row exported as
    absolute - relative mode was never reached, and the three relative rows were
    measuring nothing. The readback control caught it; a per-setter trace of
    `absolute_snapping` is what identified which setter was responsible. Set
    position BEFORE absolute, or not at all.

    Controls, in the README's sense - each can fail while the hypothesis holds:

      - **Instrument, writes reach the export**: at least two configurations must
        produce different exported strings. If every export is byte-identical the
        setters are not reaching `export_stack` at all, and a table reading "no
        keys written" is indistinguishable from a correct one. This is the
        control that would have voided the elevated-rail section in #133 item 4.
      - **Instrument, readback**: every property set must read back as set,
        *before* exporting. If `blueprint_absolute_snapping = true` reads false,
        the API is not doing what this assumes and every row below is about
        something else.
      - **Round trip**: importing each exported string into a second stack must
        reproduce the same three properties. Measuring what the game writes says
        nothing about what it means unless the game agrees on the way back in.
        A key the game omits and then reconstructs is not a lost key.
      - **Coverage**: the sweep includes a grid position of {0, 0} as well as a
        non-zero one, in both snapping modes. Sweeping only non-zero positions
        cannot separate "written under absolute" from "written when non-default",
        which are different rules that agree on most rows.

    And the #133 item 5 lesson, which has now paid three times: both candidate
    serialization rules are transcribed into this file and checked against every
    measured row *before* anyone writes code. `--write-fixture` records which
    rule agrees with the game and which does not.

    Usage: node tools/oracle/probe-blueprint-snapping.mjs
           node tools/oracle/probe-blueprint-snapping.mjs --write-fixture && vp check --fix

           # the version the editor targets, rather than whatever is installed
           FACTORIO_BIN="$HOME/Downloads/factorio_space_age_mac_2_0_77.app/Contents/MacOS/factorio" \
             node tools/oracle/probe-blueprint-snapping.mjs --write-fixture

    The --fix is not optional if you recapture: vp's formatter collapses short
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
const FIXTURE = join(HERE, 'fixtures', 'blueprint-snapping.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')

const MOD = 'bp_snapping'
const DUMP = 'blueprint-snapping.json'

/*
    Ten configurations. The {0, 0} rows are what separate "written under
    absolute" from "written when non-default" - rules that agree everywhere else.
    The no-grid rows asked whether the other two survive with snapping off; they
    are scored separately below, because driving the API into that state reaches
    something the GUI cannot produce and the game answers it inconsistently.
*/
const CASES = [
    { name: 'no-grid', snap: null, absolute: false, position: { x: 0, y: 0 }, setPosition: true },
    {
        name: 'no-grid-absolute-set',
        snap: null,
        absolute: true,
        position: { x: 3, y: 5 },
        setPosition: true,
    },
    {
        name: 'relative-origin',
        snap: { x: 2, y: 2 },
        absolute: false,
        position: { x: 0, y: 0 },
        setPosition: true,
    },
    {
        name: 'relative-offset',
        snap: { x: 2, y: 2 },
        absolute: false,
        position: { x: 3, y: 5 },
        setPosition: true,
    },
    {
        name: 'absolute-origin',
        snap: { x: 2, y: 2 },
        absolute: true,
        position: { x: 0, y: 0 },
        setPosition: true,
    },
    {
        name: 'absolute-offset',
        snap: { x: 2, y: 2 },
        absolute: true,
        position: { x: 3, y: 5 },
        setPosition: true,
    },
    /*
        The first run set a position on every case and could not reach relative
        mode at all: `blueprint_absolute_snapping = false` read back true
        everywhere, which the readback control caught and which voided the three
        relative rows. These four never touch the position property, to separate
        "the setter does not work" from "setting a position turns absolute on".
        The setter order is part of the question, the same way a probe entity's
        own lattice was in #141.
    */
    {
        name: 'relative-no-position-set',
        snap: { x: 2, y: 2 },
        absolute: false,
        position: null,
        setPosition: false,
    },
    {
        name: 'absolute-no-position-set',
        snap: { x: 2, y: 2 },
        absolute: true,
        position: null,
        setPosition: false,
    },
    {
        name: 'no-grid-no-position-set',
        snap: null,
        absolute: false,
        position: null,
        setPosition: false,
    },
    {
        name: 'relative-position-then-absolute-false',
        snap: { x: 2, y: 2 },
        absolute: false,
        position: { x: 3, y: 5 },
        setPosition: true,
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
    title: 'Which snapping keys does the game write into a blueprint string',
    author: 'oracle',
    factorio_version: MOD_FACTORIO_VERSION,
    dependencies: ['base', 'elevated-rails', 'space-age'],
})

const luaCases = CASES.map(c => {
    const snap = c.snap === null ? 'nil' : `{x = ${c.snap.x}, y = ${c.snap.y}}`
    const px = c.position === null ? 0 : c.position.x
    const py = c.position === null ? 0 : c.position.y
    return `{name = "${c.name}", snap = ${snap}, absolute = ${c.absolute}, px = ${px}, py = ${py}, setPosition = ${c.setPosition}}`
}).join(',\n  ')

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {errors = {}, mods = {}, cases = {}}

local CASES = {
  ${luaCases}
}

script.on_init(function()
  for name, v in pairs(script.active_mods) do out.mods[name] = v end

  local inv = game.create_inventory(2)

  for _, c in pairs(CASES) do
    local stack = inv[1]
    stack.clear()
    stack.set_stack{name = "blueprint"}
    stack.set_blueprint_entities({
      {entity_number = 1, name = "wooden-chest", position = {x = 0.5, y = 0.5}},
      {entity_number = 2, name = "wooden-chest", position = {x = 2.5, y = 0.5}},
    })

    -- A trace of absolute_snapping after each individual setter, because the
    -- first run could not reach relative mode and the readback control could
    -- say only that, not which setter was responsible.
    -- (No backticks in this file's Lua: it lives inside a JS template literal,
    -- and a pair of them silently closes and reopens it.)
    local trace = {}
    trace.atStart = stack.blueprint_absolute_snapping

    stack.blueprint_snap_to_grid = c.snap
    trace.afterSnap = stack.blueprint_absolute_snapping

    if c.setPosition then
      stack.blueprint_position_relative_to_grid = {x = c.px, y = c.py}
      trace.afterPosition = stack.blueprint_absolute_snapping
    end

    stack.blueprint_absolute_snapping = c.absolute
    trace.afterAbsolute = stack.blueprint_absolute_snapping

    -- Instrument control: what was set has to read back, before exporting.
    local snapBack = stack.blueprint_snap_to_grid
    local posBack = stack.blueprint_position_relative_to_grid
    local readback = {
      snap = snapBack and {x = snapBack.x, y = snapBack.y} or nil,
      absolute = stack.blueprint_absolute_snapping,
      position = posBack and {x = posBack.x, y = posBack.y} or nil,
    }

    local exported = stack.export_stack()

    -- Round-trip control: does the game reconstruct the same three properties?
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
    }

    out.cases[#out.cases + 1] = {
      name = c.name,
      readback = readback,
      trace = trace,
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

console.log(`\n=== binary: ${binaryLine} (mod declared factorio_version ${MOD_FACTORIO_VERSION})`)
console.log(
    `=== mods: ${Object.entries(d.mods ?? {})
        .map(([n, v]) => `${n} ${v}`)
        .join(', ')}\n`
)

const decode = s => JSON.parse(inflateSync(Buffer.from(s.slice(1), 'base64')).toString())
const pt = p => (p === undefined || p === null ? null : { x: p.x, y: p.y })

const rows = list(d.cases).map(c => {
    const bp = decode(c.exported).blueprint
    return {
        case: c.name,
        set: CASES.find(x => x.name === c.name),
        readback: {
            snap: pt(c.readback?.snap),
            absolute: c.readback?.absolute === true,
            position: pt(c.readback?.position),
        },
        written: {
            'snap-to-grid': pt(bp['snap-to-grid']),
            'absolute-snapping': bp['absolute-snapping'] ?? null,
            'position-relative-to-grid': pt(bp['position-relative-to-grid']),
        },
        roundTrip: {
            snap: pt(c.roundTrip?.snap),
            absolute: c.roundTrip?.absolute === true,
            position: pt(c.roundTrip?.position),
        },
        trace: c.trace ?? {},
        exportedLength: c.exported.length,
    }
})

/* ------------------------------------------------------------------ *
 * Controls.                                                           *
 * ------------------------------------------------------------------ */
const controls = []

const distinctExports = new Set(list(d.cases).map(c => c.exported)).size
controls.push({
    name: 'writes reach the export',
    detail: `${distinctExports} distinct exported strings across ${rows.length} configurations`,
    ok: distinctExports > 1,
})

const readbackFailures = rows.filter(r => {
    const wantSnap = r.set.snap === null ? null : r.set.snap
    const snapOk = JSON.stringify(r.readback.snap) === JSON.stringify(wantSnap)
    return !snapOk || r.readback.absolute !== r.set.absolute
})
controls.push({
    name: 'properties read back as set',
    detail:
        readbackFailures.length === 0
            ? 'every configuration read back as written'
            : `mismatched: ${readbackFailures.map(r => r.case).join(', ')}`,
    ok: readbackFailures.length === 0,
})

const roundTripFailures = rows.filter(
    r => JSON.stringify(r.roundTrip) !== JSON.stringify(r.readback)
)
controls.push({
    name: 'export then import reproduces the properties',
    detail:
        roundTripFailures.length === 0
            ? 'every configuration survived a round trip'
            : `differed: ${roundTripFailures.map(r => r.case).join(', ')}`,
    ok: roundTripFailures.length === 0,
})

/* ------------------------------------------------------------------ *
 * Both candidate rules, transcribed and checked against every row      *
 * BEFORE any code is written. #133 item 5's lesson, third outing.      *
 * ------------------------------------------------------------------ */
const isDefault = p => p === null || (p.x === 0 && p.y === 0)

/** PR #222 as it stands: position written only in RELATIVE mode. */
const rulePR222 = s => ({
    'snap-to-grid': s.snap,
    'absolute-snapping': s.snap && s.absolute ? true : null,
    'position-relative-to-grid':
        s.snap && !s.absolute && !isDefault(s.position) ? s.position : null,
})

/** The inversion the review comment proposes: position written under ABSOLUTE. */
const ruleInverted = s => ({
    'snap-to-grid': s.snap,
    'absolute-snapping': s.snap && s.absolute ? true : null,
    'position-relative-to-grid': s.snap && s.absolute && !isDefault(s.position) ? s.position : null,
})

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const scoreRule = fn =>
    rows.map(r => {
        const want = fn({ snap: r.set.snap, absolute: r.set.absolute, position: r.set.position })
        return { case: r.case, agrees: same(want, r.written), predicted: want, actual: r.written }
    })

/*
    The two no-grid rows are voided by their own controls and are scored
    separately rather than counted against either rule. Driving the API into
    "a grid position, and absolute snapping, with no grid" reaches a state the
    game's own GUI cannot produce - the absolute checkbox and the position
    fields only exist while snap-to-grid is on - and the game answers it
    inconsistently: it writes `absolute-snapping: true` and even a
    `position-relative-to-grid` with no `snap-to-grid` beside them, and then
    fails to reconstruct the same properties on import. That is a finding about
    an unreachable state, not about serialization, and #133 item 4's lesson is
    to record a section its control voids rather than read it as an answer.
*/
const isGridRow = r => r.set.snap !== null
const gridRows = rows.filter(isGridRow)
const voidedRows = rows.filter(r => !isGridRow(r))

const pr222 = scoreRule(rulePR222).filter(s => gridRows.some(r => r.case === s.case))
const inverted = scoreRule(ruleInverted).filter(s => gridRows.some(r => r.case === s.case))

/* ------------------------------------------------------------------ *
 * Report.                                                             *
 * ------------------------------------------------------------------ */
console.log('=== what the game writes ===\n')
const cell = v => (v === null ? '-' : typeof v === 'object' ? `${v.x},${v.y}` : String(v))
console.log(
    ['case', 'set snap', 'set abs', 'set pos', 'wrote snap', 'wrote abs', 'wrote pos']
        .map((h, i) => h.padEnd([22, 9, 8, 8, 11, 10, 9][i]))
        .join('')
)
for (const r of rows) {
    console.log(
        [
            r.case.padEnd(22),
            cell(r.set.snap).padEnd(9),
            String(r.set.absolute).padEnd(8),
            cell(r.set.position).padEnd(8),
            cell(r.written['snap-to-grid']).padEnd(11),
            cell(r.written['absolute-snapping']).padEnd(10),
            cell(r.written['position-relative-to-grid']).padEnd(9),
        ].join('')
    )
}

console.log('\n=== absolute_snapping after each setter ===')
console.log(
    ['case', 'atStart', 'afterSnap', 'afterPos', 'afterAbs', 'wanted']
        .map((h, i) => h.padEnd([38, 9, 11, 10, 10, 8][i]))
        .join('')
)
for (const r of rows) {
    const tr = r.trace ?? {}
    console.log(
        [
            r.case.padEnd(38),
            String(tr.atStart ?? '-').padEnd(9),
            String(tr.afterSnap ?? '-').padEnd(11),
            String(tr.afterPosition ?? '(skipped)').padEnd(10),
            String(tr.afterAbsolute ?? '-').padEnd(10),
            String(r.set.absolute).padEnd(8),
        ].join('')
    )
}

console.log('\n=== controls ===')
for (const c of controls) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`)

console.log(
    `\n=== candidate rules against the ${gridRows.length} rows with a grid ` +
        `(${voidedRows.length} no-grid rows voided by their own controls) ===`
)
/** @type {[string, {case: string, agrees: boolean, predicted: any, actual: any}[]][]} */
const candidates = [
    ['PR #222 as written (position under Relative)', pr222],
    ['inverted (position under Absolute)', inverted],
]
for (const [label, scored] of candidates) {
    const bad = scored.filter(s => !s.agrees)
    console.log(`${bad.length === 0 ? 'AGREES' : 'DISAGREES'}  ${label}`)
    for (const b of bad) {
        console.log(
            `    ${b.case}: predicted pos=${cell(b.predicted['position-relative-to-grid'])} ` +
                `abs=${cell(b.predicted['absolute-snapping'])}, ` +
                `game wrote pos=${cell(b.actual['position-relative-to-grid'])} ` +
                `abs=${cell(b.actual['absolute-snapping'])}`
        )
    }
}

if (controls.some(c => !c.ok)) {
    console.log(
        '\nA control failed. Per the README, a failing control usually means the\n' +
            'question is wrong rather than the answer - read the section it voids\n' +
            'as unmeasured rather than as a finding.'
    )
}

if (WRITE_FIXTURE) {
    const fixture = {
        provenance: {
            probe: 'tools/oracle/probe-blueprint-snapping.mjs',
            binary: binaryLine,
            modFactorioVersion: MOD_FACTORIO_VERSION,
            mods: d.mods ?? {},
            question:
                'Which of snap-to-grid / absolute-snapping / position-relative-to-grid does ' +
                'the game write into an exported blueprint string, for each combination of ' +
                'the three LuaItemStack snapping properties?',
        },
        controls,
        rows: rows.map(r => ({
            case: r.case,
            gridRow: isGridRow(r),
            set: { snap: r.set.snap, absolute: r.set.absolute, position: r.set.position },
            setPosition: r.set.setPosition,
            written: r.written,
            roundTrip: r.roundTrip,
            absoluteAfterEachSetter: r.trace,
        })),
        mechanism:
            'Setting blueprint_position_relative_to_grid turns blueprint_absolute_snapping ' +
            'ON - see absoluteAfterEachSetter.afterPosition, true on every row that sets a ' +
            'position. A probe that sets position last cannot reach relative mode at all, ' +
            'which is what the first run of this probe did.',
        finding:
            'position-relative-to-grid is written under ABSOLUTE snapping and omitted under ' +
            'RELATIVE. Measured on the four rows with a grid and an explicit mode: ' +
            'relative-offset sets position {3,5} and the game writes none; absolute-offset ' +
            'sets the same and the game writes {3,5}. The editor round-trips it correctly ' +
            'today; PR #222 inverts it.',
        voided: {
            rows: voidedRows.map(r => r.case),
            why:
                'A grid position or absolute snapping with no snap-to-grid is a state the ' +
                'GUI cannot produce, and the game answers it inconsistently - it writes keys ' +
                'with no grid beside them and does not reconstruct them on import. Recorded, ' +
                'not counted.',
        },
        candidateRules: {
            'pr-222-position-under-relative': {
                agrees: pr222.every(s => s.agrees),
                disagreeingCases: pr222.filter(s => !s.agrees).map(s => s.case),
            },
            'inverted-position-under-absolute': {
                agrees: inverted.every(s => s.agrees),
                disagreeingCases: inverted.filter(s => !s.agrees).map(s => s.case),
            },
        },
    }
    writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 4)}\n`)
    console.log(`\nwrote ${FIXTURE}`)
}
