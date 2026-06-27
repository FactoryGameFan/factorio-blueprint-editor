// Counts TypeScript diagnostics from `tsc --pretty false` output and compares
// the total to a committed baseline so CI can block regressions without
// requiring a zero-error codebase.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Matches positioned source diagnostics: path/to/file.ts(LINE,COL): error TS####
const POSITIONED_ERROR = /\(\d+,\d+\): error TS\d+/
// Matches any error TS#### pattern (used to detect bare config/setup errors)
const ANY_ERROR = /error TS\d+/

export function countErrors(tscOutput) {
    return tscOutput.split('\n').filter(line => POSITIONED_ERROR.test(line)).length
}

// Returns true if output contains a bare `error TS####` line without a file position.
// These are setup/config failures (e.g. TS6053 "File not found", TS18003 "No inputs found",
// TS5057 "Cannot find tsconfig"), meaning tsc did not actually evaluate source files.
export function hasFatalDiagnostics(output) {
    return output.split('\n').some(line => ANY_ERROR.test(line) && !POSITIONED_ERROR.test(line))
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
    // We only read stdout - stderr is not parsed to avoid false matches.
    // If tsc cannot be spawned (ENOENT), stdout will be empty and exitCode non-zero,
    // so isToolFailure will catch the failure and exit 1.
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
        return { output: e.stdout ?? '', exitCode: e.status ?? 1 }
    }
}

function main() {
    const here = dirname(fileURLToPath(import.meta.url))
    const baselinePath = join(here, 'type-check-baseline.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    const repoRoot = join(here, '..')
    const { output, exitCode } = runTsc(join(repoRoot, baseline.project))
    const count = countErrors(output)

    if (hasFatalDiagnostics(output)) {
        console.error(
            'Type-check did not run correctly: tsc reported setup or config errors ' +
                '(bare error TS#### without a source file position). ' +
                'Check that the tsconfig path is correct and the project is configured properly.'
        )
        console.error(output)
        process.exit(1)
    }

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
