#!/usr/bin/env node
/**
 * Scores what the blueprint GUI's "Grid position" field did, from the capture
 * stream `probe-blueprint-grid-position-gui/control.lua` wrote.
 *
 * The split is issue #235's: `factorio-oracle` ran the game and handed back a
 * work directory; this half is the analysis, and it stays here because it
 * compares the game against *this editor's own* reimplementation, which only
 * makes sense in this repo's terms.
 *
 * Usage:
 *   node tools/oracle/analyze-blueprint-grid-position-gui.mjs <work-dir> [options]
 *
 *     --run <report.json>   the JSON `factorio-oracle run` printed. Preferred:
 *                           it names the script-output directory outright, and
 *                           carries the binary path, the Factorio version and
 *                           the mods that actually loaded, so the fixture's
 *                           provenance is read rather than asserted.
 *     --write-fixture       write fixtures/blueprint-grid-position-gui.json
 *
 * Without `--run`, the capture stream is looked for at the conventional
 * `<work-dir>/write/script-output/grid-position-gui.jsonl`.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'blueprint-grid-position-gui.json')

/**
 * The entities this probe's layout uses, and their tile footprints.
 *
 * Hardcoded rather than read from `data.json`, because the layout is owned by
 * the probe next door rather than discovered: these are the sizes it placed,
 * and a `data.json` that disagreed would mean the exporter had drifted, not
 * that the measurement should change.
 *
 * A name reaching `corners()` without an entry here used to default to 1x1
 * silently, which is the worst possible failure for this file: a 1x1 default
 * puts the edge half a tile from the centre, so `entityEdges*` collapses
 * towards `entityCentres*` and the discrimination the whole probe exists for
 * quietly stops working, with `controlsAllPassed: true` and nothing said.
 * `unsizedEntities` below turns that into a failed control instead. Found by
 * review on PR #249, and it is not hypothetical - `half-diagonal-rail` was
 * added to this table and to the layout in the same change, and had it been
 * missed the run would have reported a clean answer to the wrong question.
 *
 * `box` is the prototype's `collision_box`, carried so the *third* candidate
 * corner can be computed. Run 1 established the corner is read from an edge
 * rather than a centre, and could not say which edge, because for every entity
 * it placed the footprint edge and the collision edge floor to the same
 * integer - `assembling-machine-1` is 9.0 against 9.3.
 *
 * `half-diagonal-rail` is what settles it, and it is close to unique. The
 * editor derives a footprint by *ceiling* the collision box
 * (`factorioData.ts:617`), so a box cannot escape its own footprint unless a
 * declared `tile_width`/`tile_height` overrides that. Five of the 155 entities
 * in `data.json` manage it, and this is the only one that splits all three
 * readings apart on a single axis: at its snapped centre of y=21 it gives
 * centre 21, footprint edge 20, collision edge 19.102. `offshore-pump` separates the two
 * edges but not centre from footprint edge, being 1x1.
 */
const GEOMETRY = {
    'assembling-machine-1': { w: 3, h: 3, box: [-1.2, -1.2] },
    'wooden-chest': { w: 1, h: 1, box: [-0.35, -0.35] },
    // Measured, not read from data.json. `rail-box-orientation.json` found
    // that data.json and the 2.0.77 runtime disagree about this box - 2.236
    // against 1.8984375 - and that all 16 such disagreements across 155
    // entities are rails. The game is what this probe compares against, so
    // the game's number is the one that belongs here.
    'half-diagonal-rail': { w: 2, h: 2, box: [-0.75, -1.8984375] },
}

/** Names seen in a capture that `GEOMETRY` has no entry for. */
const unsizedEntities = new Set()

function decodeBlueprintString(str) {
    return JSON.parse(inflateSync(Buffer.from(str.slice(1), 'base64')).toString('utf8'))
}

/**
 * Provenance the runner recorded, rather than anything this script inferred.
 * Returns undefined when no run report was passed, in which case the fixture
 * says so instead of carrying a guess - a fixture's provenance is a record of
 * the moment it was captured, and a plausible-looking blank is worse than an
 * admitted one.
 */
