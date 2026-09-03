import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Runs the analyzer's rescore path over the committed fixture.
 *
 * The analyzer is a script rather than a module - it reads `process.argv` at
 * the top level and ends in `process.exit` - so this spawns it the way a person
 * would. Feeding it the committed fixture recomputes the occupancy comparison
 * against `fixtures/rail-occupancy.json` without needing Factorio, which is the
 * whole reason that path exists.
 *
 * Without this file the analyzer's three controls ran only by hand. They exist
 * to catch a transcription error in `sizeFromBox`, `swapForDirection` or
 * `keyedCells`, and a control nothing invokes reports nothing.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ANALYZER = join(HERE, 'analyze-rail-box-orientation.mjs')
const FIXTURE = join(HERE, 'fixtures', 'rail-box-orientation.json')

let cached
const rescore = () => {
    cached ??= execFileSync(process.execPath, [ANALYZER, FIXTURE], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    })
    return cached
}

test('every control on the occupancy comparison passes', () => {
    const scored = JSON.parse(rescore()).proposedChangeAgainstMeasuredOccupancy
    // Named rather than counted, so a failure says which control voided the
    // numbers instead of only that one did.
    assert.deepEqual(
        scored.controls.filter(c => !c.ok).map(c => `${c.name}: ${c.detail}`),
        []
    )
    assert.equal(scored.controlsAllPassed, true)
})

test('the committed fixture is what the analyzer produces from it', () => {
    // The analyzer is deterministic on this path, so any drift in
    // packages/exporter/data/output/data.json or in either fixture it reads
    // shows up here as a diff rather than silently restating a stale finding.
    assert.equal(rescore(), readFileSync(FIXTURE, 'utf8'))
})

test('the runtime boxes trade one error for another rather than improving', () => {
    const scored = JSON.parse(rescore()).proposedChangeAgainstMeasuredOccupancy
    assert.deepEqual(scored.arms, {
        today: { missed: 180, empty: 96 },
        runtimeBoxes: { missed: 220, empty: 56 },
    })
    assert.equal(scored.adoptingRuntimeBoxesIsImprovement, false)
})

test('the 16 disagreements split 12 unchanged, 3 masked and 1 changed', () => {
    const scored = JSON.parse(rescore()).proposedChangeAgainstMeasuredOccupancy
    assert.equal(scored.collisionBoxDisagreements, 16)
    assert.equal(scored.unchangedFootprints, 12)
    assert.deepEqual(
        scored.maskedByDeclaredDimension.map(f => f.name),
        ['half-diagonal-rail', 'dummy-elevated-half-diagonal-rail', 'elevated-half-diagonal-rail']
    )
    assert.deepEqual(
        scored.footprintChanges.map(f => f.name),
        ['legacy-curved-rail']
    )
    // The masking is the finding, not the equality: these three enclose
    // different rectangles and only agree because data.json declares a
    // tile_height for them. Assert the raw sizes so that stays visible.
    for (const f of scored.maskedByDeclaredDimension) {
        assert.deepEqual(f.rawToday, { x: 2, y: 5 })
        assert.deepEqual(f.rawRuntime, { x: 2, y: 4 })
        assert.equal(f.declared.tile_height, 2)
        assert.deepEqual(f.today, f.runtime)
    }
})
