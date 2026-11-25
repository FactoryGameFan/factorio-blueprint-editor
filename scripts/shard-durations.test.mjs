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