function readRunReport(path) {
    if (path === undefined) return undefined
    // A missing report is the ordinary mistake, not a corrupt one: running the
    // analysis before the probe, or after a run that never reached the game.
    // Without this it surfaces as a raw ENOENT stack trace out of node:fs,
    // which names the path and nothing about what to do. Measured: it happened
    // the first time run 2 was attempted.
    if (!existsSync(path)) {
        throw new Error(
            `No run report at ${path}.\n` +
                `That file is written by \`factorio-oracle run\`, so this usually means ` +
                `the probe has not been run yet - the analysis is step 3 of SESSION.md, ` +
                `not step 1.`
        )
    }
    const report = JSON.parse(readFileSync(path, 'utf8'))
    return {
        scriptOutput: report.scriptOutput,
        binaryPath: report.provenance?.binaryPath,
        factorioVersion: report.provenance?.factorioVersion,
        loadedMods: report.loadedMods,
    }
}

function readStream(workDir, run) {
    // The usage guard accepts --work-dir OR --run, so a run report that carries
    // no `scriptOutput` leaves nothing to join against. Without this, join()
    // throws ERR_INVALID_ARG_TYPE on undefined and buries the real problem -
    // a partial or malformed run report - under a stack trace about paths.
    if (run?.scriptOutput === undefined && workDir === undefined) {
        throw new Error(
            'No script-output directory: the run report carries no scriptOutput, ' +
                'and no --work-dir was given to fall back on. The run probably did ' +
                'not get far enough to write one.'
        )
    }
    const path =
        run?.scriptOutput !== undefined
            ? join(run.scriptOutput, 'grid-position-gui.jsonl')
            : join(workDir, 'write', 'script-output', 'grid-position-gui.jsonl')
    if (!existsSync(path)) {
        throw new Error(
            `No capture stream at ${path}.\n` +
                `Did the run reach the game? An interactive run writes nothing until ` +
                `the mod loads, and a factorio_version mismatch skips the mod in silence.`
        )
    }
    return readFileSync(path, 'utf8')
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => JSON.parse(line))
}

/**
 * Lua's JSON encoder writes an empty table as `{}`, so a blueprint with no
 * tiles arrives as an object rather than an array - the same trap
 * `factorioData.ts` documents for `data.json`, one layer out.
 */
function asArray(value) {
    return Array.isArray(value) ? value : []
}

/** The five readings of "the minimum corner" this probe exists to separate. */
function corners(entities, tiles) {
    const eCentreX = entities.map(e => e.position.x)
    const eCentreY = entities.map(e => e.position.y)
    for (const e of entities) {
        if (GEOMETRY[e.name] === undefined) unsizedEntities.add(e.name)
    }
    const eEdgeX = entities.map(e => e.position.x - (GEOMETRY[e.name]?.w ?? 1) / 2)
    const eEdgeY = entities.map(e => e.position.y - (GEOMETRY[e.name]?.h ?? 1) / 2)
    // The collision box's own minimum, which for most entities sits inside the
    // footprint and floors to the same integer. Where it does not, this is the
    // reading that tells the two apart.
    const eBoxX = entities.map(e => e.position.x + (GEOMETRY[e.name]?.box[0] ?? -0.5))
    const eBoxY = entities.map(e => e.position.y + (GEOMETRY[e.name]?.box[1] ?? -0.5))
    const tX = tiles.map(t => t.position.x)
    const tY = tiles.map(t => t.position.y)

    const min = xs => (xs.length === 0 ? undefined : Math.min(...xs))
    const neg = v => (v === undefined ? undefined : -Math.floor(v))

    return {
        // What packages/editor/src/core/Blueprint.ts ships today.
        entityCentresAndTiles: {
            x: neg(min([...eCentreX, ...tX])),
            y: neg(min([...eCentreY, ...tY])),
        },
        entityEdgesAndTiles: {
            x: neg(min([...eEdgeX, ...tX])),
            y: neg(min([...eEdgeY, ...tY])),
        },
        entityCollisionEdgesAndTiles: {
            x: neg(min([...eBoxX, ...tX])),
            y: neg(min([...eBoxY, ...tY])),
        },
        entityCentresOnly: { x: neg(min(eCentreX)), y: neg(min(eCentreY)) },
        entityEdgesOnly: { x: neg(min(eEdgeX)), y: neg(min(eEdgeY)) },
    }
}

/**
 * What each labelled step was asked to set, so a row can be scored rather than
 * merely displayed. Keys match the labels control.lua prints in its on-screen
 * instructions; anything else is carried through unscored rather than guessed
 * at, which is what #133 item 4 asks for.
 */
