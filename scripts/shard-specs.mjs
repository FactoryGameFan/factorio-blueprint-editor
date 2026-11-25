// Splits the Playwright spec files across CI shards by measured duration,
// where `playwright test --shard=k/n` splits them by test count.
//
//   node scripts/shard-specs.mjs --shard <k> --total <n>   one `playwright test`
//                                                          argument per line on
//                                                          stdout (the shard's files,
//                                                          escaped), a summary on stderr
//   node scripts/shard-specs.mjs --shard <k> --total <n> --paths
//                                                          the same files as plain paths
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
// drift from playwright.config.ts the first time someone changed one. It runs
// Playwright's CLI with this node, from the repository root, not through npx.
//
// WHAT IS PRINTED IS NOT A PATH. Playwright reads each positional argument as a
// case-insensitive regular expression tested against the absolute path, so the
// script prints each file as an escaped, end-anchored pattern (`playwrightArg`)
// and refuses to run if any pattern would select anything but its own file.
// `--paths` prints the plain paths, for people.
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
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
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

/**
 * `playwright test --list --reporter=json`, parsed. Runs Playwright's own CLI
 * with the node that is running this script, from the repository root, so it
 * does not depend on `npx` (which reads the nearest package.json and stops
 * with EBADDEVENGINES when started from outside the repository) or on where
 * the caller's working directory is.
 */
export function listReport() {
    const cli = require.resolve('@playwright/test/cli')
    const stdout = execFileSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'inherit'],
    })
    return JSON.parse(stdout)
}

/** Runs `playwright test --list` and returns {file, tests}[]. */
export function listSpecFiles() {
    return specFilesFromReport(listReport())
}

/**
 * The key a test is known by in the timing data: its file and its title as the
 * list reporter prints it (describe titles joined with ` › `). A title that
 * repeats within a file gets `#2`, `#3`... so two tests are never merged.
 * `seen` is the caller's per-job (or per-listing) Map of counts.
 */
export function testKey(seen, file, title) {
    const key = `${file}\u0000${title}`
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return count === 1 ? key : `${key}#${count}`
}

/** Every test in a `--list` report, keyed as `testKey` does. */
export function testKeysFromReport(report, root = repoRoot) {
    const keys = new Set()
    const seen = new Map()
    const walk = (suite, file, titles) => {
        for (const spec of suite.specs ?? []) {
            keys.add(testKey(seen, file, [...titles, spec.title].join(' › ')))
        }
        for (const child of suite.suites ?? []) walk(child, file, [...titles, child.title])
    }
    for (const suite of report.suites ?? []) {
        const file = relative(root, join(report.config.rootDir, suite.file)).split(sep).join('/')
        walk(suite, file, [])
    }
    return keys
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

/** `text` with every regular-expression metacharacter escaped. */
export const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The command-line argument that selects exactly one spec file.
 *
 * Playwright does not read a positional argument as a path. It compiles it
 * with `new RegExp(arg, 'gi')` (case-insensitive, see `forceRegExp` in
 * playwright/lib/common) and tests it against the file's ABSOLUTE path, after
 * peeling a trailing `:line` or `:line:column` off it. So the path is escaped,
 * because an unescaped `a+b.spec.ts` or `e[1].spec.ts` matches no file at all
 * and Playwright runs nothing for it without a word, and anchored at the end,
 * because `tests/a.spec.ts` would otherwise also select `tests/a.spec.ts.bak`
 * or `tests/sub/tests/a.spec.ts`.
 */
export const playwrightArg = file => `${escapeRegExp(file)}$`

// Playwright's own two steps, copied from playwright/lib/common/index.js
// (`parseLocationArg`, `forceRegExp`) so the guard below sees an argument the
// way Playwright does. If Playwright changes them, the end-to-end check in the
// README ("Positional arguments are regular expressions") is what notices.
function compileLikePlaywright(arg) {
    const located = /^(.*?):(\d+):?(\d+)?$/.exec(arg)
    const pattern = located ? located[1] : arg
    const slashed = pattern.match(/^\/(.*)\/([gi]*)$/)
    return slashed ? new RegExp(slashed[1], slashed[2]) : new RegExp(pattern, 'gi')
}

/**
 * Problems with the arguments `playwrightArg` makes for these files, as
 * strings; empty means every argument selects exactly its own file and nothing
 * else. Each is compiled and tested the way Playwright does it, against
 * absolute paths. Two files whose paths differ only in case cannot pass: the
 * argument is case-insensitive, so no argument can pick one of them alone.
 * Refuse to run rather than run a file twice, or not at all.
 */
export function ambiguousPatterns(specs, root = repoRoot) {
    const problems = []
    for (const { file } of specs) {
        const arg = playwrightArg(file)
        const matched = specs
            .filter(other => compileLikePlaywright(arg).test(join(root, other.file)))
            .map(other => other.file)
        if (matched.length !== 1 || matched[0] !== file) {
            problems.push(
                `${file}: argument ${arg} selects ${matched.length === 0 ? 'nothing' : matched.join(', ')}`
            )
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
        } else if (flag === '--paths') {
            args.paths = true
        } else if (['--shard', '--total', '--durations'].includes(flag) && argv[i + 1]) {
            args[flag.slice(2)] = argv[++i]
        } else {
            throw new Error(
                'usage: node scripts/shard-specs.mjs --shard <k> --total <n> | --plan --total <n> ' +
                    '[--paths] [--durations <file>]'
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
    const lines = args.paths ? shard.files : shard.files.map(playwrightArg)
    process.stdout.write(lines.join('\n') + '\n')
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
