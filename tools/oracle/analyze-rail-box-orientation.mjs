#!/usr/bin/env node
/**
 * Scores the `probe-rail-box-orientation` dump.
 *
 * Two questions, and the second one grew out of the first.
 *
 * 1. Does a `half-diagonal-rail` have the box the grid-position probe's run 2
 *    layout assumes, at the orientation it assumes? That layout depends on one
 *    rail producing three distinct floors on the y axis, and a rotated box
 *    would silently collapse them.
 * 2. Does `data.json` agree with the running game about collision boxes at
 *    all? The per-rail check needed a control - "the number the analyzer
 *    hardcodes must match the game" - and running it across all 155 entities
 *    costs nothing extra once the dump is in hand.
 *
 * Usage:
 *   node tools/oracle/analyze-rail-box-orientation.mjs <dump.json> [--write-fixture]
 *
 * Pass the committed fixture as <dump.json> to recompute only the proposed
 * change against the already-captured rail occupancy measurements.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'rail-box-orientation.json')
const OCCUPANCY = join(HERE, 'fixtures', 'rail-occupancy.json')
const BASELINE = join(HERE, 'fixtures', 'entity-tile-size.json')
const DATA_JSON = join(HERE, '..', '..', 'packages', 'exporter', 'data', 'output', 'data.json')

/**
 * Factorio stores positions in 1/256 of a tile, so a runtime `collision_box`
 * is the declared one snapped to that grid. Any difference at or below one
 * step is representation rather than disagreement, and lumping the two
 * together would bury 16 real findings under 139 uninteresting ones.
 */
const QUANTUM = 1 / 256

const dumpPath = process.argv[2]
if (dumpPath === undefined || dumpPath.startsWith('--')) {
    console.error('usage: analyze-rail-box-orientation.mjs <dump.json> [--write-fixture]')
    process.exit(2)
}
const input = JSON.parse(readFileSync(dumpPath, 'utf8'))
const fd = JSON.parse(readFileSync(DATA_JSON, 'utf8')).entities

const box = b => [b.left_top.x, b.left_top.y, b.right_bottom.x, b.right_bottom.y]

/** The enclosing rectangle alone, with no declared dimension over the top of it. */
const rawSizeFromBox = b => ({
    x: Math.ceil(Math.abs(b[0]) + Math.abs(b[2])),
    y: Math.ceil(Math.abs(b[1]) + Math.abs(b[3])),
})

/**
 * `getEntitySize`: the enclosing rectangle, unless `data.json` declares a
 * dimension, in which case the declared one wins. Reported separately from
 * `rawSizeFromBox` because the two answer different questions - see
 * `maskedByDeclaredDimension` below.
 */
const sizeFromBox = (e, b) => {
    const raw = rawSizeFromBox(b)
    return { x: e.tile_width || raw.x, y: e.tile_height || raw.y }
}

const swapForDirection = (type, dir, size) => {
    if (size.x === size.y) return size
    const dd =
        type === 'curved-rail-a' || type === 'curved-rail-b'
            ? Math.floor((dir % 8) / 4) * 4
            : (Math.round(dir / 4) * 4) % 16
    return dd === 4 || dd === 12 ? { x: size.y, y: size.x } : size
}

const keyedCells = (size, position) => {
    const x0 = Math.round(position.x - size.x / 2)
    const y0 = Math.round(position.y - size.y / 2)
    const cells = new Set()
    for (let x = x0; x < x0 + size.x; x++)
        for (let y = y0; y < y0 + size.y; y++)
            cells.add(`${x - Math.floor(position.x)},${y - Math.floor(position.y)}`)
    return cells
}

/**
 * The transcription control.
 *
 * Both arms below run through the same `sizeFromBox`, `swapForDirection` and
 * `keyedCells`, all three transcribed out of the editor by hand. A mistake in
 * any of them moves both arms together, so the comparison the fixture reports
 * would still look sound while every number in it was wrong. Nothing else here
 * can catch that.
 *
 * `fixtures/entity-tile-size.json` can. `probe-entity-tile-size.mjs` transcribed
 * the same three rules separately for #142, ran them over the same occupancy
 * fixture against the same wooden-chest reference, and committed the answer for
 * the arm the two runs share - what the editor keys today. Reproducing that
 * number is a real risk of failure while the hypothesis under test still holds,
 * which is the bar `tools/oracle/README.md` sets for a control.
 */
const baselineControl = (today, orientations) => {
    const baseline = JSON.parse(
        readFileSync(BASELINE, 'utf8')
    ).proposedChangeAgainstMeasuredOccupancy
    const theirs = baseline?.arms?.today
    // Comparable only if the other run scored the same rails against the same
    // reference. Otherwise the numbers could agree for no reason worth trusting.
    const comparable =
        theirs !== undefined &&
        baseline.reference === 'wooden-chest' &&
        baseline.orientations === orientations
    const ok = comparable && today.missed === theirs.missed && today.empty === theirs.empty
    return {
        name: "the today arm reproduces #142's independent transcription",
        ok,
        detail: comparable
            ? `${today.missed} missed and ${today.empty} empty here against ${theirs.missed} and ${theirs.empty} in entity-tile-size.json, over ${orientations} orientations`
            : 'entity-tile-size.json has no comparable today arm to check against',
    }
}