const EXPECTED = {
    untouched: { gridPosition: undefined },
    'snap-on': { gridPosition: undefined },
    'gridpos-3-5': { gridPosition: { x: 3, y: 5 } },
    'gridpos-8-9': { gridPosition: { x: 8, y: 9 } },
    'gridpos-0-0': { gridPosition: { x: 0, y: 0 } },
    'abs-2-6': { gridPosition: { x: 0, y: 0 }, positionRelativeToGrid: { x: 2, y: 6 } },
    'snap-off': { gridPosition: undefined },
}

/**
 * What a step was asked to set, for the label given.
 *
 * Any `gridpos-<x>-<y>` label is read from its own numbers rather than looked
 * up, because **the game refuses some values and the session says to
 * substitute**: the parity rule ("Grid position and blueprint grid position
 * coordinates need to be either all even or all odd") rejected 3,5 outright on
 * run 2's layout, having accepted it on run 1's. SESSION.md already told the
 * operator to use the nearest accepted value and record it, and until now the
 * analysis could not read anything but the three labels it happened to know -
 * so following that instruction produced an unscored row and a session that
 * measured nothing. Negative values are allowed: `gridpos--3-5` is x=-3, y=5.
 */
/**
 * The one place a `gridpos-` label is recognised. Named rather than repeated,
 * because `stepsNotCaptured` below has to agree with `expectedFor` about what
 * counts as one, and a rule written down twice is a rule that drifts - the
 * looser copy silently wins. Its first casualty is in the note there.
 */
const GRIDPOS_LABEL = /^gridpos-(-?\d+)-(-?\d+)$/

function expectedFor(label) {
    const m = GRIDPOS_LABEL.exec(label)
    if (m) return { gridPosition: { x: Number(m[1]), y: Number(m[2]) } }
    return EXPECTED[label]
}

function pointsEqual(a, b) {
    if (a === undefined || b === undefined) return a === b
    return a.x === b.x && a.y === b.y
}

function scoreControls(rows) {
    const byLabel = new Map(rows.filter(r => r.kind === 'capture').map(r => [r.label, r]))
    const out = []

    const r1 = byLabel.get('control-instrument-repeat-1')
    const r2 = byLabel.get('control-instrument-repeat-2')
    out.push({
        name: 'instrument: two captures with nothing changed are identical',
        ok: Boolean(r1 && r2 && r1.export === r2.export),
        detail:
            r1 && r2
                ? r1.export === r2.export
                    ? 'exports byte-identical'
                    : 'exports DIFFER with no change made - every "it moved" row below is void'
                : 'missing one or both repeat captures',
    })

    const base = r1
    const shifted = byLabel.get('control-positive-shift')
    let movedOk = false
    let movedDetail = 'missing the shift control'
    if (base && shifted) {
        // Read through the *decoded export*, not through `capture()`'s
        // `entities` field. Those are two different instruments -
        // `get_blueprint_entities()` and `export_stack()` - and every scored
        // row below is read from the export. Checking the other one proved the
        // wrong instrument could see a shift: a stale or unresponsive
        // `export_stack()` would leave this control passing, `instrument-repeat`
        // trivially passing on two identical stale exports, and the probe
        // reporting a confident `survivingReadings: []` with nothing flagged.
        // The `rival-field` control below already read the export, so this file
        // disagreed with itself. Found by review on PR #249.
        const positions = row =>
            asArray(decodeBlueprintString(row.export).blueprint?.entities).map(
                e => `${e.position.x},${e.position.y}`
            )
        const a = positions(base)
        const b = positions(shifted)
        movedOk = a.length > 0 && b.length > 0 && a.join('|') !== b.join('|')
        movedDetail = `baseline ${a.join(' ')} vs script-shifted ${b.join(' ')}`
    }
    out.push({
        name: 'positive control: the comparison can see a shift at all',
        ok: movedOk,
        detail: movedDetail,
    })

    const rival = byLabel.get('control-rival-field')
    let rivalOk = false
    let rivalDetail = 'missing the rival-field control'
    if (rival) {
        const bp = decodeBlueprintString(rival.export).blueprint ?? {}
        rivalOk = pointsEqual(bp['position-relative-to-grid'], { x: 3, y: 5 })
        rivalDetail =
            `script set position_relative_to_grid={3,5}; export carries ` +
            `${JSON.stringify(bp['position-relative-to-grid'])}, ` +
            `absolute-snapping=${JSON.stringify(bp['absolute-snapping'])}, ` +
            `snap-to-grid=${JSON.stringify(bp['snap-to-grid'])}`
    }
    out.push({
        name: 'rival field: the neighbouring field is reachable and does serialize',
        ok: rivalOk,
        detail: rivalDetail,
    })

    return out
}

