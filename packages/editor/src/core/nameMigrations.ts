import { getFactorioVersion } from './factorioVersion'

/*
    Legacy prototype renames, grouped by the Factorio version that introduced
    each one. A group applies only to a blueprint declaring a version *below* its
    threshold.

    These used to run as a regex replacement over the decoded JSON text, before
    JSON.parse, with the version conditions written out as comments rather than
    code - so every rename applied to every blueprint. Most rows survived that
    because their source name no longer exists, but `stack-inserter` and
    `fusion-reactor-equipment` are live prototypes again in 2.0, so a current
    blueprint using either was silently rewritten and re-encoding persisted it
    (issue #40). The textual approach could not be fixed in place: the version to
    test against lives inside the string being rewritten.
*/
interface Migration {
    /** Applies to a blueprint whose declared version is below this. */
    readonly below: number
    /** A string equal to a key becomes its value, in any field or object key. */
    readonly values?: Readonly<Record<string, string>>
    /** A `name` field equal to a key becomes its value. Beats `values`. */
    readonly names?: Readonly<Record<string, string>>
    /** A `recipe` field equal to one of these is removed. Beats `values`. */
    readonly dropRecipes?: readonly string[]
}

const migrations: readonly Migration[] = [
    {
        below: getFactorioVersion(0, 17, 0),
        values: {
            'raw-wood': 'wood',
            'science-pack-1': 'automation-science-pack',
            'science-pack-2': 'logistic-science-pack',
            'science-pack-3': 'chemical-science-pack',
            'high-tech-science-pack': 'utility-science-pack',
        },
        dropRecipes: ['wood', 'steel-axe', 'iron-axe'],
    },
    {
        below: getFactorioVersion(0, 17, 10),
        values: { 'grass-1': 'landfill' },
    },
    {
        below: getFactorioVersion(2, 0, 0),
        values: {
            'stack-inserter': 'bulk-inserter',
            'stack-filter-inserter': 'bulk-inserter',
            'filter-inserter': 'fast-inserter',
            'effectivity-module': 'efficiency-module',
            'effectivity-module-2': 'efficiency-module-2',
            'effectivity-module-3': 'efficiency-module-3',
            'used-up-uranium-fuel-cell': 'depleted-uranium-fuel-cell',
            // 'straight-rail': 'legacy-straight-rail' is still missing. It could
            // be added now that the renames are gated - straight-rail only had to
            // stay out while they ran unconditionally, since it is still in the
            // game post 2.0 - but it changes how existing pre-2.0 blueprints load,
            // so it wants its own change.
            'curved-rail': 'legacy-curved-rail',
            'logistic-chest-storage': 'storage-chest',
            'logistic-chest-buffer': 'buffer-chest',
            'logistic-chest-requester': 'requester-chest',
            'logistic-chest-active-provider': 'active-provider-chest',
            'logistic-chest-passive-provider': 'passive-provider-chest',
            'fusion-reactor-equipment': 'fission-reactor-equipment',
            'empty-barrel': 'barrel',
            'fill-water-barrel': 'water-barrel',
            'fill-crude-oil-barrel': 'crude-oil-barrel',
            'fill-petroleum-gas-barrel': 'petroleum-gas-barrel',
            'fill-light-oil-barrel': 'light-oil-barrel',
            'fill-heavy-oil-barrel': 'heavy-oil-barrel',
            'fill-lubricant-barrel': 'lubricant-barrel',
            'fill-sulfuric-acid-barrel': 'sulfuric-acid-barrel',
        },
        names: { 'rocket-control-unit': 'raw-fish' },
        dropRecipes: ['rocket-control-unit'],
    },
]

/** The rows that apply to one version, flattened. */
interface Applicable {
    readonly values: Map<string, string>
    readonly names: Map<string, string>
    readonly dropRecipes: Set<string>
}

const applicableCache = new Map<number, Applicable>()

function applicableTo(version: number): Applicable {
    const cached = applicableCache.get(version)
    if (cached !== undefined) return cached

    const values = new Map<string, string>()
    const names = new Map<string, string>()
    const dropRecipes = new Set<string>()
    for (const migration of migrations) {
        if (version >= migration.below) continue
        for (const [from, to] of Object.entries(migration.values ?? {})) values.set(from, to)
        for (const [from, to] of Object.entries(migration.names ?? {})) names.set(from, to)
        for (const recipe of migration.dropRecipes ?? []) dropRecipes.add(recipe)
    }

    const applicable: Applicable = { values, names, dropRecipes }
    applicableCache.set(version, applicable)
    return applicable
}

type Record_ = Record<string, unknown>

const isRecord = (value: unknown): value is Record_ =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/*
    An entity's pre-2.0 `items` is a name -> count map, so legacy names arrive as
    object *keys* there - the one place in the schema that happens, which is why
    the textual pass got it for free and this one has to ask. Returns a fresh
    object when a key changed, so the caller can swap it in by assignment; a
    rename in place would mean deleting the old key.
*/
function renameKeys(obj: Record_, values: Map<string, string>): Record_ {
    if (!Object.keys(obj).some(key => values.has(key))) return obj
    return Object.fromEntries(Object.entries(obj).map(([key, v]) => [values.get(key) ?? key, v]))
}

function migrate(node: unknown, version: number): void {
    if (Array.isArray(node)) {
        for (const item of node) migrate(item, version)
        return
    }
    if (!isRecord(node)) return
    const obj = node

    /*
        A blueprint and a book each declare their own version, so descending into
        one re-scopes which migrations apply. That is more accurate than the
        textual pass could be: a 2.0 book can hold a blueprint exported years
        earlier, and only that entry should be migrated.
    */
    const scoped = typeof obj.version === 'number' ? obj.version : version
    const { values, names, dropRecipes } = applicableTo(scoped)

    /*
        The walk carries on even when nothing applies at this level. A 2.0 book
        entry needs no migration itself and still has to be descended into, since
        the blueprint inside it may declare an older version than the book does.
    */
    for (const [key, value] of Object.entries(obj)) {
        if (isRecord(value)) {
            const renamedKeys = renameKeys(value, values)
            if (renamedKeys !== value) obj[key] = renamedKeys
            migrate(renamedKeys, scoped)
            continue
        }
        if (typeof value !== 'string') {
            migrate(value, scoped)
            continue
        }

        if (key === 'recipe' && dropRecipes.has(value)) {
            delete obj.recipe
            continue
        }
        if (key === 'name') {
            const renamedName = names.get(value)
            if (renamedName !== undefined) {
                obj.name = renamedName
                continue
            }
        }
        const renamed = values.get(value)
        if (renamed !== undefined) obj[key] = renamed
    }
}

/**
 * Rewrites legacy prototype names in a freshly parsed blueprint string, in
 * place, applying only the renames that the version each blueprint declares
 * calls for. A blueprint with no version is treated as older than every
 * threshold - Factorio always writes one, so the alternative would be keeping
 * names that no longer resolve in a string that is already malformed.
 */
function migrateNames(data: unknown): void {
    migrate(data, 0)
}

export { migrateNames }
