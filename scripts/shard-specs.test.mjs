import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    ambiguousPatterns,
    assignShards,
    comparePaths,
    estimateSeconds,
    selectShard,
    specFilesFromReport,
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

test('a path that would also match another path as a regex is refused', () => {
    assert.deepEqual(ambiguousPatterns(KNOWN_SPECS), [])
    assert.deepEqual(ambiguousPatterns([spec('tests/a.spec.ts'), spec('tests/aXspec.ts')]), [
        'tests/a.spec.ts also matches tests/aXspec.ts',
    ])
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
        assert.match(file, /^tests\/[^/]+\.spec\.ts$/)
        assert.ok(seconds >= 0, file)
    }
})
