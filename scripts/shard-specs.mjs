// Splits the Playwright spec files across CI shards by measured duration,
// where `playwright test --shard=k/n` splits them by test count.
//
//   node scripts/shard-specs.mjs --shard <k> --total <n>   one file path per line on
//                                                          stdout, a summary on stderr
//   node scripts/shard-specs.mjs --plan --total <n>        every shard's files, tests
//                                                          and predicted minutes
//
// Why: the specs are not uniform. By test count shard 2 of 4 held about 4.5 s
// of work per test against about 3 s on shards 3 and 4, so it was always the
// slowest. See "Balancing the Playwright shards by duration" in
// .github/workflows/README.md for the measurements.
//
// WHERE THE FILE LIST COMES FROM. `playwright test --list --reporter=json`, so
// the script sees exactly the files Playwright would run, through the same
// `testDir`, `testMatch` and any future `testIgnore`. A glob of its own would
// drift from playwright.config.ts the first time someone changed one.
//
// WHERE THE DURATIONS COME FROM. tests/shard-durations.json, written by
// scripts/shard-durations.mjs. A spec file that is not in it costs
// `fallback_seconds_per_test` for each of its tests; a path in it that no
// longer exists is ignored. A stale file therefore unbalances the shards but
// can never drop or duplicate a spec.
//
// THE ASSIGNMENT. Longest file first onto the currently lightest shard (the
// LPT rule). Ties go to the file whose path sorts first, and to the lowest
// shard number. It is deterministic, and every shard job recomputes the whole
// assignment from the same inputs, so the n jobs agree without sharing state:
// every file lands on exactly one of them.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_DURATIONS = join(repoRoot, 'tests', 'shard-durations.json')

/** Orders paths by code unit, the same on every machine (unlike localeCompare). */
export const comparePaths = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The spec files in a `--reporter=json --list` report, as repo-relative posix
 * paths with how many tests each holds, sorted by path. The report's file names
 * are relative to Playwright's `rootDir`, which is the config's `testDir`.
 */
export function specFilesFromReport(report, root = repoRoot) {
    if (report.errors?.length) {
        throw new Error(`playwright --list reported errors: ${JSON.stringify(report.errors)}`)
    }
    const countTests = suite =>
        (suite.specs ?? []).reduce((sum, spec) => sum + (spec.tests?.length ?? 1), 0) +
        (suite.suites ?? []).reduce((sum, child) => sum + countTests(child), 0)

    const files = new Map()
    for (const suite of report.suites ?? []) {
        const absolute = join(report.config.rootDir, suite.file)
        const file = relative(root, absolute).split(sep).join('/')
        files.set(file, (files.get(file) ?? 0) + countTests(suite))
    }
    return [...files]
        .map(([file, tests]) => ({ file, tests }))
        .sort((a, b) => comparePaths(a.file, b.file))
}

/** Runs `playwright test --list` and returns {file, tests}[]. */
export function listSpecFiles() {
    const stdout = execFileSync(
        'npx',
        ['--no', 'playwright', 'test', '--list', '--reporter=json'],
        {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: 256 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'inherit'],
        }
    )
    return specFilesFromReport(JSON.parse(stdout))
}

/** Reads and checks a durations file. */
export function loadDurations(path = DEFAULT_DURATIONS) {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const fallback = data.fallback_seconds_per_test
    if (!Number.isFinite(fallback) || fallback <= 0) {
        throw new Error(`${path}: fallback_seconds_per_test must be a positive number`)
    }
    for (const [file, seconds] of Object.entries(data.files ?? {})) {
        if (!Number.isFinite(seconds) || seconds < 0) {
            throw new Error(`${path}: ${file} has a bad duration (${seconds})`)
        }
    }
    return { files: data.files ?? {}, fallback }
}

/**
 * Seconds a file is expected to take. A timed file uses its recorded figure; an
 * unknown one costs `fallback` per test, so a new file is not mistaken for free.
 */
export function estimateSeconds({ file, tests }, durations) {
    return Object.hasOwn(durations.files, file) ? durations.files[file] : tests * durations.fallback
}

