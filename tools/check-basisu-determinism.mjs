import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { spawnSync } from 'node:child_process'

// Uses the exporter's encoding flags and a byte-identical copy at another path
// for the second run. Outputs are retained; source images are never written.
const inputs = process.argv.slice(2)
if (inputs.length === 0) {
    throw new Error('Usage: node tools/check-basisu-determinism.mjs <image.png> [more.png ...]')
}
const encoder = fileURLToPath(new URL('../packages/exporter/basisu', import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'fbe-basis-determinism-'))
console.log('Encoder: ' + encoder + '\nOutputs retained at ' + work)
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

for (const [index, input] of inputs.entries()) {
    const source = resolve(input)
    const before = readFileSync(source)
    const copied = join(work, index + '-copied.png')
    copyFileSync(source, copied)
    const outputs = [source, copied].map((png, run) => {
        const output = join(work, index + '-' + run + '.basis')
        const result = spawnSync(
            encoder,
            ['-no_multithreading', '-mipmap', '-file', png, '-output_file', output],
            { encoding: 'utf8' }
        )
        if (result.error || result.status !== 0) {
            throw new Error('basisu failed: ' + result.stderr + '\n' + result.stdout, {
                cause: result.error,
            })
        }
        return readFileSync(output)
    })
    if (!before.equals(readFileSync(source))) throw new Error('Input changed: ' + source)
    if (outputs[0].length === 0 || !outputs[0].equals(outputs[1])) {
        throw new Error('Outputs differ or are empty: ' + source)
    }
    console.log(
        JSON.stringify({
            input,
            inputSha256: sha256(before),
            outputBytes: outputs[0].length,
            outputSha256: sha256(outputs[0]),
            identicalAcrossInputPaths: true,
        })
    )
}
