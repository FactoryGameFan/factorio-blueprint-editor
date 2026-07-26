import { describe, expect, it } from 'vite-plus/test'
import { migrateNames } from './nameMigrations'

/*
    These migrations used to be a textual pass over the decoded JSON, run before
    JSON.parse in bpString.decode(). That is why they could not be version-aware:
    the version they needed to test lives inside the string being rewritten.

    Two things are pinned here. That an ancient blueprint still migrates exactly
    as the textual pass migrated it - see LEGACY_TABLE, a frozen copy of the old
    implementation, which is the only thing that can prove that. And that a
    blueprint declaring a version at or above a group's threshold is left alone,
    which is issue #40: `stack-inserter` and `fusion-reactor-equipment` are live
    prototypes again, so applying their renames unconditionally rewrote current
    blueprints.
*/

/** How Factorio packs a version into the blueprint's `version` field. */
const version = (main: number, major: number, minor: number, dev = 0): number =>
    main * 2 ** 48 + major * 2 ** 32 + minor * 2 ** 16 + dev

const V_0_16 = version(0, 16, 51)
const V_0_17_5 = version(0, 17, 5)
const V_1_1 = version(1, 1, 107)
const V_2_0 = version(2, 0, 55)

/*
    A verbatim copy of the table and the regex that lived in bpString.ts. Do not
    tidy it or re-derive it from the new groups - a copy that shares code with the
    thing it checks proves nothing.
*/
const LEGACY_TABLE: Record<string, string> = {
    '"raw-wood"': '"wood"',
    '"science-pack-1"': '"automation-science-pack"',
    '"science-pack-2"': '"logistic-science-pack"',
    '"science-pack-3"': '"chemical-science-pack"',
    '"high-tech-science-pack"': '"utility-science-pack"',
    ',"recipe":"wood"': '',
    ',"recipe":"steel-axe"': '',
    ',"recipe":"iron-axe"': '',

    '"grass-1"': '"landfill"',

    ',"recipe":"rocket-control-unit"': '',
    ',"name":"rocket-control-unit"': ',"name":"raw-fish"',
    '"stack-inserter"': '"bulk-inserter"',
    '"stack-filter-inserter"': '"bulk-inserter"',
    '"filter-inserter"': '"fast-inserter"',
    '"effectivity-module"': '"efficiency-module"',
    '"effectivity-module-2"': '"efficiency-module-2"',
    '"effectivity-module-3"': '"efficiency-module-3"',
    '"used-up-uranium-fuel-cell"': '"depleted-uranium-fuel-cell"',
    '"curved-rail"': '"legacy-curved-rail"',
    '"logistic-chest-storage"': '"storage-chest"',
    '"logistic-chest-buffer"': '"buffer-chest"',
    '"logistic-chest-requester"': '"requester-chest"',
    '"logistic-chest-active-provider"': '"active-provider-chest"',
    '"logistic-chest-passive-provider"': '"passive-provider-chest"',
    '"fusion-reactor-equipment"': '"fission-reactor-equipment"',
    '"empty-barrel"': '"barrel"',
    '"fill-water-barrel"': '"water-barrel"',
    '"fill-crude-oil-barrel"': '"crude-oil-barrel"',
    '"fill-petroleum-gas-barrel"': '"petroleum-gas-barrel"',
    '"fill-light-oil-barrel"': '"light-oil-barrel"',
    '"fill-heavy-oil-barrel"': '"heavy-oil-barrel"',
    '"fill-lubricant-barrel"': '"lubricant-barrel"',
    '"fill-sulfuric-acid-barrel"': '"sulfuric-acid-barrel"',
}
const legacyRegex = new RegExp(Object.keys(LEGACY_TABLE).join('|'), 'g')

const legacyMigrated = (json: string): unknown =>
    JSON.parse(json.replace(legacyRegex, match => LEGACY_TABLE[match]))

const migrated = (json: string): any => {
    const data = JSON.parse(json)
    migrateNames(data)
    return data
}

/*
    Key order matters to the frozen implementation - three of its rows match on a
    leading comma, so they only fire when the field is not first in its object.
    These fragments keep Factorio's own field order for that reason.
*/
const blueprint = (v: number, body: string): string =>
    `{"blueprint":{"item":"blueprint","label":"test","version":${v},${body}}}`

const machine = (n: number, recipe: string): string =>
    `{"entity_number":${n},"name":"assembling-machine-2","position":{"x":${n}.5,"y":0.5},"recipe":"${recipe}"}`