/**
 * Longest-first assignment of files to `total` shards.
 *
 * @param {{file: string, tests: number}[]} specs every spec file once
 * @returns {{shard: number, files: string[], tests: number, seconds: number}[]}
 *   one entry per shard, `shard` counted from 1, files sorted by path
 */
export function assignShards(specs, durations, total) {
    if (!Number.isInteger(total) || total < 1) throw new Error(`bad shard total: ${total}`)
    const weighted = specs
        .map(spec => ({ ...spec, seconds: estimateSeconds(spec, durations) }))
        .sort((a, b) => b.seconds - a.seconds || comparePaths(a.file, b.file))
    const shards = Array.from({ length: total }, (_, i) => ({
        shard: i + 1,
        files: [],
        tests: 0,
        seconds: 0,
    }))
    for (const spec of weighted) {
        let lightest = shards[0]
        for (const shard of shards) if (shard.seconds < lightest.seconds) lightest = shard
        lightest.files.push(spec.file)
        lightest.tests += spec.tests
        lightest.seconds += spec.seconds
    }
    for (const shard of shards) shard.files.sort(comparePaths)
    return shards
}

/**
 * Playwright reads a positional argument as a regular expression matched
 * against the whole path, not as a path. So `tests/a.spec.ts` would also pick
 * up a `tests/aXspec.ts` one day. Refuse to run rather than run a file twice.
 */
export function ambiguousPatterns(specs) {
    const problems = []
    for (const { file } of specs) {
        const pattern = new RegExp(file)
        for (const other of specs) {
            if (other.file !== file && pattern.test(`/${other.file}`)) {
                problems.push(`${file} also matches ${other.file}`)
            }
        }
    }
    return problems
}

/** The files for shard `k` of `total`. Throws when there are none. */
export function selectShard(specs, durations, k, total) {
    if (!Number.isInteger(k) || k < 1 || k > total) {
        throw new Error(`shard must be an integer from 1 to ${total}, got ${k}`)
    }
    const shard = assignShards(specs, durations, total)[k - 1]
    // An empty list must stop here. `npx playwright test` with no arguments
    // runs the whole suite, so a shard with nothing to do would quietly run
    // everything instead of nothing.
    if (shard.files.length === 0) {
        throw new Error(
            `shard ${k}/${total} has no spec files (${specs.length} files in total). ` +
                'Lower the shard count in the ci.yml matrix.'
        )
    }
    return shard
}

function parseArgs(argv) {
    const args = { durations: DEFAULT_DURATIONS, plan: false }
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i]
        if (flag === '--plan') {
            args.plan = true
        } else if (['--shard', '--total', '--durations'].includes(flag) && argv[i + 1]) {
            args[flag.slice(2)] = argv[++i]
        } else {
            throw new Error(
                'usage: node scripts/shard-specs.mjs --shard <k> --total <n> | --plan --total <n> ' +
                    '[--durations <file>]'
            )
        }
    }
    args.total = Number(args.total)
    if (!Number.isInteger(args.total) || args.total < 1) throw new Error('--total <n> is required')
    if (!args.plan) args.shard = Number(args.shard)
    return args
}

const minutes = seconds => (seconds / 60).toFixed(1)

function main() {
    const args = parseArgs(process.argv.slice(2))
    const specs = listSpecFiles()
    const durations = loadDurations(args.durations)
    const collisions = ambiguousPatterns(specs)
    if (collisions.length > 0) throw new Error(collisions.join('\n'))

    if (args.plan) {
        for (const s of assignShards(specs, durations, args.total)) {
            console.log(
                `shard ${s.shard}/${args.total}: ${String(s.files.length).padStart(2)} files, ` +
                    `${String(s.tests).padStart(3)} tests, predicted ${minutes(s.seconds)} min of tests`
            )
        }
        const unknown = specs.filter(({ file }) => !Object.hasOwn(durations.files, file))
        console.log(
            `files without a recorded duration: ${unknown.map(s => s.file).join(', ') || 'none'}`
        )
        return
    }

    const shard = selectShard(specs, durations, args.shard, args.total)
    process.stdout.write(shard.files.join('\n') + '\n')
    console.error(
        `shard ${args.shard}/${args.total}: ${shard.files.length} of ${specs.length} files, ` +
            `${shard.tests} tests, predicted ${minutes(shard.seconds)} min of tests on a median runner`
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
