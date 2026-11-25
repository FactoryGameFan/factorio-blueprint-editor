import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    ambiguousPatterns,
    assignShards,
    comparePaths,
    escapeRegExp,
    estimateSeconds,
    playwrightArg,
    selectShard,
    specFilesFromReport,
    testKeysFromReport,
} from './shard-specs.mjs'

const spec = (file, tests = 1) => ({ file, tests })

// Twelve files with distinct sizes. The best 3-way split is known by hand: the
// total is 60 and 20 + 20 + 20 is reachable, so a longest-first pass must land
// within the usual 4/3 bound of that and, here, exactly on it.
const KNOWN = {
    files: {
        'tests/a.spec.ts': 10,
        'tests/b.spec.ts': 9,
        'tests/c.spec.ts': 8,
        'tests/d.spec.ts': 7,
        'tests/e.spec.ts': 6,
        'tests/f.spec.ts': 5,
        'tests/g.spec.ts': 4,
        'tests/h.spec.ts': 3,
        'tests/i.spec.ts': 3,
        'tests/j.spec.ts': 2,
        'tests/k.spec.ts': 2,
        'tests/l.spec.ts': 1,
    },
    fallback: 4,
}
const KNOWN_SPECS = Object.keys(KNOWN.files).map(file => spec(file, 2))

test('every file lands on exactly one shard', () => {
    for (const total of [1, 2, 3, 5, 12, 20]) {
        const shards = assignShards(KNOWN_SPECS, KNOWN, total)
        assert.equal(shards.length, total)
        const placed = shards.flatMap(s => s.files).sort(comparePaths)
        assert.deepEqual(placed, KNOWN_SPECS.map(s => s.file).sort(comparePaths))
    }
})

test('the test counts and seconds of the shards add up to the whole', () => {
    const shards = assignShards(KNOWN_SPECS, KNOWN, 4)
    assert.equal(
        shards.reduce((sum, s) => sum + s.tests, 0),
        KNOWN_SPECS.length * 2
    )
    assert.equal(
        shards.reduce((sum, s) => sum + s.seconds, 0),
        60
    )
})

test('the same input gives the same answer, whatever order the files arrive in', () => {
    const forward = assignShards(KNOWN_SPECS, KNOWN, 3)
    const backward = assignShards([...KNOWN_SPECS].reverse(), KNOWN, 3)
    assert.deepEqual(backward, forward)
})

test('equal durations are broken by path, then by shard number', () => {
    const tied = { files: {}, fallback: 5 }
    const specs = ['tests/z.spec.ts', 'tests/a.spec.ts', 'tests/m.spec.ts', 'tests/b.spec.ts'].map(
        file => spec(file)
    )
    const shards = assignShards(specs, tied, 2)
    // Path order a, b, m, z dealt onto the lightest shard, lowest number first.
    assert.deepEqual(shards[0].files, ['tests/a.spec.ts', 'tests/m.spec.ts'])
    assert.deepEqual(shards[1].files, ['tests/b.spec.ts', 'tests/z.spec.ts'])
})

test('balances a known input: three shards of 20 seconds', () => {
    const shards = assignShards(KNOWN_SPECS, KNOWN, 3)
    assert.deepEqual(
        shards.map(s => s.seconds),
        [20, 20, 20]
    )
})

test('beats the count-based split on a lopsided input', () => {
    // Two heavy files and six light ones, one test each. Splitting by count
    // would put four files on each of two shards, so one shard would take both
    // heavy files if they were adjacent. Splitting by duration separates them.
    const durations = {
        files: {
            'tests/heavy-1.spec.ts': 100,
            'tests/heavy-2.spec.ts': 100,
            'tests/l1.spec.ts': 10,
            'tests/l2.spec.ts': 10,
            'tests/l3.spec.ts': 10,
            'tests/l4.spec.ts': 10,
            'tests/l5.spec.ts': 10,
            'tests/l6.spec.ts': 10,
        },
        fallback: 4,
    }
    const specs = Object.keys(durations.files).map(file => spec(file))
    const shards = assignShards(specs, durations, 2)
    assert.deepEqual(
        shards.map(s => s.seconds),
        [130, 130]
    )
    assert.notEqual(
        shards.findIndex(s => s.files.includes('tests/heavy-1.spec.ts')),
        shards.findIndex(s => s.files.includes('tests/heavy-2.spec.ts'))
    )
})

test('a file with no recorded duration costs the fallback per test', () => {
    const durations = { files: { 'tests/known.spec.ts': 7 }, fallback: 3.5 }
    assert.equal(estimateSeconds(spec('tests/known.spec.ts', 9), durations), 7)
    assert.equal(estimateSeconds(spec('tests/new.spec.ts', 4), durations), 14)
    // And it is placed: an unknown file is neither dropped nor free.
    const shards = assignShards(
        [spec('tests/known.spec.ts', 9), spec('tests/new.spec.ts', 4)],
        durations,
        2
    )
    assert.deepEqual(shards[0].files, ['tests/new.spec.ts'])
    assert.deepEqual(shards[1].files, ['tests/known.spec.ts'])
})

test('a recorded file that no longer exists is ignored', () => {
    const durations = {
        files: { ...KNOWN.files, 'tests/deleted.spec.ts': 999 },
        fallback: 4,
    }
    const shards = assignShards(KNOWN_SPECS, durations, 3)
    assert.ok(!shards.some(s => s.files.includes('tests/deleted.spec.ts')))
    // The 999 s does not skew the others.
    assert.deepEqual(
        shards.map(s => s.seconds),
        [20, 20, 20]
    )
})

