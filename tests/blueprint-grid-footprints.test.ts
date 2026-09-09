import { readFileSync } from 'node:fs'
import { beforeAll, expect, it } from 'vite-plus/test'
import { Blueprint } from '../packages/editor/src/core/Blueprint'
import FD, {
    getEntityGridSize,
    getEntitySize,
    loadData,
} from '../packages/editor/src/core/factorioData'
import footprints from '../tools/oracle/fixtures/entity-tile-size.json'

beforeAll(() => {
    loadData(readFileSync('packages/exporter/data/output/data.json', 'utf8'))
})

it('matches all 155 measured tile sizes without changing occupancy sizes', () => {
    expect(Object.keys(footprints.entities)).toHaveLength(155)
    for (const [name, { gameTiles, editorTiles }] of Object.entries(footprints.entities)) {
        const prototype = FD.entities[name]
        expect(getEntityGridSize(prototype), name).toEqual({ x: gameTiles[0], y: gameTiles[1] })
        expect(getEntitySize(prototype), name).toEqual({ x: editorTiles[0], y: editorTiles[1] })
    }
})

it('preserves ordinary rail exports before any Grid position edit', () => {
    const blueprint = new Blueprint({
        entities: [
            { entity_number: 1, name: 'curved-rail-b', position: { x: 4, y: 4 } },
            { entity_number: 2, name: 'wooden-chest', position: { x: 10.5, y: 20.5 } },
        ],
        tiles: [{ name: 'stone-path', position: { x: 8, y: 18 } }],
    })
    blueprint.getGridPositionDisplay()
    const exported = blueprint.serialize()
    // Existing occupancy-based centering, including the import's half-tile shift.
    expect(exported.entities?.map(e => e.position)).toEqual([
        { x: -3, y: -7.5 },
        { x: 3.5, y: 9 },
    ])
    expect(exported.tiles?.map(t => t.position)).toEqual([{ x: 1, y: 6 }])
})

// Expected corners come from the game's fixture and exported coordinates, never
// from the editor's footprint/display helpers. Include all nine mismatches and
// a non-rail control, both cardinal axes, and a tile owning the minimum corner.
for (const name of [
    ...footprints.summary.disagreeing.map(row => row.name),
    'assembling-machine-1',
]) {
    for (const direction of [0, 4, 8, 12]) {
        for (const withTile of [false, true]) {
            it(`${name}, direction ${direction}, tile ${withTile}: displays and exports the measured grid position`, () => {
                const blueprint = new Blueprint({
                    entities: [
                        { entity_number: 1, name, direction, position: { x: 4, y: 4 } },
                        {
                            entity_number: 2,
                            name: 'wooden-chest',
                            position: { x: 10.5, y: 20.5 },
                        },
                    ],
                    tiles: withTile
                        ? [{ name: 'stone-path', position: { x: -20, y: -20 } }]
                        : undefined,
                })
                const livePositions = blueprint.entities.valuesArray().map(e => ({ ...e.position }))
                const measuredPosition = () => {
                    const exported = blueprint.serialize()
                    const corners = (exported.entities ?? []).map(e => {
                        const [width, height] =
                            footprints.entities[e.name as keyof typeof footprints.entities]
                                .gameTiles
                        const sideways = direction === 4 || direction === 12
                        return {
                            x: e.position.x - (sideways ? height : width) / 2,
                            y: e.position.y - (sideways ? width : height) / 2,
                        }
                    })
                    corners.push(...(exported.tiles ?? []).map(t => t.position))
                    return {
                        x: -Math.floor(Math.min(...corners.map(p => p.x))),
                        y: -Math.floor(Math.min(...corners.map(p => p.y))),
                    }
                }
                expect(blueprint.getGridPositionDisplay()).toEqual(measuredPosition())
                for (const target of [
                    { x: 0, y: 0 },
                    { x: -6, y: 12 },
                ]) {
                    const current = blueprint.getGridPositionDisplay()
                    const offset = blueprint.gridPositionOffset
                    blueprint.gridPositionOffset = {
                        x: offset.x + current.x - target.x,
                        y: offset.y + current.y - target.y,
                    }
                    const measured = measuredPosition()
                    expect(measured.x).toBeCloseTo(target.x)
                    expect(measured.y).toBeCloseTo(target.y)
                    expect(blueprint.getGridPositionDisplay()).toEqual(measured)
                }
                expect(blueprint.entities.valuesArray().map(e => e.position)).toEqual(livePositions)
            })
        }
    }
}
