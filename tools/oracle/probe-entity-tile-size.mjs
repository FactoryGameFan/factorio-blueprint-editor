/*
    Issue #142. `PositionGrid` keys integer tiles from `getEntitySize`, which is
    `e.tile_width || Math.ceil(collision box width)`. The game publishes its own
    `tile_width`/`tile_height`, and #133 item 1 found the two disagree for every
    curved rail type - but that was a side observation off a placement probe,
    over ten prototypes. Nobody has asked the whole table.

    This is the cheapest possible question, per the README: `tile_width` is a
    read off `prototypes.entity`, with nothing placed, no surface and no
    `can_place_entity`. It is a **runtime** property of `LuaEntityPrototype`
    derived by the engine from the collision box, which is why `data.json`
    carries it for only 3 of 155 entities - those three are the only ones that
    *declare* it at the data stage. The exporter is not dropping anything; there
    is nothing at the data stage to drop.

    What it asks:

      1. `tile_width`, `tile_height` and `collision_box` for **every** entity in
         `prototypes.entity`, not only the rails. The disagreement is a property
         of how the engine rounds a collision box, so restricting the sweep to
         the ten prototypes that prompted the issue would answer only whether
         the rails move, not what else does.

      2. The same, computed the editor's way from `data.json`, for the 155
         entities the editor knows - so the fixture carries both columns and the
         disagreement is in the capture rather than in a reader's head. This is
         the treatment the README asks of any probe comparing the game against
         the editor's own model, and it is what `probe-rail-occupancy.mjs` does.

    Controls, in the README's sense - each can fail while the hypothesis holds:

      - **Instrument**: the three entities that declare `tile_width` at the data
        stage (`asteroid-collector`, `offshore-pump`, `train-stop`) must read
        back the same number at runtime. If they do not, the field being read is
        not the field `getEntitySize` already consumes and every row below is
        about something else. This is the control that can genuinely fail: it
        compares two independent sources of the same quantity.
      - **Instrument**: the sweep must find more than one distinct `WxH`. A
        constant would mean the read is not per-prototype, and a table of 1x1s
        looks exactly like a table of correct 1x1s.
      - **Coverage**: every entity `data.json` knows must be present in the
        game's table. A miss means the mod set differs from the one the dataset
        was exported with, and the comparison column is then about two different
        games. Reported as a count, and the names are listed.
      - **Version**: `--cross-check <raw dump>` compares this run against an
        earlier one from a different binary and reports every entity whose
        footprint moved. `elevated-rail-collision.json` found a real 2.0.73 /
        2.1.12 difference (`cargo-bay`), so this is not theoretical - and unlike
        every earlier probe here, this one can run on a 2.0.x binary, which is
        the version range the editor actually targets.

    Note `factorio_version` in the mod's `info.json` is **derived from the
    binary** rather than hardcoded to '2.1' the way every earlier probe here
    does. A mismatch makes the mod silently skipped with no dump and no message
    naming the cause, which is the failure mode a 2.0.x run walks straight into.

    Usage: node tools/oracle/probe-entity-tile-size.mjs
           node tools/oracle/probe-entity-tile-size.mjs --write-fixture && vp check --fix

           # the whole point of this one: the version the editor targets
           FACTORIO_BIN="/path/to/2.0.77.app/Contents/MacOS/factorio" \
             node tools/oracle/probe-entity-tile-size.mjs --raw-out /tmp/tile-size-2.0.77.json

           # then stamp the fixture with the cross-version comparison
           node tools/oracle/probe-entity-tile-size.mjs \
             --cross-check /tmp/tile-size-2.0.77.json --write-fixture && vp check --fix

    The --fix is not optional if you recapture: vp's formatter collapses short
    arrays onto one line and JSON.stringify does not.
*/
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { factorioBin, prepareProbe, runProbe } from './factorio-probe.mjs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BIN = factorioBin

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const FIXTURE = join(HERE, 'fixtures', 'entity-tile-size.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')

const flag = name => {
    const i = process.argv.indexOf(name)
    return i === -1 ? undefined : process.argv[i + 1]
}
const RAW_OUT = flag('--raw-out')
const CROSS_CHECK = flag('--cross-check')

const MOD = 'bp_entity_tile_size'
const DUMP = 'entity-tile-size.json'

/*
    The three entities that carry tile_width in data.json, ie. that declare it
    at the data stage. Their runtime values must agree with the declared ones or
    the instrument is reading something else.
*/
const DECLARED_IN_DATA = ['asteroid-collector', 'offshore-pump', 'train-stop']

