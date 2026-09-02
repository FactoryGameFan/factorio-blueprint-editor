import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareProbe, runProbe } from './factorio-probe.mjs'

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

assert.deepEqual(JSON.parse(text), expected)
assert.equal(existsSync(join(probe.work, 'spawned')), true)
assert.equal(JSON.parse(readFileSync(join(probe.modPath, 'info.json'))).author, 'oracle')