const scoreAgainstMeasuredOccupancy = disagreements => {
    const occupancy = JSON.parse(readFileSync(OCCUPANCY, 'utf8'))
    const runtimeBoxes = Object.fromEntries(disagreements.map(d => [d.name, d]))
    const rails = Object.values(occupancy.rails)
    const arms = { today: { missed: 0, empty: 0 }, runtimeBoxes: { missed: 0, empty: 0 } }
    const rows = {}
    let changedMeasuredOrientations = 0

    for (const r of rails) {
        const measured = runtimeBoxes[r.name]
        const chest = Object.values(r.references).find(x => x.reference === 'wooden-chest')
        if (measured === undefined || chest === undefined) continue
        const blocked = new Set(Object.values(chest.blocked ?? {}).map(c => `${c.x},${c.y}`))
        const e = fd[r.name]
        const sizes = {
            today: swapForDirection(e.type, r.direction, sizeFromBox(e, measured.dataJson)),
            runtimeBoxes: swapForDirection(e.type, r.direction, sizeFromBox(e, measured.runtime)),
        }
        if (sizes.today.x !== sizes.runtimeBoxes.x || sizes.today.y !== sizes.runtimeBoxes.y)
            changedMeasuredOrientations++

        const row = {}
        for (const [arm, size] of Object.entries(sizes)) {
            const cells = keyedCells(size, r.position)
            const missed = [...blocked].filter(c => !cells.has(c)).length
            const empty = [...cells].filter(c => !blocked.has(c)).length
            arms[arm].missed += missed
            arms[arm].empty += empty
            row[arm] = { missed, empty }
        }
        rows[`${r.name}@${r.direction}`] = row
    }

    const aligned = ['straight-rail@0', 'straight-rail@4'].every(
        key =>
            rows[key]?.today.missed === 0 &&
            rows[key]?.today.empty === 0 &&
            rows[key]?.runtimeBoxes.missed === 0 &&
            rows[key]?.runtimeBoxes.empty === 0
    )
    const footprints = disagreements.map(d => ({
        name: d.name,
        today: sizeFromBox(fd[d.name], d.dataJson),
        runtime: sizeFromBox(fd[d.name], d.runtime),
        rawToday: rawSizeFromBox(d.dataJson),
        rawRuntime: rawSizeFromBox(d.runtime),
        declared: {
            tile_width: fd[d.name].tile_width ?? null,
            tile_height: fd[d.name].tile_height ?? null,
        },
    }))
    const changed = f => f.today.x !== f.runtime.x || f.today.y !== f.runtime.y
    const rawChanged = f => f.rawToday.x !== f.rawRuntime.x || f.rawToday.y !== f.rawRuntime.y
    const footprintChanges = footprints.filter(changed)
    /*
        The middle case, which "rounds to the same footprint or is masked by a
        declared dimension" folded in with the benign one. These rails really do
        enclose a different rectangle; the only reason the editor computes the
        same footprint either way is that `data.json` declares `tile_height` for
        them and the declared value wins. That is a field #142 measured to be a
        centring parity rather than a size, so the agreement rests on something
        that does not mean what its name says. Named here rather than counted,
        because a reader checking this finding needs to know which rails they are.
    */
    const maskedByDeclaredDimension = footprints.filter(f => !changed(f) && rawChanged(f))
    const controls = [
        {
            name: 'every measured orientation was scored',
            ok: Object.keys(rows).length === rails.length,
            detail: `${Object.keys(rows).length} of ${rails.length}`,
        },
        {
            name: 'the coordinate systems align on cardinal straight rails',
            ok: aligned,
            detail: aligned ? '0 missed and 0 empty in both arms' : 'alignment row differs',
        },
        baselineControl(arms.today, rails.length),
    ]

    return {
        note: 'Computed from fixtures/rail-occupancy.json against the wooden-chest reference. Runtime boxes reduce false positives but increase occupied tiles the editor would not key, so replacing data.json is not an improvement.',
        orientations: rails.length,
        reference: 'wooden-chest',
        controls,
        controlsAllPassed: controls.every(c => c.ok),
        collisionBoxDisagreements: disagreements.length,
        footprintChanges,
        maskedByDeclaredDimension,
        unchangedFootprints: footprints.filter(f => !changed(f) && !rawChanged(f)).length,
        changedMeasuredOrientations,
        arms,
        adoptingRuntimeBoxesIsImprovement:
            arms.runtimeBoxes.missed <= arms.today.missed &&
            arms.runtimeBoxes.empty <= arms.today.empty,
    }
}

const writeResult = result => {
    const json = JSON.stringify(result, null, 4)
    if (process.argv.includes('--write-fixture')) {
        writeFileSync(FIXTURE, json + '\n')
        console.log(`wrote ${FIXTURE}`)
    } else {
        console.log(json)
    }
}

