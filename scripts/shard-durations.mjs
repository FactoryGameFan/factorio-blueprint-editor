// Rebuilds tests/shard-durations.json from downloaded CI job logs of the
// Playwright shards. The file is what scripts/shard-specs.mjs balances on; see
// "Balancing the Playwright shards by duration" in .github/workflows/README.md
// for why it exists and for the full regeneration recipe.
//
//   node scripts/shard-durations.mjs --logs <dir> [--out tests/shard-durations.json]
//                                    [--source "<where the logs came from>"]
//
// <dir> holds one log file per Playwright job (any *.log name), as printed by
// `gh api --allow-escape-sequences repos/<owner>/<repo>/actions/jobs/<id>/logs`.
//
// WHY NOT JUST AVERAGE THE RAW DURATIONS. A GitHub runner's speed is not a
// property of this repository. Over nine runs of the same tests, one shard took
// anywhere from 8.1 to 17.1 minutes, so a raw median would mostly measure which
// runners the logs happened to land on. The fit below puts every job on a
// common scale first:
//
//   1. Start with every job at speed factor 1.
//   2. A test's base duration is the median over jobs of (duration / factor).
//   3. A job's factor is the median over its tests of (duration / base). Only
//      tests whose base is over 3 s vote, because the list reporter rounds
//      short ones and a 40 ms test reads as 50 ms.
//   4. Rescale so the median factor is 1, then repeat 2 to 4 eight times.
//
// So a factor of 1.5 means "this job's runner took 1.5x as long as the median
// runner". The committed durations are per-file sums of base durations: seconds
// on a median runner.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { comparePaths, listReport, testKey, testKeysFromReport } from './shard-specs.mjs'

const ITERATIONS = 8
const MIN_VOTING_SECONDS = 3

// `2026-11-25T04:39:28.0533130Z   ✓    1 tests/foo.spec.ts:37:1 › title (829ms)`
// Only a pass counts. A failure's duration is a timeout or a truncated run and
// a skipped test has none.
const TEST_LINE = /^\S+Z\s+✓\s+\d+ (tests\/.+?\.spec\.ts):\d+:\d+ › (.*) \(([\d.]+)(ms|s|m)\)\s*$/

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g

