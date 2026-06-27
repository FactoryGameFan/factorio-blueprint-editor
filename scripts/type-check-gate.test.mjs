import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countErrors, evaluateGate } from './type-check-gate.mjs'

const SAMPLE_TSC_OUTPUT = [
    "src/core/spriteDataBuilder.ts(10,5): error TS2339: Property 'x' does not exist on type 'Y'.",
    "src/core/spriteDataBuilder.ts(22,9): error TS2345: Argument of type 'A' is not assignable.",
    "src/core/bpString.ts(30,1): error TS2322: Type 'string' is not assignable to type 'number'.",
    'Found 3 errors in 2 files.',
    '',
].join('\n')

test('countErrors counts diagnostic lines and ignores the summary line', () => {
    assert.equal(countErrors(SAMPLE_TSC_OUTPUT), 3)
})

test('countErrors returns 0 for clean output', () => {
    assert.equal(countErrors(''), 0)
})

test('evaluateGate fails when count exceeds baseline', () => {
    assert.deepEqual(evaluateGate({ count: 88, baseline: 87 }), {
        status: 'fail',
        count: 88,
        baseline: 87,
    })
})

test('evaluateGate passes when count equals baseline', () => {
    assert.deepEqual(evaluateGate({ count: 87, baseline: 87 }), {
        status: 'pass',
        count: 87,
        baseline: 87,
    })
})

test('evaluateGate reports improvement when count drops below baseline', () => {
    assert.deepEqual(evaluateGate({ count: 80, baseline: 87 }), {
        status: 'improved',
        count: 80,
        baseline: 87,
    })
})
