import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { buildDurationsFile, fitDurations, median, parseJobLog } from './shard-durations.mjs'

const line = (status, file, title, duration, n = 1) =>
    `﻿2026-11-25T04:39:28.0533130Z   ${status}  ${String(n).padStart(3)} ${file}:37:1 › ${title} (${duration})`

test('median', () => {
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([4, 1, 2, 3]), 2.5)
})

test('parses passing tests in ms, s and m, and skips everything else', () => {
    const log = [
        'Running 5 tests using 1 worker',
        line('✓', 'tests/a.spec.ts', 'fast one', '829ms'),
        line('✓', 'tests/a.spec.ts', 'slow one', '2.4s', 2),
        line('✓', 'tests/b.spec.ts', 'very slow', '1.5m', 3),
        line('✘', 'tests/b.spec.ts', 'failed', '120.0s', 4),
        line('-', 'tests/b.spec.ts', 'skipped', '0ms', 5),
        '2026-11-25T04:39:30.0000000Z   5 passed (2.0m)',
    ].join('\n')
    assert.deepEqual(parseJobLog(log), [
        { file: 'tests/a.spec.ts', title: 'fast one', seconds: 0.829 },
        { file: 'tests/a.spec.ts', title: 'slow one', seconds: 2.4 },
        { file: 'tests/b.spec.ts', title: 'very slow', seconds: 90 },
    ])
})

test('a repeated title in one file is two tests, not one', () => {
    const log = [
        line('✓', 'tests/a.spec.ts', 'same', '1.0s'),
        line('✓', 'tests/a.spec.ts', 'same', '2.0s', 2),
    ].join('\n')
    assert.deepEqual(
        parseJobLog(log).map(t => t.title),
        ['same', 'same#2']
    )
})

test('a slow runner does not inflate the durations', () => {
    // The same three tests on a fast, a median and a slow runner (0.5x, 1x,
    // 2x). The raw per-file mean would be 3.5x the true figure for the slow
    // run alone; the fit recovers the median runner's numbers.
    const at = speed => [
        { file: 'tests/a.spec.ts', title: 't1', seconds: 10 * speed },
        { file: 'tests/a.spec.ts', title: 't2', seconds: 20 * speed },
        { file: 'tests/b.spec.ts', title: 't3', seconds: 30 * speed },
    ]
    const jobs = new Map([
        ['fast.log', at(0.5)],
        ['median.log', at(1)],
        ['slow.log', at(2)],
    ])
    const { factors, files } = fitDurations(jobs)
    assert.ok(Math.abs(factors.get('fast.log') - 0.5) < 1e-9)
    assert.ok(Math.abs(factors.get('median.log') - 1) < 1e-9)
    assert.ok(Math.abs(factors.get('slow.log') - 2) < 1e-9)
    assert.ok(Math.abs(files.get('tests/a.spec.ts') - 30) < 1e-9)
    assert.ok(Math.abs(files.get('tests/b.spec.ts') - 30) < 1e-9)
})

test('builds a sorted, rounded file with a fallback per test', () => {
    const jobs = new Map([
        [
            'one.log',
            [
                { file: 'tests/z.spec.ts', title: 'a', seconds: 4.04 },
                { file: 'tests/b.spec.ts', title: 'a', seconds: 2 },
                { file: 'tests/b.spec.ts', title: 'b', seconds: 2 },
            ],
        ],
    ])
    const out = buildDurationsFile({ jobs, source: 'unit test', generated: '2026-01-02' })
    assert.deepEqual(Object.keys(out.files), ['tests/b.spec.ts', 'tests/z.spec.ts'])
    assert.deepEqual(out.files, { 'tests/b.spec.ts': 4, 'tests/z.spec.ts': 4 })
    assert.equal(out.fallback_seconds_per_test, 2.7)
    assert.equal(out.generated, '2026-01-02')
    assert.match(out.about, /unit test/)
})

test('parses nested spec folders and paths with spaces', () => {
    const log = [
        line('✓', 'tests/sub dir/deep/a b.spec.ts', 'works', '1.0s'),
        line('✓', 'tests/plain.spec.ts', 'works', '2.0s', 2),
    ].join('\n')
    assert.deepEqual(
        parseJobLog(log).map(t => t.file),
        ['tests/sub dir/deep/a b.spec.ts', 'tests/plain.spec.ts']
    )
})

