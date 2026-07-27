/**
 * A value this page previously wrote with `localStorage.setItem`, or undefined
 * where nothing is stored - a first visit, or a key the user cleared.
 *
 * `getItem` answers `string | null` and `JSON.parse` does not take null. Every
 * caller used to test the key and then read it a *second* time inside the
 * branch, which is what left the type unnarrowed; reading once is both the fix
 * and one fewer chance for the two reads to disagree.
 *
 * Lives in its own module because `index.ts` imports `settingsPane.ts`, so the
 * two cannot share a helper through either of them.
 */
export function storedJson<T>(key: string): T | undefined {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : (JSON.parse(raw) as T)
}