test('a shard with no files is an error, never an empty argument list', () => {
    const specs = KNOWN_SPECS.slice(0, 2)
    assert.equal(selectShard(specs, KNOWN, 1, 2).files.length, 1)
    assert.throws(() => selectShard(specs, KNOWN, 3, 3), /shard 3\/3 has no spec files/)
    assert.throws(() => selectShard([], KNOWN, 1, 1), /has no spec files/)
})

test('a shard index outside 1..n is an error', () => {
    for (const k of [0, 6, -1, 1.5, Number.NaN]) {
        assert.throws(() => selectShard(KNOWN_SPECS, KNOWN, k, 5), /shard must be an integer/)
    }
})

// What Playwright does with a positional argument, written out independently of
// the module under test: a case-insensitive regular expression, tested against
// the ABSOLUTE path of every file (playwright/lib/common/index.js, forceRegExp).
const selectedBy = (arg, files, root = '/repo') =>
    files.filter(file => new RegExp(arg, 'gi').test(`${root}/${file}`))

test('each file gets an argument that selects that file and nothing else', () => {
    const files = [
        'tests/a.spec.ts',
        'tests/a.spec.ts.bak',
        'tests/ab.spec.ts',
        'tests/a+b.spec.ts',
        'tests/e[1].spec.ts',
        'tests/e1.spec.ts',
        'tests/(x).spec.ts',
        'tests/$dollar.spec.ts',
        'tests/caret^.spec.ts',
        'tests/a|b.spec.ts',
        'tests/sub dir/deep/a b.spec.ts',
        'tests/Mixed-Case.spec.ts',
    ]
    for (const file of files) {
        assert.deepEqual(selectedBy(playwrightArg(file), files), [file], playwrightArg(file))
    }
    assert.deepEqual(ambiguousPatterns(files.map(file => spec(file))), [])
})

test('the bare path was the bug: characters that are regex syntax', () => {
    const files = [
        'tests/a+b.spec.ts',
        'tests/e[1].spec.ts',
        'tests/ab.spec.ts',
        'tests/e1.spec.ts',
    ]
    // Unescaped, `a+b` means "one or more a, then b", so it misses its own file
    // and picks a neighbour, and `e[1]` means "e then 1".
    assert.deepEqual(selectedBy('tests/a+b.spec.ts', files), ['tests/ab.spec.ts'])
    assert.deepEqual(selectedBy('tests/e[1].spec.ts', files), ['tests/e1.spec.ts'])
    assert.equal(escapeRegExp('a+b[1](2).*$^|\\'), 'a\\+b\\[1\\]\\(2\\)\\.\\*\\$\\^\\|\\\\')
})

test('the guard refuses files that one argument cannot tell apart', () => {
    // Case-insensitive, so no argument can pick one of these two alone.
    const problems = ambiguousPatterns([spec('tests/Foo.spec.ts'), spec('tests/foo.spec.ts')])
    assert.equal(problems.length, 2)
    assert.match(problems[0], /Foo\.spec\.ts.*selects tests\/Foo\.spec\.ts, tests\/foo\.spec\.ts/)
    // Anchored at the end only, so an argument also reaches a nested copy.
    const nested = ambiguousPatterns([spec('tests/a.spec.ts'), spec('tests/sub/tests/a.spec.ts')])
    assert.equal(nested.length, 1)
    assert.match(nested[0], /^tests\/a\.spec\.ts: .*tests\/sub\/tests\/a\.spec\.ts/)
})

test('lists every test in a --list report as file and title, repeats numbered', () => {
    const report = {
        config: { rootDir: '/repo/tests' },
        suites: [
            {
                file: 'a.spec.ts',
                title: 'a.spec.ts',
                specs: [{ title: 'top' }, { title: 'same' }, { title: 'same' }],
                suites: [
                    {
                        title: 'group',
                        specs: [{ title: 'inner' }],
                        suites: [{ title: 'deeper', specs: [{ title: 'leaf' }] }],
                    },
                ],
            },
        ],
    }
    assert.deepEqual(
        [...testKeysFromReport(report, '/repo')],
        [
            'tests/a.spec.ts\u0000top',
            'tests/a.spec.ts\u0000same',
            'tests/a.spec.ts\u0000same#2',
            'tests/a.spec.ts\u0000group › inner',
            'tests/a.spec.ts\u0000group › deeper › leaf',
        ]
    )
})

test('reads files and test counts out of a --list JSON report', () => {
    const root = '/repo'
    const report = {
        config: { rootDir: '/repo/tests' },
        errors: [],
        suites: [
            {
                file: 'b.spec.ts',
                specs: [{ tests: [{}] }],
                suites: [{ specs: [{ tests: [{}] }, { tests: [{}] }] }],
            },
            { file: 'a.spec.ts', specs: [{ tests: [{}] }] },
        ],
    }
    assert.deepEqual(specFilesFromReport(report, root), [
        { file: 'tests/a.spec.ts', tests: 1 },
        { file: 'tests/b.spec.ts', tests: 3 },
    ])
    assert.throws(
        () => specFilesFromReport({ ...report, errors: [{ message: 'boom' }] }, root),
        /reported errors/
    )
})

test('the committed durations file is well formed', () => {
    const path = join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'tests',
        'shard-durations.json'
    )
    const data = JSON.parse(readFileSync(path, 'utf8'))
    assert.ok(data.fallback_seconds_per_test > 0)
    assert.ok(Object.keys(data.files).length > 0)
    for (const [file, seconds] of Object.entries(data.files)) {
        assert.match(file, /^tests\/.+\.spec\.ts$/)
        assert.ok(seconds >= 0, file)
    }
})