function main() {
    const argv = process.argv.slice(2)
    const flags = argv.filter(a => a.startsWith('--'))
    const positional = argv.filter(a => !a.startsWith('--'))
    const runIndex = argv.indexOf('--run')
    const runPath = runIndex === -1 ? undefined : argv[runIndex + 1]
    const workDir = positional.find(p => p !== runPath)

    if (workDir === undefined && runPath === undefined) {
        console.error(
            'usage: node tools/oracle/analyze-blueprint-grid-position-gui.mjs <work-dir> ' +
                '[--run <report.json>] [--write-fixture]'
        )
        process.exit(2)
    }

    const run = readRunReport(runPath)
    const rows = readStream(workDir, run)
    const setup = rows.find(r => r.kind === 'setup')
    const notes = rows.filter(r => r.kind === 'note').map(r => r.text)
    const controls = scoreControls(rows)

    const cases = rows
        .filter(r => r.kind === 'capture' && r.tag === 'human')
        .map(row => {
            const decoded = decodeBlueprintString(row.export).blueprint ?? {}
            const entities = asArray(decoded.entities)
            const tiles = asArray(decoded.tiles)
            const readings = corners(entities, tiles)
            const expected = expectedFor(row.label)

            const scored = expected?.gridPosition !== undefined
            const agrees = scored
                ? Object.fromEntries(
                      Object.entries(readings).map(([k, v]) => [
                          k,
                          pointsEqual(v, expected.gridPosition),
                      ])
                  )
                : undefined

            return {
                label: row.label,
                typedGridPosition: expected?.gridPosition,
                scored,
                exportedKeys: {
                    'snap-to-grid': decoded['snap-to-grid'],
                    'absolute-snapping': decoded['absolute-snapping'],
                    'position-relative-to-grid': decoded['position-relative-to-grid'],
                },
                exportedEntityPositions: entities.map(e => ({
                    name: e.name,
                    x: e.position.x,
                    y: e.position.y,
                })),
                exportedTilePositions: tiles.map(t => ({ x: t.position.x, y: t.position.y })),
                minCornerReadings: readings,
                agrees,
            }
        })

    // docs/method.md: report the rules that survive *every* row, not the one
    // that fits the last result.
    //
    // The zero-row case is handled separately and deliberately. `every()` on an
    // empty list is true, so a session that captured no scored step would
    // report all four readings as surviving - four confident answers drawn from
    // no evidence, which is the exact shape of a control that cannot fail. A
    // session that got no further than the controls has measured nothing, and
    // has to say so.
    const scoredCases = cases.filter(c => c.scored)
    const readingNames = Object.keys(corners([], []))
    const survivors =
        scoredCases.length === 0
            ? undefined
            : readingNames.filter(name => scoredCases.every(c => c.agrees?.[name] === true))

    const movedRelativeToUntouched = (() => {
        const baseline = cases.find(c => c.label === 'untouched')
        if (!baseline) return undefined
        return cases
            .filter(c => c !== baseline)
            .map(c => ({
                label: c.label,
                moved:
                    JSON.stringify(c.exportedEntityPositions) !==
                    JSON.stringify(baseline.exportedEntityPositions),
            }))
    })()

    // Which steps the session never reached. An interactive probe ends when the
    // person stops playing, so a fixture that simply omits them reads as "these
    // steps do not exist" rather than "these steps were not run" - the silent
    // cap docs/method.md warns about. Named here so a reader can tell a gap
    // from a finding.
    // A refused value means the operator captured `gridpos-4-6` in place of
    // `gridpos-3-5`. Reporting the asked-for label as "not captured" would read
    // as a skipped step rather than a substituted one.
    //
    // Nothing records *which* asked-for step a substitution replaced, so this
    // counts instead: each substitution excuses exactly one missing `gridpos-`
    // step, spent in `EXPECTED` key order, which is the order SESSION.md walks
    // them. It was a bare boolean suppressing the whole `gridpos-` class, and
    // that hid a real gap in this probe's own fixture - two substitutions
    // (2,6 and 8,10) excused all three missing steps, so `gridpos-0-0`, the one
    // genuinely skipped and the one that establishes the non-default check,
    // vanished from `stepsNotCaptured` rather than being named. Exactly the
    // silent cap the note below warns about, in the code written to prevent it.
    // Found by review on PR #249, posted after the merge.
    let substitutionCredits = cases.filter(
        c => GRIDPOS_LABEL.test(c.label) && EXPECTED[c.label] === undefined
    ).length
    const stepsNotCaptured = Object.keys(EXPECTED).filter(label => {
        if (cases.some(c => c.label === label)) return false
        if (GRIDPOS_LABEL.test(label) && substitutionCredits > 0) {
            substitutionCredits -= 1
            return false
        }
        return true
    })

    // Pushed here rather than inside scoreControls(), because GEOMETRY coverage is
    // only known once corners() has walked every capture, and that happens
    // while building `cases` above.
    controls.push({
        name: 'every entity in a capture has a known footprint',
        ok: unsizedEntities.size === 0,
        detail:
            unsizedEntities.size === 0
                ? `all entity names matched GEOMETRY (${Object.keys(GEOMETRY).join(', ')})`
                : `no footprint for ${[...unsizedEntities].join(', ')} - the edge readings ` +
                  `for these defaulted to 1x1 and collapsed towards the centre readings, ` +
                  `so the numbers below cannot separate edges from centres`,
    })

    const fixture = {
        probe: 'probe-blueprint-grid-position-gui/control.lua',
        // What was on the ground, read from the run's own setup emit rather
        // than from the probe's current LAYOUT constant. A fixture measured
        // against one layout must not read as though it described a later one.
        layout: setup?.layout,
        runner: 'factorio-oracle run --probe tools/oracle/probe-blueprint-grid-position-gui/probe.json',
        question:
            'What does the blueprint GUI\'s "Grid position" field do to an exported blueprint string?',
        issue: '#235 (shared oracle CLI), reviewing PR #243',
        provenance: {
            capturedOn: new Date().toISOString().slice(0, 10),
            method: 'interactive: a person drove the blueprint GUI, the mod captured after each step',
            binary: run?.binaryPath ?? 'unrecorded - re-run the analysis with --run <report.json>',
            factorioVersion:
                run?.factorioVersion ?? 'unrecorded - re-run the analysis with --run <report.json>',
            loadedMods: run?.loadedMods,
            // What the mod itself saw, which is not the same list: per
            // factorio-oracle's gotchas, `script.active_mods` never reports
            // `core`, so the two disagreeing by exactly that is expected.
            activeModsSeenByMod: setup?.active_mods,
            evidence: 'captured',
            caveat:
                'The GUI field has no scripting API on 2.0.77 (runtime-api.json exposes only ' +
                'blueprint_snap_to_grid, blueprint_absolute_snapping and ' +
                'blueprint_position_relative_to_grid), so this cannot be re-captured headlessly.',
        },
        supersedes: {
            fixture: 'blueprint-grid-position.json',
            why:
                "That capture set blueprint_position_relative_to_grid, which the game's own " +
                'locale separates from this field in one line - core.cfg:274, "Grid position and ' +
                'blueprint grid position coordinates need to be either all even or all odd". Its ' +
                'answer is about the neighbouring field and stands; it is not an answer to this ' +
                'question.',
        },
        rivalReadings: {
            entityCentresAndTiles:
                'what packages/editor/src/core/Blueprint.ts getGridPositionDisplay() ships',
            entityEdgesAndTiles:
                "the same, reading the edge of an entity's tile footprint rather than its centre",
            entityCollisionEdgesAndTiles:
                "the same again, reading the edge of the entity's collision_box. " +
                'Indistinguishable from entityEdgesAndTiles unless the layout holds an ' +
                'entity whose box escapes its own footprint, which is why run 1 could ' +
                'not separate them and left both standing',
            entityCentresOnly: 'entities only, tiles ignored',
            entityEdgesOnly: 'entities only, footprint edges',
        },
        controls,
        controlsAllPassed: controls.every(c => c.ok),
        survivingReadings: survivors ?? 'unmeasured - no scored step was captured',
        scoredRows: scoredCases.length,
        stepsNotCaptured,
        movedRelativeToUntouched,
        notes,
        cases,
    }

    const json = JSON.stringify(fixture, null, 4)

    if (flags.includes('--write-fixture')) {
        writeFileSync(FIXTURE, json + '\n')
        console.log(`wrote ${FIXTURE}`)
    } else {
        console.log(json)
    }

    if (!fixture.controlsAllPassed) {
        console.error(
            '\nA control failed. Per docs/method.md, record the section its control voids as ' +
                'unmeasured rather than reading the numbers as a finding.'
        )
        process.exit(1)
    }
}

main()