test('a test that no longer exists is not timed, so a rename is not counted twice', () => {
    const jobs = new Map([
        [
            'one.log',
            [
                { file: 'tests/a.spec.ts', title: 'old name', seconds: 10 },
                { file: 'tests/a.spec.ts', title: 'new name', seconds: 10 },
                { file: 'tests/b.spec.ts', title: 'gone', seconds: 5 },
            ],
        ],
    ])
    const current = new Set(['tests/a.spec.ts\u0000new name'])
    const { files, tests } = fitDurations(jobs, current)
    assert.equal(tests, 1)
    assert.deepEqual([...files], [['tests/a.spec.ts', 10]])
    // Without the list, everything in the logs counts.
    assert.equal(fitDurations(jobs).tests, 3)
})

// A small deterministic generator, so the fixture below is the same every run.
function mulberry32(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/*
    Noisy logs shaped like the real ones, with known answers. Nine jobs run at
    0.6x to 2x the median runner's speed and each holds about 60% of the tests,
    as shards do. Every reading carries up to 12% noise and one in sixteen is an
    outlier of 2.5x to 4x (a pause on a busy runner). Twelve "long" tests scale
    with the runner. Twelve "short" ones sit under the 3 s voting line and do
    NOT scale: they are dominated by fixed browser start-up and the reporter's
    rounding, so a runner's speed says nothing about them, and if they voted
    they would drag every factor towards 1.

    The perfectly proportional data in the test above cannot tell the fit's
    parts apart, which is how three deliberate breakages (one iteration instead
    of eight, no rescale to the median runner, letting every test vote) once all
    passed. This data can.
*/
function noisyFixture() {
    const random = mulberry32(20261125)
    const speeds = [0.6, 0.8, 0.9, 1.0, 1.0, 1.1, 1.3, 1.6, 2.0]
    const tests = []
    for (let i = 0; i < 12; i++) {
        tests.push({ file: `tests/long-${i % 4}.spec.ts`, title: `long ${i}`, truth: 5 + 3 * i })
    }
    for (let i = 0; i < 12; i++) {
        tests.push({
            file: `tests/short-${i % 3}.spec.ts`,
            title: `short ${i}`,
            truth: 0.4 + 0.2 * (i % 5),
        })
    }
    const jobs = new Map(speeds.map((_, j) => [`job-${j}.log`, []]))
    tests.forEach((t, index) => {
        const holders = speeds.map((_, j) => j).filter(() => random() < 0.6)
        // Every test is seen by at least three jobs, as the real suite is.
        for (let j = 0; holders.length < 3; j++) if (!holders.includes(j)) holders.push(j)
        for (const j of holders) {
            const noise = 1 + (random() - 0.5) * 0.24
            const outlier = random() < 1 / 16 ? 2.5 + random() * 1.5 : 1
            const scales = index < 12 ? speeds[j] : 1
            jobs.get(`job-${j}.log`).push({
                file: t.file,
                title: t.title,
                seconds: t.truth * scales * noise * outlier,
            })
        }
    })
    const medianSpeed = median(speeds)
    return {
        jobs,
        tests,
        factors: new Map(speeds.map((s, j) => [`job-${j}.log`, s / medianSpeed])),
    }
}

test('recovers runner speeds and file durations from noisy, partial logs', () => {
    const { jobs, tests, factors: truth } = noisyFixture()
    const { factors, files } = fitDurations(jobs)
    for (const [job, expected] of truth) {
        const got = factors.get(job)
        assert.ok(Math.abs(got / expected - 1) < 0.08, `${job}: factor ${got} against ${expected}`)
    }
    const expectedFiles = new Map()
    for (const t of tests) expectedFiles.set(t.file, (expectedFiles.get(t.file) ?? 0) + t.truth)
    for (const [file, expected] of expectedFiles) {
        const got = files.get(file)
        const tolerance = file.startsWith('tests/long') ? 0.1 : 0.4
        assert.ok(
            Math.abs(got / expected - 1) < tolerance,
            `${file}: ${got} s against ${expected} s`
        )
    }
    // And the scale is pinned: the median runner is 1.00, whatever the data.
    const sorted = [...factors.values()].sort((a, b) => a - b)
    assert.ok(Math.abs(sorted[4] - 1) < 1e-9, `median factor ${sorted[4]}`)
})