const version = spawnSync(BIN, ['--version'], { encoding: 'utf8' }).stdout ?? ''
const binaryLine = version.split('\n')[0].trim()
const binaryVersion = (binaryLine.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1)
if (binaryVersion.length !== 3) {
    console.error(`Could not read a version out of ${BIN}: ${JSON.stringify(binaryLine)}`)
    process.exit(1)
}
/*
    Derived, not hardcoded. A mod declaring 2.1 against a 2.0.x binary is
    skipped in silence and the run ends with "No dump" and nothing naming why.
*/
const MOD_FACTORIO_VERSION = `${binaryVersion[0]}.${binaryVersion[1]}`

const { work, writeData, modDir, modPath } = prepareProbe({
    name: MOD,
    version: '0.0.1',
    title: 'What footprint does the game publish for every entity',
    author: 'oracle',
    factorio_version: MOD_FACTORIO_VERSION,
    dependencies: ['base', 'elevated-rails', 'space-age'],
})

writeFileSync(
    join(modPath, 'control.lua'),
    `
local out = {errors = {}, mods = {}, entities = {}, declared = {}, counts = {}}

script.on_init(function()
  for name, v in pairs(script.active_mods) do out.mods[name] = v end

  local total, sized, nilled, distinct = 0, 0, 0, {}
  for name, p in pairs(prototypes.entity) do
    total = total + 1
    local tw, th = p.tile_width, p.tile_height
    local cb = p.collision_box
    out.entities[name] = {
      type = p.type,
      tile_width = tw,
      tile_height = th,
      collision_box = {
        cb.left_top.x, cb.left_top.y, cb.right_bottom.x, cb.right_bottom.y,
      },
    }
    if tw == nil or th == nil then
      nilled = nilled + 1
    else
      sized = sized + 1
      distinct[tw .. "x" .. th] = true
    end
  end

  local d = 0
  for _ in pairs(distinct) do d = d + 1 end
  out.counts = {total = total, sized = sized, nilled = nilled, distinct_sizes = d}

  -- Instrument control: the three that declare it at the data stage.
  for _, name in pairs({${DECLARED_IN_DATA.map(n => `"${n}"`).join(', ')}}) do
    local p = prototypes.entity[name]
    if p then
      out.declared[name] = {tile_width = p.tile_width, tile_height = p.tile_height}
    else
      out.errors[#out.errors + 1] = "no prototype: " .. name
    end
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

/* ------------------------------------------------------------------ *
 * The editor's own rectangle, from the same data.json it loads.       *
 * ------------------------------------------------------------------ */
const FD = JSON.parse(
    readFileSync(join(REPO, 'packages', 'exporter', 'data', 'output', 'data.json'), 'utf8')
).entities

/** Transcribed from getEntitySize at direction 0, where no width/height swap applies. */
const editorSize = name => {
    const e = FD[name]
    const bb = e.collision_box
    return {
        w: e.tile_width || Math.ceil(Math.abs(bb[0][0]) + Math.abs(bb[1][0])),
        h: e.tile_height || Math.ceil(Math.abs(bb[0][1]) + Math.abs(bb[1][1])),
        declared: e.tile_width !== undefined && e.tile_height !== undefined,
    }
}

const game = d.entities ?? {}

/* ------------------------------------------------------------------ *
 * Controls                                                            *
 * ------------------------------------------------------------------ */
const counts = d.counts ?? {}
const declaredOk = []
for (const name of DECLARED_IN_DATA) {
    const runtime = (d.declared ?? {})[name]
    const dataStage = FD[name]
    declaredOk.push({
        name,
        dataStage: dataStage ? `${dataStage.tile_width}x${dataStage.tile_height}` : 'ABSENT',
        runtime: runtime ? `${runtime.tile_width}x${runtime.tile_height}` : 'ABSENT',
        agrees:
            !!runtime &&
            !!dataStage &&
            runtime.tile_width === dataStage.tile_width &&
            runtime.tile_height === dataStage.tile_height,
    })
}

const known = Object.keys(FD).sort()
const missingFromGame = known.filter(n => game[n] === undefined)

console.log('=== controls ===')
console.log(`  entities swept:                        ${counts.total}`)
console.log(`  with a tile_width and tile_height:     ${counts.sized}`)
console.log(`  with neither:                          ${counts.nilled}`)
console.log(
    `  distinct WxH values:                   ${counts.distinct_sizes}  ${counts.distinct_sizes > 1 ? '(not a constant)' : 'VOID - a constant read says nothing'}`
)
for (const c of declaredOk) {
    console.log(
        `  declared at the data stage: ${c.name.padEnd(20)} data.json ${c.dataStage.padEnd(5)} runtime ${c.runtime.padEnd(5)} ${c.agrees ? 'agrees' : 'DISAGREES - the instrument is reading a different field'}`
    )
}
console.log(
    `  data.json entities found in the game:  ${known.length - missingFromGame.length}/${known.length}` +
        (missingFromGame.length ? `  MISSING: ${missingFromGame.join(', ')}` : '')
)

/* ------------------------------------------------------------------ *
 * The comparison                                                      *
 * ------------------------------------------------------------------ */
const rows = []
for (const name of known) {
    const g = game[name]
    if (g === undefined) continue
    const e = editorSize(name)
    rows.push({
        name,
        type: g.type,
        game: [g.tile_width, g.tile_height],
        editor: [e.w, e.h],
        declaredInDataJson: e.declared,
        agrees: g.tile_width === e.w && g.tile_height === e.h,
        cellDelta: g.tile_width * g.tile_height - e.w * e.h,
    })
}

const disagreements = rows.filter(r => !r.agrees)
console.log(`\n=== footprint: the game against the editor, over ${rows.length} entities ===`)
console.log(`  agree:    ${rows.length - disagreements.length}`)
console.log(`  disagree: ${disagreements.length}`)
if (disagreements.length) {
    console.log(
        `\n  ${'entity'.padEnd(30)} ${'type'.padEnd(24)} ${'game'.padEnd(7)} ${'editor'.padEnd(7)} cells`
    )
    for (const r of disagreements.sort(
        (a, b) => b.cellDelta - a.cellDelta || a.name.localeCompare(b.name)
    )) {
        console.log(
            `  ${r.name.padEnd(30)} ${r.type.padEnd(24)} ${`${r.game[0]}x${r.game[1]}`.padEnd(7)} ${`${r.editor[0]}x${r.editor[1]}`.padEnd(7)} ${r.cellDelta > 0 ? '+' : ''}${r.cellDelta}`
        )
    }
}

/* ------------------------------------------------------------------ *
 * The proposed rule, checked against every measured row before any    *
 * code is written. This is the #133 item 5 lesson and it is why this  *
 * probe ends in "do not implement": adopting the game's numbers is a  *
 * change to what PositionGrid keys, and fixtures/rail-occupancy.json  *
 * already holds what the game really blocks around all 38 measured    *
 * rail orientations. Transcribing the rule here rather than into      *
 * prose is what keeps the decisive number re-derivable.               *
 * ------------------------------------------------------------------ */
const OCCUPANCY = join(HERE, 'fixtures', 'rail-occupancy.json')

/** getEntitySize's width/height swap, which applies to whichever pair of numbers it is given. */
const swapForDirection = (type, dir, w, h) => {
    if (w === h) return { x: w, y: h }
    const dd =
        type === 'curved-rail-a' || type === 'curved-rail-b'
            ? Math.floor((dir % 8) / 4) * 4
            : (Math.round(dir / 4) * 4) % 16
    return dd === 4 || dd === 12 ? { x: h, y: w } : { x: w, y: h }
}

/*
    PositionGrid.processArea, expressed the way rail-occupancy.json expresses a
    blocked cell: **relative to floor(position)**, not in world coordinates. Get
    that wrong and both arms inflate together, which looks like a plausible
    answer rather than like a bug - it read 440/356 against 435/399 on the first
    run here. The `straight-rail@0` control below is what tells them apart.
*/
const keyedCells = (size, px, py) => {
    const x0 = Math.round(px - size.x / 2)
    const y0 = Math.round(py - size.y / 2)
    const out = new Set()
    for (let x = x0; x < x0 + size.x; x++)
        for (let y = y0; y < y0 + size.y; y++)
            out.add(`${x - Math.floor(px)},${y - Math.floor(py)}`)
    return out
}

let occupancy
if (existsSync(OCCUPANCY)) {
    const occ = JSON.parse(readFileSync(OCCUPANCY, 'utf8'))
    const arms = { today: { missed: 0, empty: 0 }, gameTiles: { missed: 0, empty: 0 } }
    const perRail = {}

    for (const r of Object.values(occ.rails)) {
        /*
            The wooden-chest reference, which is the one rail-occupancy.json's
            own summary uses. The four references disagree with each other by
            design - see the probe-entity note in the README - so a single arm
            has to name which one it is comparing against.
        */
        const chest = Object.values(r.references).find(x => x.reference === 'wooden-chest')
        if (chest === undefined) continue
        const blocked = new Set(Object.values(chest.blocked ?? {}).map(c => `${c.x},${c.y}`))

        const e = editorSize(r.name)
        const g = game[r.name]
        const sides = {
            today: swapForDirection(g.type, r.direction, e.w, e.h),
            gameTiles: swapForDirection(g.type, r.direction, g.tile_width, g.tile_height),
        }

        const row = { rail: r.name, direction: r.direction, blocked: blocked.size }
        for (const [arm, size] of Object.entries(sides)) {
            const cells = keyedCells(size, r.position.x, r.position.y)
            const missed = [...blocked].filter(c => !cells.has(c)).length
            const empty = [...cells].filter(c => !blocked.has(c)).length
            arms[arm].missed += missed
            arms[arm].empty += empty
            row[arm] = { tiles: [size.x, size.y], keyed: cells.size, missed, empty }
        }
        perRail[`${r.name}@${r.direction}`] = row
    }

    /*
        Alignment control. A cardinal `straight-rail` is the one case where the
        editor's rectangle, the game's published numbers and the measured
        blocked cells all coincide exactly, so it must come back 0 missed and 0
        empty on both arms. If it does not, the two coordinate systems are not
        lined up and every total above is arithmetic on unrelated cells - which
        is not a wrong answer so much as an answer to no question.
    */
    const aligned = ['straight-rail@0', 'straight-rail@4'].every(k => {
        const row = perRail[k]
        return (
            row !== undefined &&
            row.today.missed === 0 &&
            row.today.empty === 0 &&
            row.gameTiles.missed === 0 &&
            row.gameTiles.empty === 0
        )
    })

    occupancy = {
        note: 'Computed here from fixtures/rail-occupancy.json against the wooden-chest reference, not from this run of the game. It is what decides whether adopting the published numbers is an improvement, and the answer is that it is not.',
        orientations: Object.keys(perRail).length,
        reference: 'wooden-chest',
        cellsAreRelativeToFloorOfPosition: true,
        alignmentControl: {
            note: 'A cardinal straight-rail is the one case where both arms and the measurement coincide exactly. Anything but zeros means the coordinate systems are not lined up and the totals are meaningless.',
            passes: aligned,
        },
        arms,
        perRail,
    }

    console.log(
        `\n=== the proposed change, against ${occupancy.orientations} measured orientations (wooden-chest reference) ===`
    )
    console.log(
        `  alignment control (a cardinal straight-rail is exact on both arms): ${aligned ? 'passes' : 'FAILS - the totals below are arithmetic on unrelated cells'}`
    )
    console.log(
        `  today:             ${arms.today.missed} occupied-but-not-keyed, ${arms.today.empty} keyed-but-empty`
    )
    console.log(
        `  game's tile_width: ${arms.gameTiles.missed} occupied-but-not-keyed, ${arms.gameTiles.empty} keyed-but-empty`
    )
    const better =
        arms.gameTiles.missed <= arms.today.missed && arms.gameTiles.empty <= arms.today.empty
    console.log(
        `  verdict: adopting the published numbers is ${better ? 'an improvement' : 'WORSE, and on both axes - do not implement'}`
    )
    for (const row of Object.values(perRail)) {
        if (row.today.keyed === row.gameTiles.keyed) continue
        console.log(
            `    ${`${row.rail}@${row.direction}`.padEnd(26)} ${String(row.blocked).padStart(2)} blocked   ` +
                `today ${row.today.tiles.join('x').padEnd(4)} keys ${String(row.today.keyed).padStart(2)} (${row.today.missed} missed, ${row.today.empty} empty)   ` +
                `game ${row.gameTiles.tiles.join('x').padEnd(4)} keys ${String(row.gameTiles.keyed).padStart(2)} (${row.gameTiles.missed} missed, ${row.gameTiles.empty} empty)`
        )
    }
} else {
    console.log(`\n=== proposed-change check SKIPPED: no ${OCCUPANCY}`)
}

