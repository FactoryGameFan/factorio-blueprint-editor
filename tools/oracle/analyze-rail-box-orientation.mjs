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
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'rail-box-orientation.json')
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
const dump = JSON.parse(readFileSync(dumpPath, 'utf8'))
const fd = JSON.parse(readFileSync(DATA_JSON, 'utf8')).entities

const box = b => [b.left_top.x, b.left_top.y, b.right_bottom.x, b.right_bottom.y]

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
    issue: 'de-risking run 2 of probe-blueprint-grid-position-gui; bears on PR #243 finding 15',
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
        runtimeCollisionBox: box(dump.directions.find(d => d.created).bounding_box),
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
}

const json = JSON.stringify(fixture, null, 4)
if (process.argv.includes('--write-fixture')) {
    writeFileSync(FIXTURE, json + '\n')
    console.log(`wrote ${FIXTURE}`)
} else {
    console.log(json)
}
if (!fixture.controlsAllPassed) {
    console.error('\nA control failed. The numbers above are void rather than a finding.')
    process.exit(1)
}
