import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'

/*
    Builds a blueprint string containing one of every entity in data.json, so the
    sprite builder's per-type draw_* functions can all be exercised in one load.

    The curated blueprints in wormeyman-tests/ are real bases and only happen to
    contain the entity types their authors used; this reaches the rest.
*/

const DATA_JSON = path.resolve(process.cwd(), 'packages/exporter/data/output/data.json')

/** Matches the version the test blueprints carry, so it parses as post-2.0. */
const FACTORIO_VERSION = 562949957025792

/** Wider than the largest entity (rocket-silo, 9x9) so nothing overlaps. */
const STRIDE = 16
const PER_ROW = 20

interface RawEntity {
    entity_number: number
    name: string
    position: { x: number; y: number }
    direction?: number
}

type BoundingBox = [[number, number], [number, number]]

function entitySize(proto: Record<string, unknown>): { x: number; y: number } {
    const box = (proto.selection_box ?? proto.collision_box) as BoundingBox | undefined
    if (!Array.isArray(box)) return { x: 1, y: 1 }
    const [[x1, y1], [x2, y2]] = box
    return { x: Math.max(1, Math.round(x2 - x1)), y: Math.max(1, Math.round(y2 - y1)) }
}

export interface AllEntitiesBlueprint {
    /** The encoded blueprint string, ready for getBlueprintOrBookFromSource */
    source: string
    /** Every entity name placed in it */
    names: string[]
}

/**
 * @param directions which directions to place a copy of each entity in. Entities
 * that cannot face a direction still have to produce sprites rather than throw.
 */
export function buildAllEntitiesBlueprint(directions: number[] = [0]): AllEntitiesBlueprint {
    const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf-8')) as {
        entities: Record<string, Record<string, unknown>>
    }
    const names: string[] = Object.keys(data.entities).sort()

    const entities: RawEntity[] = []
    let slot = 0
    for (const direction of directions) {
        for (const name of names) {
            const size = entitySize(data.entities[name])
            const col = slot % PER_ROW
            const row = Math.floor(slot / PER_ROW)
            slot += 1
            entities.push({
                entity_number: entities.length + 1,
                name,
                // odd-sized entities sit on tile centres, even-sized on tile corners
                position: {
                    x: col * STRIDE + (size.x % 2 === 0 ? 0 : 0.5),
                    y: row * STRIDE + (size.y % 2 === 0 ? 0 : 0.5),
                },
                ...(direction === 0 ? {} : { direction }),
            })
        }
    }

    const blueprint = {
        blueprint: {
            item: 'blueprint',
            label: 'all entities',
            entities,
            version: FACTORIO_VERSION,
        },
    }

    const json = JSON.stringify(blueprint)
    const source =
        '0' + zlib.deflateSync(Buffer.from(json, 'utf-8'), { level: 9 }).toString('base64')
    return { source, names }
}