const entity = (n: number, name: string): string =>
    `{"entity_number":${n},"name":"${name}","position":{"x":${n}.5,"y":0.5}}`

/** Every row of the table, in the places a real blueprint carries these names. */
const everything = (v: number): string =>
    blueprint(
        v,
        `"icons":[{"signal":{"type":"item","name":"science-pack-1"},"index":1}],` +
            `"entities":[` +
            [
                machine(1, 'wood'),
                machine(2, 'steel-axe'),
                machine(3, 'iron-axe'),
                machine(4, 'high-tech-science-pack'),
                machine(5, 'fill-water-barrel'),
                machine(6, 'fill-sulfuric-acid-barrel'),
                machine(7, 'fusion-reactor-equipment'),
                entity(8, 'stack-inserter'),
                entity(9, 'stack-filter-inserter'),
                entity(10, 'curved-rail'),
                entity(11, 'logistic-chest-passive-provider'),
                `{"entity_number":12,"name":"filter-inserter","position":{"x":12.5,"y":0.5},"filters":[{"index":1,"name":"raw-wood"},{"index":2,"name":"empty-barrel"}]}`,
                `{"entity_number":13,"name":"logistic-chest-requester","position":{"x":13.5,"y":0.5},"request_filters":[{"index":1,"name":"science-pack-2","count":10}]}`,
                // Pre-2.0 `items` is a name -> count map, so module names are keys.
                `{"entity_number":14,"name":"beacon","position":{"x":14.5,"y":0.5},"items":{"effectivity-module-3":2}}`,
                `{"entity_number":15,"name":"nuclear-reactor","position":{"x":15.5,"y":0.5},"items":{"used-up-uranium-fuel-cell":1}}`,
            ].join(',') +
            `],"tiles":[{"name":"grass-1","position":{"x":0,"y":0}}]`
    )

describe('migrateNames, against the textual pass it replaced', () => {
    it('migrates a 0.16 blueprint identically', () => {
        const json = everything(V_0_16)
        expect(migrated(json)).toEqual(legacyMigrated(json))
    })

    /*
        Only a blueprint below *every* threshold can be compared to the frozen
        implementation, because that is the one case where "all rows apply" was
        the right answer. A 1.1 blueprint is below the 2.0 threshold and at or
        above both 0.17 ones, so it gets one group and not the others - which is
        the whole point of the change and cannot be checked differentially.
    */
    it('applies only the group a 1.1 blueprint is below', () => {
        const bp = migrated(everything(V_1_1)).blueprint

        // 2.0 group: applies.
        expect(bp.entities[7].name).toBe('bulk-inserter')
        expect(bp.entities[9].name).toBe('legacy-curved-rail')
        expect(bp.entities[6].recipe).toBe('fission-reactor-equipment')
        expect(bp.entities[11].filters[1].name).toBe('barrel')

        // 0.17 groups: do not.
        expect(bp.entities[3].recipe).toBe('high-tech-science-pack')
        expect(bp.entities[11].filters[0].name).toBe('raw-wood')
        expect(bp.tiles[0].name).toBe('grass-1')
        expect(bp.entities[0].recipe).toBe('wood')
    })

    it('migrates a book identically, including nested books', () => {
        const json =
            `{"blueprint_book":{"item":"blueprint-book","version":${V_0_16},"active_index":0,` +
            `"icons":[{"signal":{"type":"item","name":"science-pack-3"},"index":1}],"blueprints":[` +
            `{"index":0,"blueprint":{"item":"blueprint","version":${V_0_16},"entities":[${entity(1, 'stack-inserter')}]}},` +
            `{"index":1,"blueprint_book":{"item":"blueprint-book","version":${V_0_16},"blueprints":[` +
            `{"index":0,"blueprint":{"item":"blueprint","version":${V_0_16},"entities":[${machine(1, 'iron-axe')}]}}]}}` +
            `]}}`
        expect(migrated(json)).toEqual(legacyMigrated(json))
    })
})