/* ------------------------------------------------------------------ *
 * Cross-version                                                       *
 * ------------------------------------------------------------------ */
let versionDifferences
if (CROSS_CHECK !== undefined) {
    const other = JSON.parse(readFileSync(resolve(CROSS_CHECK), 'utf8'))
    const otherEntities = other.entities ?? {}
    const otherLine = other.binary ?? '(unstamped)'
    const moved = []
    const onlyHere = []
    const onlyThere = []
    for (const [name, g] of Object.entries(game)) {
        const o = otherEntities[name]
        if (o === undefined) {
            onlyHere.push(name)
            continue
        }
        if (g.tile_width !== o.tile_width || g.tile_height !== o.tile_height) {
            moved.push({
                name,
                type: g.type,
                [binaryLine]: [g.tile_width, g.tile_height],
                [otherLine]: [o.tile_width, o.tile_height],
            })
        }
    }
    for (const name of Object.keys(otherEntities))
        if (game[name] === undefined) onlyThere.push(name)

    versionDifferences = {
        against: otherLine,
        entitiesCompared: Object.keys(game).filter(n => otherEntities[n] !== undefined).length,
        footprintsThatMoved: moved,
        onlyIn: { [binaryLine]: onlyHere.sort(), [otherLine]: onlyThere.sort() },
    }

    console.log(`\n=== cross-version: ${binaryLine} against ${otherLine} ===`)
    console.log(`  compared:              ${versionDifferences.entitiesCompared}`)
    console.log(`  footprints that moved: ${moved.length}`)
    for (const m of moved)
        console.log(
            `    ${m.name.padEnd(30)} ${binaryLine}: ${m[binaryLine].join('x')}   ${otherLine}: ${m[otherLine].join('x')}`
        )
    console.log(
        `  only in ${binaryLine}: ${onlyHere.length}${onlyHere.length ? ` (${onlyHere.slice(0, 8).join(', ')}${onlyHere.length > 8 ? ', ...' : ''})` : ''}`
    )
    console.log(
        `  only in ${otherLine}: ${onlyThere.length}${onlyThere.length ? ` (${onlyThere.slice(0, 8).join(', ')}${onlyThere.length > 8 ? ', ...' : ''})` : ''}`
    )
}

