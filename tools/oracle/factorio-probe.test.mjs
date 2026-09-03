import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareProbe, runProbe } from './factorio-probe.mjs'

/**
 * Runs the shared probe runner against a fake spawn, so the whole path is
 * exercised without a Factorio installation. Returns everything the assertions
 * below need to look at.
 *
 * The real runner treats the dump file, not Factorio's exit code, as the
 * verdict - a probe signals success with a deliberate `error("DUMPED-OK")` - so
 * the fake writes a dump and returns cleanly.
 */
function runAgainstFakeFactorio() {
    const probe = prepareProbe({
        name: 'runner_test',
        title: 'Runner test',
        factorio_version: '2.1',
        dependencies: ['base'],
    })
    const expected = { ok: true }
    const { text } = runProbe({
        ...probe,
        bin: 'factorio',
        dump: 'result.json',
        spawn: (_bin, _args, options) => {
            assert.equal(options.encoding, 'utf8')
            const output = join(probe.writeData, 'script-output')
            mkdirSync(output, { recursive: true })
            writeFileSync(join(probe.work, 'spawned'), '')
            writeFileSync(join(output, 'result.json'), JSON.stringify(expected))
            return { stdout: '', stderr: '' }
        },
    })
    return { probe, expected, text }
}

test('runProbe returns the dump the probe wrote', () => {
    const { expected, text } = runAgainstFakeFactorio()
    assert.deepEqual(JSON.parse(text), expected)
})

test('runProbe actually spawns Factorio', () => {
    const { probe } = runAgainstFakeFactorio()
    assert.equal(existsSync(join(probe.work, 'spawned')), true)
})

test('prepareProbe writes an isolated mod owned by the oracle', () => {
    const { probe } = runAgainstFakeFactorio()
    const info = JSON.parse(readFileSync(join(probe.modPath, 'info.json')))
    assert.equal(info.author, 'oracle')
})