describe('migrateNames version conditions', () => {
    it('leaves a 2.0 blueprint alone (issue #40)', () => {
        const json = everything(V_2_0)
        expect(migrated(json)).toEqual(JSON.parse(json))
    })

    it('keeps a 2.0 stack-inserter a stack-inserter', () => {
        const json = blueprint(V_2_0, `"entities":[${entity(1, 'stack-inserter')}]`)
        expect(migrated(json).blueprint.entities[0].name).toBe('stack-inserter')
    })

    it('keeps a 2.0 fusion-reactor-equipment recipe', () => {
        const json = blueprint(V_2_0, `"entities":[${machine(1, 'fusion-reactor-equipment')}]`)
        expect(migrated(json).blueprint.entities[0].recipe).toBe('fusion-reactor-equipment')
    })

    it('still renames a pre-2.0 stack-inserter to bulk-inserter', () => {
        const json = blueprint(V_1_1, `"entities":[${entity(1, 'stack-inserter')}]`)
        expect(migrated(json).blueprint.entities[0].name).toBe('bulk-inserter')
    })

    it('applies a 0.17 rename to a 0.16 blueprint but not to a 0.17.5 one', () => {
        const old = blueprint(
            V_0_16,
            `"entities":[${entity(1, 'inserter')}],"tiles":[{"name":"grass-1","position":{"x":0,"y":0}}]`
        )
        const newer = blueprint(V_0_17_5, `"entities":[${machine(1, 'science-pack-1')}]`)

        // grass-1 -> landfill is the 0.17.10 group, so 0.17.5 is still below it.
        expect(migrated(old).blueprint.tiles[0].name).toBe('landfill')
        // science-pack-1 is the 0.17.0 group, and 0.17.5 is at or above it.
        expect(migrated(newer).blueprint.entities[0].recipe).toBe('science-pack-1')
    })

    it('scopes the version to the blueprint that declares it, not the book', () => {
        // A 2.0 book can hold a blueprint someone exported years earlier.
        const json =
            `{"blueprint_book":{"item":"blueprint-book","version":${V_2_0},"blueprints":[` +
            `{"index":0,"blueprint":{"item":"blueprint","version":${V_1_1},"entities":[${entity(1, 'stack-inserter')}]}},` +
            `{"index":1,"blueprint":{"item":"blueprint","version":${V_2_0},"entities":[${entity(1, 'stack-inserter')}]}}` +
            `]}}`
        const bps = migrated(json).blueprint_book.blueprints
        expect(bps[0].blueprint.entities[0].name).toBe('bulk-inserter')
        expect(bps[1].blueprint.entities[0].name).toBe('stack-inserter')
    })

    it('treats a blueprint with no version as older than every threshold', () => {
        /*
            Factorio always writes a version, so this is the corrupt-or-hand-made
            case. Migrating it is what the textual pass did, and the alternative -
            treating it as current - would silently keep names that no longer
            resolve. Not the same call as Blueprint.ts's version guards, which read
            `data.version !== undefined` because PaintBlueprintContainer builds a
            version-less Blueprint for copy/paste that never comes through here.
        */
        const json = `{"blueprint":{"item":"blueprint","entities":[${entity(1, 'stack-inserter')}]}}`
        expect(migrated(json).blueprint.entities[0].name).toBe('bulk-inserter')
    })
})

describe('migrateNames field-specific rows', () => {
    it('drops a recipe field the rename table maps to nothing', () => {
        const json = blueprint(V_1_1, `"entities":[${machine(1, 'rocket-control-unit')}]`)
        expect(migrated(json).blueprint.entities[0]).not.toHaveProperty('recipe')
    })

    it('renames rocket-control-unit to raw-fish in a name field', () => {
        const json = blueprint(
            V_1_1,
            `"icons":[{"signal":{"type":"item","name":"rocket-control-unit"},"index":1}]`
        )
        expect(migrated(json).blueprint.icons[0].signal.name).toBe('raw-fish')
    })

    it('drops a recipe field wherever it sits in its object', () => {
        /*
            The frozen implementation matched `,"recipe":"wood"` and so needed a
            preceding field; this one does not. No blueprint Factorio writes puts
            `recipe` first, so the difference is unreachable in practice - pinned
            because it is a deliberate divergence rather than an oversight.
        */
        const json = `{"blueprint":{"version":${V_1_1},"entities":[{"recipe":"rocket-control-unit","entity_number":1,"name":"assembling-machine-2","position":{"x":0.5,"y":0.5}}]}}`
        expect(migrated(json).blueprint.entities[0]).not.toHaveProperty('recipe')
    })

    it('leaves a name that is not in the table alone', () => {
        const json = blueprint(V_1_1, `"entities":[${entity(1, 'fast-inserter')}]`)
        expect(migrated(json).blueprint.entities[0].name).toBe('fast-inserter')
    })
})
