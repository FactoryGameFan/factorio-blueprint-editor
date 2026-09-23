import { test } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
    The `changes` job in ci.yml decides whether `checks` and Playwright run at
    all, so a wrong answer there is a silent skip rather than a failure. These
    cases exercise the workflow's own `web` predicate by lifting it out of the
    file, not by restating its path rules here - a copy would go on passing
    after the workflow changed underneath it, which is the one thing this test
    exists to notice.
*/

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = join(repoRoot, '.github', 'workflows', 'ci.yml')

const FIRST_LINE = 'if grep --quiet --invert-match'
const AFTER_LAST = 'echo "web=$web"'

/**
 * The shell between the `if` that opens the `web` decision and the `echo` that
 * publishes it. Both boundaries are asserted by name: a refactor that renames
 * either one leaves this test measuring nothing, and an empty extraction would
 * otherwise read as every case passing.
 */
function classifier() {
    const lines = readFileSync(workflow, 'utf8').split('\n')

    const first = lines.findIndex(line => line.includes(FIRST_LINE))
    assert.notEqual(first, -1, `No line of ${workflow} contains ${FIRST_LINE}`)

    const after = lines.findIndex((line, i) => i > first && line.includes(AFTER_LAST))
    assert.notEqual(after, -1, `No line after ${first + 1} contains ${AFTER_LAST}`)

    return lines.slice(first, after).join('\n')
}

/**
 * Runs the extracted predicate over a newline-separated file list.
 *
 * The list arrives on stdin, not in an argument or an environment variable,
 * and that is load-bearing rather than tidy. Linux caps a single argv or envp
 * string at 128 KiB, so a regeneration-sized list fails the exec itself with
 * E2BIG - measured in CI, where the 6000-file case died while every smaller
 * one passed, and not reproducible on macOS, which has no per-string cap. The
 * workflow never meets this limit because it keeps `files` in the same shell
 * process; only a test that spawns one does. Stdin is a pipe and has no such
 * ceiling.
 */
function web(files) {
    const program = `set -euo pipefail\nfiles="$(cat)"\n${classifier()}\nprintf '%s' "$web"\n`
    return execFileSync('bash', ['-c', program], { encoding: 'utf8', input: files })
}

test('generated exporter JSON runs the web jobs (#419)', () => {
    assert.equal(web('packages/exporter/data/output/data.json'), 'true')
})

test('generated exporter textures run the web jobs (#419)', () => {
    assert.equal(web('packages/exporter/data/output/base/graphics/entity.png'), 'true')
})

test('one generated file among exporter-only changes is enough', () => {
    const files = ['packages/exporter/README.md', 'packages/exporter/data/output/data.json']
    assert.equal(web(files.join('\n')), 'true')
})

test('exporter source alone does not run the web jobs', () => {
    // The control. Without a case the predicate answers false for, every
    // assertion above would pass against a predicate hardcoded to true.
    assert.equal(web('packages/exporter/src/main.rs'), 'false')
})

test('the exporter lockfile alone does not run the web jobs', () => {
    assert.equal(web('packages/exporter/Cargo.lock'), 'false')
})

test('anything outside the exporter runs the web jobs', () => {
    assert.equal(web('README.md'), 'true')
})

test('a dataset regeneration is not too large for the predicate', () => {
    // A real regeneration rewrites thousands of textures at once, and the
    // predicate reads the list through a herestring.
    const files = Array.from(
        { length: 6000 },
        (_, i) => `packages/exporter/data/output/${i + 1}.png`
    )
    assert.equal(web(files.join('\n')), 'true')
})

test('the predicate is found in the workflow at all', () => {
    // Guards the instrument rather than the subject: if ci.yml is refactored so
    // neither boundary matches, classifier() throws here with the marker it
    // could not find instead of every case above quietly passing on empty
    // input.
    assert.match(classifier(), /^\s*if grep /)
    assert.match(classifier(), /\bweb=true\b/)
    assert.match(classifier(), /\bweb=false\b/)
})