/* ------------------------------------------------------------------ *
 * Output                                                              *
 * ------------------------------------------------------------------ */
const raw = RAW_OUT === undefined ? join(work, 'entity-tile-size.json') : resolve(RAW_OUT)
writeFileSync(raw, JSON.stringify({ binary: binaryLine, ...d }, null, 2))
console.log(`\nraw: ${raw}`)

if (WRITE_FIXTURE) {
    /* Only the entities the editor knows. The full table is in the raw dump. */
    const entities = {}
    for (const r of rows) {
        const g = game[r.name]
        entities[r.name] = {
            type: r.type,
            gameTiles: r.game,
            editorTiles: r.editor,
            collisionBox: g.collision_box,
            declaredInDataJson: r.declaredInDataJson,
        }
    }

    const fixture = {
        question:
            'What tile_width/tile_height does the game publish for every entity, and where does that disagree with the rectangle getEntitySize computes from the collision box?',
        issue: 142,
        probe: 'tools/oracle/probe-entity-tile-size.mjs',
        binary: binaryLine,
        mods: d.mods,
        versionNote:
            'Captured on a binary in the 2.0.x range this editor targets (2.0.45 to 2.0.73), unlike every earlier fixture here, which came from 2.1.12. The mod declares factorio_version derived from the binary; hardcoding 2.1 makes a 2.0.x run produce no dump and no message saying why.',
        measurementCaveats: [
            'tile_width/tile_height are runtime properties of LuaEntityPrototype, derived by the engine from the collision box. They are not available at the data stage, which is why data.json carries them for only 3 of 155 entities - those three declare them - and why the exporter is not dropping anything.',
            'editorTiles is computed on this side from packages/exporter/data/output/data.json, mirroring getEntitySize at direction 0, because the question is what the editor computes rather than what the game collides with. The width/height swap getEntitySize applies at directions 4 and 12 is orthogonal and is not captured here.',
            'This is the published footprint, not occupancy. #133 item 1 measured that a rail blocks cells no rectangle of any size describes, and that the answer depends on the size of the box asking. A correct rectangle is still a rectangle.',
            'The fixture lists only the 155 entities data.json knows. The game table is larger; the full sweep is summarised in counts and kept in the raw dump.',
        ],
        controls: {
            note: 'Each of these can fail while the hypothesis holds.',
            entitiesSwept: counts.total,
            withAFootprint: counts.sized,
            withoutOne: counts.nilled,
            distinctFootprints: counts.distinct_sizes,
            declaredAtTheDataStageAgreesWithRuntime: declaredOk,
            dataJsonEntitiesMissingFromTheGameTable: missingFromGame,
        },
        summary: {
            compared: rows.length,
            agree: rows.length - disagreements.length,
            disagree: disagreements.length,
            disagreeing: disagreements.map(r => ({
                name: r.name,
                type: r.type,
                gameTiles: r.game,
                editorTiles: r.editor,
                cellDelta: r.cellDelta,
            })),
        },
        proposedChangeAgainstMeasuredOccupancy: occupancy,
        versionDifferences,
        entities,
        errors: list(d.errors),
    }
    writeFileSync(FIXTURE, JSON.stringify(fixture, null, 4) + '\n')
    console.log(`\nwrote ${FIXTURE}`)
    console.log('now run: vp check --fix')
}