/** Median of a non-empty array of numbers. */
export function median(values) {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function toSeconds(amount, unit) {
    const value = Number(amount)
    if (unit === 'ms') return value / 1000
    if (unit === 'm') return value * 60
    return value
}

/**
 * The passing tests in one job log, as `{ file, title, seconds }`. A title that
 * appears twice in a file gets `#2`, `#3`... so the two are not merged into
 * one observation. Line numbers are left out of the key on purpose: the logs
 * come from different commits, and a line moves when anything above it does.
 */
export function parseJobLog(text) {
    const seen = new Map()
    const tests = []
    for (const raw of text.split('\n')) {
        const line = raw.replace(/^﻿/, '').replace(ANSI, '').trimEnd()
        const match = TEST_LINE.exec(line)
        if (!match) continue
        const [, file, title, amount, unit] = match
        const key = testKey(seen, file, title)
        tests.push({
            file,
            title: key.slice(file.length + 1),
            seconds: toSeconds(amount, unit),
        })
    }
    return tests
}

/**
 * Fits the speed model described at the top of this file.
 *
 * @param {Map<string, {file: string, title: string, seconds: number}[]>} jobs
 *   job name -> that job's passing tests
 * @param {Set<string> | undefined} current keys (`testKey`) of the tests that
 *   exist now. A test in the logs but not in it was renamed or deleted since the
 *   run, and counting it too would price one test twice. Omitted: keep all.
 * @returns {{ factors: Map<string, number>, files: Map<string, number>,
 *             tests: number }} `files` is file -> seconds on a median runner
 */
export function fitDurations(jobs, current) {
    // test key -> job -> seconds
    const observed = new Map()
    for (const [job, tests] of jobs) {
        for (const t of tests) {
            const key = `${t.file}\u0000${t.title}`
            if (current && !current.has(key)) continue
            if (!observed.has(key)) observed.set(key, new Map())
            observed.get(key).set(job, t.seconds)
        }
    }

    let factors = new Map([...jobs.keys()].map(job => [job, 1]))
    const base = new Map()
    const refreshBase = () => {
        for (const [key, byJob] of observed) {
            base.set(key, median([...byJob].map(([job, s]) => s / factors.get(job))))
        }
    }

    for (let i = 0; i < ITERATIONS; i++) {
        refreshBase()
        const ratios = new Map([...jobs.keys()].map(job => [job, []]))
        for (const [key, byJob] of observed) {
            if (base.get(key) <= MIN_VOTING_SECONDS) continue
            for (const [job, s] of byJob) ratios.get(job).push(s / base.get(key))
        }
        const next = new Map(factors)
        for (const [job, list] of ratios) if (list.length > 0) next.set(job, median(list))
        const scale = median([...next.values()])
        factors = new Map([...next].map(([job, f]) => [job, f / scale]))
    }
    refreshBase()

    const files = new Map()
    for (const [key, seconds] of base) {
        const file = key.slice(0, key.indexOf('\u0000'))
        files.set(file, (files.get(file) ?? 0) + seconds)
    }
    return { factors, files, tests: base.size }
}

const round1 = n => Math.round(n * 10) / 10

/** The object that gets written to tests/shard-durations.json. */
export function buildDurationsFile({ jobs, source, generated, current }) {
    const { files, tests } = fitDurations(jobs, current)
    // With nothing timed the fallback would be 0 / 0, which JSON writes as
    // null, and shard-specs.mjs refuses that file. Stop before anything is
    // written, so the committed file stays as it was.
    if (tests === 0) {
        throw new Error(
            'no test in the logs is in the current suite; check that the logs are recent and the checkout is current'
        )
    }
    let total = 0
    for (const seconds of files.values()) total += seconds
    return {
        about:
            `Seconds each Playwright spec file takes on a median GitHub runner, ` +
            `used by scripts/shard-specs.mjs to balance the CI shards by duration. ` +
            `Fitted from ${jobs.size} Playwright job logs (${source}) on ${generated}: each ` +
            `test's median duration after rescaling every job to a common runner ` +
            `speed, summed per file. Regenerate with: node scripts/shard-durations.mjs ` +
            `--logs <dir of job logs>. See .github/workflows/README.md.`,
        field_notes: {
            generated: 'Date the file was fitted, YYYY-MM-DD.',
            fallback_seconds_per_test:
                'Cost assumed per test for a spec file missing from "files". ' +
                `The mean over all ${tests} timed tests currently in the suite, so a new file is expected ` +
                'to cost what an average test costs.',
            files:
                'Repo-relative spec path -> seconds on a median runner. A path that ' +
                'no longer exists is ignored.',
        },
        generated,
        fallback_seconds_per_test: round1(total / tests),
        files: Object.fromEntries(
            [...files].sort(([a], [b]) => comparePaths(a, b)).map(([f, s]) => [f, round1(s)])
        ),
    }
}

function parseArgs(argv) {
    const args = { out: 'tests/shard-durations.json' }
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i]
        const value = argv[i + 1]
        if (!['--logs', '--out', '--source'].includes(flag) || value === undefined) {
            throw new Error(
                'usage: node scripts/shard-durations.mjs --logs <dir> [--out <file>] [--source <text>]'
            )
        }
        args[flag.slice(2)] = value
        i++
    }
    if (!args.logs) throw new Error('--logs <dir> is required')
    return args
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    const jobs = new Map()
    for (const name of readdirSync(args.logs).sort(comparePaths)) {
        if (!name.endsWith('.log')) continue
        const tests = parseJobLog(readFileSync(join(args.logs, name), 'utf8'))
        if (tests.length > 0) jobs.set(name, tests)
    }
    if (jobs.size === 0) throw new Error(`no Playwright test lines found in ${args.logs}/*.log`)
    // Only tests that exist now, from the checkout this runs in. Logs come from
    // older commits, and a test renamed since would otherwise be timed twice.
    const current = testKeysFromReport(listReport())
    const result = buildDurationsFile({
        jobs,
        source: args.source ?? `${jobs.size} logs`,
        generated: new Date().toISOString().slice(0, 10),
        current,
    })
    writeFileSync(args.out, JSON.stringify(result, null, 4) + '\n')
    const { factors } = fitDurations(jobs, current)
    const speeds = [...factors.values()].sort((a, b) => a - b)
    const timed = new Set(
        [...jobs.values()].flatMap(tests => tests.map(t => `${t.file}\u0000${t.title}`))
    )
    const untimed = [...current].filter(key => !timed.has(key)).length
    console.log(
        `wrote ${args.out}: ${Object.keys(result.files).length} files from ${jobs.size} jobs; ` +
            `runner speed factor ${speeds[0].toFixed(2)} to ${speeds.at(-1).toFixed(2)} ` +
            `(1.00 = median runner); ${current.size} tests exist now, ` +
            `${untimed} of them in no log`
    )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    try {
        main()
    } catch (error) {
        console.error(error.message)
        process.exit(1)
    }
}
