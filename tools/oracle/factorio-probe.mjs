import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export const factorioBin =
    process.env.FACTORIO_BIN ??
    `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`

export function prepareProbe(info) {
    const work = mkdtempSync(join(tmpdir(), 'fbe-oracle-'))
    const writeData = join(work, 'write-data')
    const modDir = join(work, 'mods')
    const modPath = join(modDir, `${info.name}_0.0.1`)
    mkdirSync(writeData, { recursive: true })
    mkdirSync(modPath, { recursive: true })
    writeFileSync(
        join(modPath, 'info.json'),
        JSON.stringify({ version: '0.0.1', author: 'oracle', ...info })
    )
    return { work, writeData, modDir, modPath }
}

export function runProbe({
    bin = factorioBin,
    work,
    writeData,
    modDir,
    dump,
    maxBuffer,
    spawn = spawnSync,
}) {
    const config = join(work, 'config.ini')
    writeFileSync(
        config,
        `[path]\nread-data=__PATH__executable__/../data\nwrite-data=${writeData}\n[general]\n[other]\n`
    )

    const result = spawn(
        bin,
        ['--create', join(work, 'probe.zip'), '--mod-directory', modDir, '--config', config],
        { encoding: 'utf8', ...(maxBuffer && { maxBuffer }) }
    )
    const dumpPath = join(writeData, 'script-output', dump)
    if (!existsSync(dumpPath)) {
        const tail = ((result.stdout ?? '') + (result.stderr ?? '')).slice(-4000)
        throw new Error(`No dump produced by Factorio. Output tail:\n${tail}`, {
            cause: result.error,
        })
    }
    return { dumpPath, result, text: readFileSync(dumpPath, 'utf8') }
}
