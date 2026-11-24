import { existsSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vite-plus/test'
import FD, { hasIcon, loadData } from '../packages/editor/src/core/factorioData'

/*
    The planet, space-location and quality prototypes in the committed data.json
    (#652), and the one assumption the editor makes about them.

    `F.CreateIcon` looks a name up in every collection in turn and takes the
    first hit, with no signal type to tell a quality `rare` from anything else
    called `rare`. That is safe only while no name is shared. This reads the real
    data rather than a fixture, so a data refresh that introduces a clash - or
    drops a collection, or an icon's texture - fails here.
*/

const OUTPUT = 'packages/exporter/data/output'

const PLANETS = ['nauvis', 'vulcanus', 'fulgora', 'gleba', 'aquilo']
const OTHER_LOCATIONS = ['solar-system-edge', 'shattered-planet']
const QUALITIES = ['normal', 'uncommon', 'rare', 'epic', 'legendary']

beforeAll(() => {
    loadData(readFileSync(`${OUTPUT}/data.json`, 'utf8'))
})

describe('planet, space-location and quality prototypes in data.json', () => {
    it('carries every planet, space location and quality, each as an icon', () => {
        for (const name of PLANETS) expect(FD.spaceLocations[name]?.type, name).toBe('planet')
        for (const name of OTHER_LOCATIONS) {
            expect(FD.spaceLocations[name]?.type, name).toBe('space-location')
        }
        for (const name of QUALITIES) expect(FD.qualities[name]?.type, name).toBe('quality')

        for (const proto of [...Object.values(FD.spaceLocations), ...Object.values(FD.qualities)]) {
            expect(hasIcon(proto), `${proto.name} has no icon`).toBe(true)
        }
    })

    it('leaves out the engine placeholders', () => {
        expect(FD.spaceLocations['space-location-unknown']).toBeUndefined()
        expect(FD.qualities['quality-unknown']).toBeUndefined()
    })

    it('has a compressed texture for every icon', () => {
        const missing: string[] = []
        for (const proto of [...Object.values(FD.spaceLocations), ...Object.values(FD.qualities)]) {
            const layers = proto.icons?.map(layer => layer.icon) ?? [proto.icon]
            for (const icon of layers) {
                // `__mod__/path.png` is written to `data/output/__mod__/path.basis`.
                if (
                    icon === undefined ||
                    !existsSync(`${OUTPUT}/${icon.replace('.png', '.basis')}`)
                ) {
                    missing.push(`${proto.name}: ${icon}`)
                }
            }
        }
        expect(missing).toEqual([])
    })

    it('shares no name with an item, fluid, recipe, signal, entity or inventory group', () => {
        const groups = new Set(FD.inventoryLayout.map(group => group.name))
        const clashes: string[] = []
        for (const name of [...Object.keys(FD.spaceLocations), ...Object.keys(FD.qualities)]) {
            const where = [
                ['items', FD.items],
                ['fluids', FD.fluids],
                ['recipes', FD.recipes],
                ['signals', FD.signals],
                ['entities', FD.entities],
            ]
                .filter(([, collection]) => (collection as Record<string, unknown>)[name])
                .map(([label]) => label as string)
            if (groups.has(name)) where.push('inventoryLayout')
            if (FD.spaceLocations[name] && FD.qualities[name]) where.push('both new collections')
            if (where.length > 0) clashes.push(`${name} is also in ${where.join(', ')}`)
        }
        expect(clashes).toEqual([])
    })
})
