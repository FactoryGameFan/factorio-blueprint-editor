import { describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'

/*
    Issue #208. A guard against a spec pressing `Control+A` where it means
    "select all", which is the one bug class in this repo that **no runner can
    catch**, and the reason is worth stating before the rule.

    On macOS `Control+A` is the emacs "beginning of line" binding, not select
    all. So nothing gets selected, the typed text lands beside the old text
    instead of replacing it, and the assertion receives something like
    `"New textOld text"`. That is #197, fixed in 402fbe31.

    Why a text scan rather than a test that drives something. The bug **passes
    on Linux**, and every runner this project has is Linux: `vp test` and the
    four `e2e` shards are all `ubuntu-latest`. When #208 was written the reason
    it reached the default branch was that CI never ran Playwright at all, and
    #223 and #225 have since fixed that half. It does not help here. A browser
    suite that gates every PR on four sharded runners will go green on this
    forever, so the only thing that can see it is something reading the spec
    source, which is what this does.

    And the knowledge already existed in the repo without stopping it. After
    402fbe31 there is a five-line comment at `display-panel-editor.spec.ts:159`
    explaining the whole trap, sitting directly above the `ControlOrMeta+A` that
    replaced the bad line. A contributor then wrote `Control+A` in a new spec in
    a different file (PR #222, `blueprint-grid-position.spec.ts:97`). A comment
    at the scene of the last occurrence does not reach the next one.

    ## The rule, which is not "never write Control"

    A blanket ban would be wrong, and the measured usage says so. There are two
    classes and they want different things:

      - A chord reaching the **app**, through `actions.ts`, stays `Control`.
        `type ModifierKey = 'Control' | 'Shift' | 'Alt'` there, so the app has no
        Meta binding and Control is the only key that works.
      - A chord reaching a **focused DOM `<input>` or `<textarea>`**, handled by
        the browser or the OS, wants `ControlOrMeta`, because that binding
        differs by platform.

    `TextInput` is the only thing in this editor that puts a real DOM input on
    the page, so the second class is small: select all, copy, cut, paste and undo
    performed inside a text field.

    Since a regex cannot tell those two apart - the same five key names appear in
    both - this flags every one and makes the allowlist carry the distinction. An
    entry has to say which class it is and why, which is the point: the author
    states it once, in writing, instead of the next reader guessing.

    `Meta+` is flagged for the same five keys even though nothing uses it today.
    It is the same mistake facing the other way, and it fails on the opposite
    platform, so the rule reads as "text chords use ControlOrMeta" rather than
    "avoid Control".

    Deliberately NOT flagged: `keyboard.down('Control')` and `up('Control')`,
    which four specs use to hold the modifier for the ctrl-drag copy gesture.
    That is a held modifier for a mouse gesture reaching the app's own handler,
    not a text-editing chord, and it is correct as written in all of them.

    Pure Node, so it runs under `vp test` inside `checks` in milliseconds rather
    than behind the browser job. `playwright.config.ts` pins a `testMatch` of
    spec files only, so Playwright does not also collect this file.

    (Do not write that glob out inside this comment. It contains an asterisk
    followed by a slash, which ends the comment block mid-sentence and turns the
    rest of the file into syntax errors pointing at the wrong line. Same shape as
    the backtick-inside-a-template-literal note in the oracle probe README, and
    it cost a run here too.)
*/

const SPEC_DIR = path.join(__dirname)

/**
 * The text-editing keys whose platform binding differs. Playwright accepts both
 * the bare name and the `Key`-prefixed code, so both spellings are matched.
 */
const TEXT_EDIT_KEYS = ['A', 'C', 'V', 'X', 'Z'] as const

/**
 * Matches the chord only where it is **an argument to `keyboard.press`**, not
 * wherever the characters appear.
 *
 * The first draft matched the bare text and immediately flagged
 * `display-panel-editor.spec.ts:160` - the five-line comment explaining this
 * exact trap, which is prose, correct, and the most useful paragraph on the
 * subject in the repo. Skipping lines that look like comments does not work
 * here: this codebase writes block comments as bare indented lines with no
 * leading asterisk, so there is nothing to key on without tracking `/*` state
 * across lines, and that in turn trips over any string containing a slash pair.
 *
 * Matching the call form instead removes the whole question. Prose can discuss
 * the bug freely, a URL in a string is not a comment marker, and what gets
 * flagged is the thing that actually runs. Does not match `ControlOrMeta+A`:
 * after `Control` comes `O`, not `+`.
 *
 * Group 1 is the **chord alone**, because the whole match now carries the call
 * form with it and the allowlist names chords. Reading `m[0]` here silently
 * stops every allowlist entry from matching anything, which fails as a
 * violation and a stale entry at once - both pointing at the allowed line.
 */
const CHORD = new RegExp(
    `\\.press\\(\\s*['"\`]((?:Control|Meta)\\+(?:Key)?(?:${TEXT_EDIT_KEYS.join('|')}))['"\`]`,
    'gi'
)

interface AllowedChord {
    /** File name relative to tests/, e.g. `chest-filters.spec.ts`. */
    file: string
    /** The matched chord, e.g. `Control+KeyZ`; compared case-insensitively. */
    chord: string
    /** Why this one is right as written. Required: it is the whole mechanism. */
    reason: string
}

/*
    Every entry is a chord that reaches the app rather than a focused text
    field. Keep the reason concrete - "it is fine" is not a reason, and the next
    person cannot check it.
*/
const ALLOWLIST: AllowedChord[] = [
    {
        file: 'chest-filters.spec.ts',
        chord: 'Control+KeyZ',
        reason:
            "drives the editor's own undo keybind through actions.ts, where " +
            'ModifierKey is Control | Shift | Alt and there is no Meta binding. No ' +
            'DOM input has focus at that point in the spec.',
    },
]

interface Found {
    file: string
    line: number
    chord: string
    text: string
}

const sameChord = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

function specFiles(): string[] {
    return fs
        .readdirSync(SPEC_DIR)
        .filter(f => f.endsWith('.spec.ts'))
        .sort()
}

function findChords(): Found[] {
    const found: Found[] = []
    for (const file of specFiles()) {
        const lines = fs.readFileSync(path.join(SPEC_DIR, file), 'utf8').split('\n')
        lines.forEach((text, i) => {
            for (const m of text.matchAll(CHORD)) {
                found.push({ file, line: i + 1, chord: m[1], text: text.trim() })
            }
        })
    }
    return found
}

const isAllowed = (f: Found): boolean =>
    ALLOWLIST.some(a => a.file === f.file && sameChord(a.chord, f.chord))

describe('platform-specific modifier chords in Playwright specs', () => {
    it('finds spec files to read, so a silent zero is not a pass', () => {
        /*
            Without this the whole guard passes trivially if the directory
            layout moves or the extension changes - "no files, no matches, all
            green" reads exactly like "no violations". 44 specs at the time of
            writing; the assertion is only that it found a plausible number, not
            an exact count that every new spec would have to update.
        */
        expect(specFiles().length).toBeGreaterThan(30)
    })

    it('uses ControlOrMeta for chords that reach a focused text field', () => {
        const violations = findChords().filter(f => !isAllowed(f))

        const report = violations
            .map(v => `  ${v.file}:${v.line}  ${v.chord}\n      ${v.text}`)
            .join('\n')

        expect(
            violations,
            violations.length === 0
                ? ''
                : `\n\n${violations.length} spec chord(s) hardcode a platform modifier:\n\n${report}\n\n` +
                      'On macOS Control+A is "beginning of line", not select-all, so the typed\n' +
                      'text lands beside the old text and the assertion sees both. This passes on\n' +
                      'every Linux runner this project has, so no test run will catch it.\n\n' +
                      'If the chord reaches a focused <input>/<textarea>, use ControlOrMeta+X.\n' +
                      'If it reaches the app through actions.ts, keep Control and add an entry to\n' +
                      'ALLOWLIST in tests/spec-modifier-keys.test.ts saying which and why.\n'
        ).toEqual([])
    })

    it('has no stale allowlist entries', () => {
        /*
            The other direction, and it is not decoration. An allowlist that
            keeps entries for chords nobody writes any more decays into a list
            of things that were once true, and the next person reads a stale
            justification as a live one. Same both-directions membership check
            tests/entity-accessors.spec.ts uses on its fixture.
        */
        const found = findChords()
        const stale = ALLOWLIST.filter(
            a => !found.some(f => f.file === a.file && sameChord(f.chord, a.chord))
        )

        expect(
            stale.map(s => `${s.file} ${s.chord}`),
            '\n\nALLOWLIST entries matching nothing. The chord was removed or renamed;\n' +
                'delete the entry rather than leaving a justification for code that is gone.\n'
        ).toEqual([])
    })

    it('matches platform-specific press chords case-insensitively', () => {
        /*
            A control for the regex itself. If `ControlOrMeta+A` ever started
            matching, every corrected call site would turn red and the obvious
            way out would be to revert them to `Control+A`, which is the bug.
        */
        expect('await page.keyboard.press("ControlOrMeta+A")'.match(CHORD)).toBeNull()
        expect('await page.keyboard.press("Control+A")'.match(CHORD)).not.toBeNull()
        expect('await page.keyboard.press("Control+KeyA")'.match(CHORD)).not.toBeNull()
        expect('await page.keyboard.press("Control+z")'.match(CHORD)).not.toBeNull()
        expect('await page.keyboard.down("Control")'.match(CHORD)).toBeNull()
        expect(sameChord('Control+KeyZ', 'control+keyz')).toBe(true)
    })
})
