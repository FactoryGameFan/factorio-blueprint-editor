// Counts TypeScript diagnostics from `tsc --pretty false` output and compares
// the total to a committed baseline so CI can block regressions without
// requiring a zero-error codebase.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ERROR_LINE = /error TS\d+/

export function countErrors(tscOutput) {
    return tscOutput.split('\n').filter(line => ERROR_LINE.test(line)).length
}

export function evaluateGate({ count, baseline }) {
    if (count > baseline) return { status: 'fail', count, baseline }
    if (count < baseline) return { status: 'improved', count, baseline }
    return { status: 'pass', count, baseline }
}

// Returns true when tsc exited non-zero but produced zero parseable diagnostics,
// which signals that tsc itself failed to run (missing binary, bad config, OOM, etc.).
// A clean repo (exit 0, count 0) is NOT a tool failure.
export function isToolFailure({ count, exitCode }) {
    return count === 0 && exitCode !== 0
}

function runTsc(project) {
    // tsc exits non-zero when there are errors; its diagnostics land on stdout.
    // `--pretty false` keeps each diagnostic on one parseable line.
    try {
        const output = execFileSync(
            'npx',
            ['tsc', '--noEmit', '--pretty', 'false', '-p', project],
            {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        )
        return { output, exitCode: 0 }
    } catch (e) {
        return { output: `${e.stdout ?? ''}${e.stderr ?? ''}`, exitCode: e.status ?? 1 }
    }
}

function main() {
    const here = dirname(fileURLToPath(import.meta.url))
    const baselinePath = join(here, 'type-check-baseline.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    const repoRoot = join(here, '..')
    const { output, exitCode } = runTsc(join(repoRoot, baseline.project))
    const count = countErrors(output)

    if (isToolFailure({ count, exitCode })) {
        console.error(
            `tsc did not run cleanly (exit ${exitCode}, 0 diagnostics parsed). ` +
                'Check that tsc is installed, the tsconfig path is correct, and the project compiles.'
        )
        process.exit(1)
    }

    const result = evaluateGate({ count, baseline: baseline.maxErrors })

    if (result.status === 'fail') {
        console.error(
            `Type-check gate FAILED: ${count} errors against baseline ${baseline.maxErrors}.`
        )
        console.error(
            'New type errors were introduced. Fix them, or if intentional update scripts/type-check-baseline.json.'
        )
        console.error(output)
        process.exit(1)
    }

    if (result.status === 'improved') {
        console.log(
            `Type-check improved: ${count} errors (baseline ${baseline.maxErrors}). ` +
                `Lower "maxErrors" in scripts/type-check-baseline.json to ${count} to lock in the gain.`
        )
        process.exit(0)
    }

    console.log(`Type-check gate passed: ${count} errors (at baseline ${baseline.maxErrors}).`)
    process.exit(0)
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
