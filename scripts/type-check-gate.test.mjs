import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import {
    countErrors,
    evaluateGate,
    isToolFailure,
    hasFatalDiagnostics,
} from './type-check-gate.mjs'

const SAMPLE_TSC_OUTPUT = [
    "src/core/spriteDataBuilder.ts(10,5): error TS2339: Property 'x' does not exist on type 'Y'.",
    "src/core/spriteDataBuilder.ts(22,9): error TS2345: Argument of type 'A' is not assignable.",
    "src/core/bpString.ts(30,1): error TS2322: Type 'string' is not assignable to type 'number'.",
    'Found 3 errors in 2 files.',
    '',
].join('\n')

// Bare config error - emitted without a file position when the tsconfig path is wrong
const CONFIG_ERROR_OUTPUT = [
    "error TS6053: File 'packages/editor/tsconfig.json' not found.",
    'Found 1 error.',
    '',
].join('\n')

// Bare no-inputs error - emitted when the tsconfig has no matching source files
const BARE_NOCONFIG_OUTPUT = ['error TS18003: No inputs were found in config file.', ''].join('\n')

test('countErrors counts positioned diagnostic lines and ignores the summary line', () => {
    assert.equal(countErrors(SAMPLE_TSC_OUTPUT), 3)
})

test('countErrors returns 0 for clean output', () => {
    assert.equal(countErrors(''), 0)
})

test('countErrors returns 1 for a single positioned-error input', () => {
    const single = "src/foo.ts(1,1): error TS2339: Property 'x' does not exist."
    assert.equal(countErrors(single), 1)
})

test('countErrors returns 0 for a bare config error (not a positioned source error)', () => {
    assert.equal(countErrors(CONFIG_ERROR_OUTPUT), 0)
})

test('hasFatalDiagnostics returns false for clean output', () => {
    assert.equal(hasFatalDiagnostics(''), false)
})

test('hasFatalDiagnostics returns false for positioned source errors only', () => {
    assert.equal(hasFatalDiagnostics(SAMPLE_TSC_OUTPUT), false)
})

test('hasFatalDiagnostics returns true for bare config error (TS6053)', () => {
    assert.equal(hasFatalDiagnostics(CONFIG_ERROR_OUTPUT), true)
})

test('hasFatalDiagnostics returns true for bare no-inputs error (TS18003)', () => {
    assert.equal(hasFatalDiagnostics(BARE_NOCONFIG_OUTPUT), true)
})

test('isToolFailure returns false when count=0 and exitCode=0 (clean repo)', () => {
    assert.equal(isToolFailure({ count: 0, exitCode: 0 }), false)
})

test('isToolFailure returns true when count=0 and exitCode=2 (tsc broken)', () => {
    assert.equal(isToolFailure({ count: 0, exitCode: 2 }), true)
})

test('isToolFailure returns true when count=0 and exitCode=1 (spawn failure - ENOENT)', () => {
    assert.equal(isToolFailure({ count: 0, exitCode: 1 }), true)
})

test('isToolFailure returns false when count=87 and exitCode=2 (normal tsc errors)', () => {
    assert.equal(isToolFailure({ count: 87, exitCode: 2 }), false)
})

test('isToolFailure returns false when count=88 and exitCode=1', () => {
    assert.equal(isToolFailure({ count: 88, exitCode: 1 }), false)
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
