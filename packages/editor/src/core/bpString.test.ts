import { describe, expect, it } from 'vite-plus/test'
import { Blueprint } from './Blueprint'
import { EmptyBlueprintStringError, getBlueprintOrBookFromSource } from './bpString'

/*
    What `getBlueprintOrBookFromSource` does with nothing to import - issue #298.

    No FD here, deliberately. The guard under test has to run before anything
    that reads blueprint data, so a test that needed `loadData` first would not
    be able to tell a working guard from one sitting below the first FD read.
    Every other bpString test lives in Blueprint.test.ts for exactly that reason:
    it goes on to `decode`, which validates against FD.

    The bug: only `undefined` was guarded. An empty string passed that check,
    failed the `DATA[0] === '0'` test, and reached `new URL('https://')`, which
    throws `TypeError: Invalid URL`. The website reports an unrecognised error
    through `createErrorMessage`, so the user was told to report a bug on github
    because their clipboard was empty.

    Why this rejects rather than resolving to an empty blueprint, which is what
    issue #298 first proposed: `importReplace` pipes the resolved value straight
    into `loadBp` -> `Editor.loadBlueprint`, which assigns `G.bp` and destroys
    the old container. `History` is per-Blueprint (Blueprint.ts:142), so the
    replacement carries an empty undo stack - the same mechanism
    clipboard-shortcuts.spec.ts's header records for issue #279. Resolving would
    have turned a confusing message into a silent wipe on any stray Ctrl+V with
    an empty clipboard. Rejecting keeps every caller's existing catch, which
    already declines to load.
*/

describe('an empty blueprint source', () => {
    it('rejects an empty string rather than throwing Invalid URL', async () => {
        await expect(getBlueprintOrBookFromSource('')).rejects.toBeInstanceOf(
            EmptyBlueprintStringError
        )
    })

    /*
        Whitespace-only has to be caught by the same guard, and the ordering is
        what makes it so: the check goes after the existing whitespace strip,
        not before it. A guard on the raw argument would pass `'  '` through to
        the same `new URL('https://')` throw, since the strip happens first.
    */
    it('rejects a whitespace-only string, which strips to empty', async () => {
        await expect(getBlueprintOrBookFromSource('   \n\t ')).rejects.toBeInstanceOf(
            EmptyBlueprintStringError
        )
    })

    /*
        The existing behaviour this must not change. `undefined` is "no ?source=
        param at all", which is how the editor opens for most visitors, so it
        stays silent and resolves. It is a different case from `?source=` with an
        empty value, which is a user who meant to pass something.
    */
    it('still resolves an undefined source to an empty blueprint', async () => {
        const bp = await getBlueprintOrBookFromSource(undefined as unknown as string)
        expect(bp).toBeInstanceOf(Blueprint)
        expect((bp as Blueprint).isEmpty()).toBe(true)
    })

    /*
        The message the website renders. Pinned because it is the whole point of
        the change - the old path produced "Blueprint string could not be
        loaded. Please check out the console (F12) ... and report this bug on
        github", and nothing else can see that this one does not say that.
    */
    it('carries a message that does not ask the user to report a bug', async () => {
        const error = await getBlueprintOrBookFromSource('').catch((e: unknown) => e)
        expect((error as EmptyBlueprintStringError).error).toBe('There was nothing to import.')
    })
})