if (input.dataJsonVersusRuntime !== undefined) {
    input.issue =
        '#251; originally captured while de-risking run 2 of probe-blueprint-grid-position-gui'
    input.proposedChangeAgainstMeasuredOccupancy = scoreAgainstMeasuredOccupancy(
        input.dataJsonVersusRuntime.disagreements
    )
    writeResult(input)
    if (!input.proposedChangeAgainstMeasuredOccupancy.controlsAllPassed) process.exit(1)
    process.exit(0)
}

const dump = input

const placed = dump.directions.filter(d => d.created)
const boxes = placed.map(d => JSON.stringify(box(d.bounding_box)))
const positions = placed.map(d => `${d.position.x},${d.position.y}`)

const quantised = []
const disagreements = []
for (const [name, e] of Object.entries(fd)) {
    const declared = e.collision_box
    const runtime = dump.all_collision_boxes?.[name]
    if (declared === undefined || runtime === undefined) continue
    const a = [declared[0][0], declared[0][1], declared[1][0], declared[1][1]]
    const deviation = Math.max(...a.map((v, i) => Math.abs(v - runtime[i])))
    if (deviation <= QUANTUM) quantised.push({ name, deviation })
    else disagreements.push({ name, deviation, dataJson: a, runtime })
}
disagreements.sort((x, y) => y.deviation - x.deviation)

const controls = [
    {
        name: 'every direction produced a placement',
        ok: placed.length === dump.directions.length,
        detail: `${placed.length} of ${dump.directions.length} directions created an entity`,
    },
    {
        // Without this the "it does not rotate" finding is unfalsifiable: a
        // probe that only ever placed one orientation would report the same
        // single box and look just as clean.
        name: 'the sweep covered more than one stored direction',
        ok: new Set(placed.map(d => d.stored_direction)).size > 1,
        detail: `stored directions seen: ${[...new Set(placed.map(d => d.stored_direction))].sort((a, b) => a - b).join(', ')}`,
    },
    {
        name: 'the probe recorded no Lua errors',
        ok: (dump.errors?.length ?? 0) === 0,
        detail: `${dump.errors?.length ?? 0} errors`,
    },
]

const fixture = {
    question:
        "Does a half-diagonal-rail's collision box rotate with direction, and does data.json agree with the running game about collision boxes?",
    probe: 'probe-rail-box-orientation/control.lua',
    runner: 'factorio-oracle run --probe tools/oracle/probe-rail-box-orientation/probe.json',
    issue: '#251; originally captured while de-risking run 2 of probe-blueprint-grid-position-gui',
    provenance: {
        capturedOn: new Date().toISOString().slice(0, 10),
        method: 'headless create run; no player needed, so no interactive session',
        factorioVersion: '2.0.77',
        activeModsSeenByMod: dump.active_mods,
    },
    controls,
    controlsAllPassed: controls.every(c => c.ok),
    findings: {
        boxRotatesWithDirection: new Set(boxes).size > 1,
        distinctBoxesAcrossAllDirections: new Set(boxes).size,
        snapsAwayFromTheRequestedPosition:
            new Set(positions).size === 1 && positions[0] !== '20,20',
        requestedPosition: dump.requested_position,
        actualPosition: placed[0]?.position,
        storedDirections: [...new Set(placed.map(d => d.stored_direction))].sort((a, b) => a - b),
        // Guarded, because the empty case is exactly the one the controls above
        // exist to report: no direction placed anything, or the Lua pcall raised
        // before `created` was ever set. Reading `.bounding_box` off the
        // `undefined` that `find` answers throws here, and `controlsAllPassed`
        // is not consulted until after this whole literal is built - so the
        // total-failure case exited with a TypeError naming neither the probe
        // nor the failed control. `actualPosition` two lines up already guarded
        // the same emptiness; this was the one read that did not. Found by
        // review on PR #249, posted after the merge.
        runtimeCollisionBox: placed[0] !== undefined ? box(placed[0].bounding_box) : null,
        prototypeCollisionBox: dump.prototype_collision_box,
    },
    dataJsonVersusRuntime: {
        // The headline: the disagreement is not general, it is rails.
        entitiesCompared: quantised.length + disagreements.length,
        agreeWithinOneQuantum: quantised.length,
        quantum: QUANTUM,
        worstQuantisedDeviation: Math.max(...quantised.map(q => q.deviation)),
        disagreeBeyondQuantisation: disagreements.length,
        allDisagreementsAreRails: disagreements.every(d => d.name.includes('rail')),
        disagreements,
    },
    proposedChangeAgainstMeasuredOccupancy: scoreAgainstMeasuredOccupancy(disagreements),
}

writeResult(fixture)
if (
    !fixture.controlsAllPassed ||
    !fixture.proposedChangeAgainstMeasuredOccupancy.controlsAllPassed
) {
    console.error('\nA control failed. The numbers above are void rather than a finding.')
    process.exit(1)
}
