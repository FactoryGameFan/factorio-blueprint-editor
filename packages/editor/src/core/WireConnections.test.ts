import { describe, it, expect } from 'vite-plus/test'
import { IBPConnection } from '../types'
import { IConnection, WireConnections } from './WireConnections'

/*
    Characterization tests for the pre-2.0 wire (de)serialization.

    `deserialize` is live: Blueprint.ts calls it through `createEntityConnections`
    for every entity in a pre-2.0 blueprint, so anything that changes here changes
    how old blueprints load. `serialize` is its inverse and is currently only
    reachable from a commented-out line in Entity.ts, but it is tested alongside
    because the two formats have to agree if it is ever switched back on.

    These assert what the code does today, not what it should do. A diff here means
    a refactor changed behaviour.

    The instance methods are not covered: they need a Blueprint, which needs FD
    loaded from data.json. Wire creation, hashing and rendering are exercised end to
    end by the Playwright suite instead.
*/

/** serialize needs to know entity types; these tests only ever ask about a few. */
const typeMap =
    (types: Record<number, string>) =>
    (entityNumber: number): string =>
        types[entityNumber] ?? 'container'

describe('WireConnections.deserialize (pre-2.0)', () => {
    it('reads a red wire off side 1', () => {
        const conns: IBPConnection = { '1': { red: [{ entity_id: 5, circuit_id: 1 }] } }
        expect(WireConnections.deserialize(1, conns, undefined)).toEqual([
            {
                color: 'red',
                cps: [
                    { entityNumber: 1, entitySide: 1 },
                    { entityNumber: 5, entitySide: 1 },
                ],
            },
        ])
    })

    it('defaults a missing circuit_id to side 1', () => {
        const conns: IBPConnection = { '1': { green: [{ entity_id: 5 }] } }
        const [conn] = WireConnections.deserialize(1, conns, undefined)
        expect(conn.cps[1]).toEqual({ entityNumber: 5, entitySide: 1 })
    })

    it('keeps the combinator output side distinct from the input side', () => {
        const conns: IBPConnection = { '2': { green: [{ entity_id: 7, circuit_id: 2 }] } }
        expect(WireConnections.deserialize(3, conns, undefined)).toEqual([
            {
                color: 'green',
                cps: [
                    { entityNumber: 3, entitySide: 2 },
                    { entityNumber: 7, entitySide: 2 },
                ],
            },
        ])
    })

    it('reads both wire colours on both sides', () => {
        const conns: IBPConnection = {
            '1': {
                red: [{ entity_id: 2, circuit_id: 1 }],
                green: [{ entity_id: 3, circuit_id: 1 }],
            },
            '2': { red: [{ entity_id: 4, circuit_id: 2 }] },
        }
        const result = WireConnections.deserialize(1, conns, undefined)
        expect(result).toHaveLength(3)
        expect(result.map(c => [c.color, c.cps[0].entitySide, c.cps[1].entityNumber])).toEqual([
            ['red', 1, 2],
            ['green', 1, 3],
            ['red', 2, 4],
        ])
    })

    it('maps Cu0 and Cu1 onto copper sides 1 and 2', () => {
        const cu0: IBPConnection = { Cu0: [{ entity_id: 4, wire_id: 0 }] }
        expect(WireConnections.deserialize(9, cu0, undefined)).toEqual([
            {
                color: 'copper',
                cps: [
                    { entityNumber: 9, entitySide: 1 },
                    { entityNumber: 4, entitySide: 1 },
                ],
            },
        ])

        const cu1: IBPConnection = { Cu1: [{ entity_id: 4, wire_id: 0 }] }
        const [conn] = WireConnections.deserialize(9, cu1, undefined)
        expect(conn.cps[0]).toEqual({ entityNumber: 9, entitySide: 2 })
    })

    it('only reads the first copper connection on a side', () => {
        // Cu0/Cu1 are arrays in the format but a power switch has one wire per side
        const conns: IBPConnection = {
            Cu0: [
                { entity_id: 4, wire_id: 0 },
                { entity_id: 5, wire_id: 0 },
            ],
        }
        const result = WireConnections.deserialize(9, conns, undefined)
        expect(result).toHaveLength(1)
        expect(result[0].cps[1].entityNumber).toBe(4)
    })

    it('turns pole neighbours into copper connections', () => {
        expect(WireConnections.deserialize(1, undefined, [2, 3])).toEqual([
            {
                color: 'copper',
                cps: [
                    { entityNumber: 1, entitySide: 1 },
                    { entityNumber: 2, entitySide: 1 },
                ],
            },
            {
                color: 'copper',
                cps: [
                    { entityNumber: 1, entitySide: 1 },
                    { entityNumber: 3, entitySide: 1 },
                ],
            },
        ])
    })

    it('returns nothing for an entity with no wires', () => {
        expect(WireConnections.deserialize(1, undefined, undefined)).toEqual([])
        expect(WireConnections.deserialize(1, {}, [])).toEqual([])
    })
})

describe('WireConnections.serialize (pre-2.0)', () => {
    const conn = (
        color: IConnection['color'],
        a: [number, number],
        b: [number, number]
    ): IConnection => ({
        color,
        cps: [
            { entityNumber: a[0], entitySide: a[1] },
            { entityNumber: b[0], entitySide: b[1] },
        ],
    })

    it('writes a red wire back onto the side it came from', () => {
        const result = WireConnections.serialize(1, [conn('red', [1, 1], [5, 1])], typeMap({}))
        expect(result).toEqual({
            connections: { '1': { red: [{ entity_id: 5, circuit_id: 1 }] } },
            neighbours: undefined,
        })
    })

    it('writes the connection from the far entity point of view', () => {
        // same connection, serialized for entity 5 instead of entity 1
        const result = WireConnections.serialize(5, [conn('red', [1, 1], [5, 2])], typeMap({}))
        expect(result.connections).toEqual({ '2': { red: [{ entity_id: 1, circuit_id: 1 }] } })
    })

    it('writes pole-to-pole copper as neighbours', () => {
        const types = typeMap({ 1: 'electric-pole', 2: 'electric-pole' })
        const result = WireConnections.serialize(1, [conn('copper', [1, 1], [2, 1])], types)
        expect(result).toEqual({ connections: undefined, neighbours: [2] })
    })

    it('writes power-switch copper as Cu0/Cu1', () => {
        const types = typeMap({ 1: 'power-switch', 2: 'electric-pole' })
        const left = WireConnections.serialize(1, [conn('copper', [1, 1], [2, 1])], types)
        expect(left.connections).toEqual({ Cu0: [{ entity_id: 2, wire_id: 0 }] })

        const right = WireConnections.serialize(1, [conn('copper', [1, 2], [2, 1])], types)
        expect(right.connections).toEqual({ Cu1: [{ entity_id: 2, wire_id: 0 }] })
    })

    it('drops connections to entities outside the whitelist', () => {
        const conns = [conn('red', [1, 1], [5, 1]), conn('red', [1, 1], [6, 1])]
        const result = WireConnections.serialize(1, conns, typeMap({}), new Set([5]))
        expect(result.connections).toEqual({ '1': { red: [{ entity_id: 5, circuit_id: 1 }] } })
    })

    it('returns undefined rather than empty objects when there is nothing to write', () => {
        expect(WireConnections.serialize(1, [], typeMap({}))).toEqual({
            connections: undefined,
            neighbours: undefined,
        })
    })

    it('does not reorder the connection it was handed', () => {
        // serialize used to reverse cps in place, mutating the stored connection
        const connection = conn('red', [1, 1], [5, 2])
        WireConnections.serialize(5, [connection], typeMap({}))
        expect(connection.cps[0].entityNumber).toBe(1)
        expect(connection.cps[1].entityNumber).toBe(5)
    })

    it('round-trips everything deserialize produces', () => {
        const original: IBPConnection = {
            '1': {
                red: [{ entity_id: 2, circuit_id: 1 }],
                green: [{ entity_id: 3, circuit_id: 2 }],
            },
            '2': { red: [{ entity_id: 4, circuit_id: 1 }] },
        }
        const parsed = WireConnections.deserialize(1, original, undefined)
        expect(WireConnections.serialize(1, parsed, typeMap({})).connections).toEqual(original)
    })
})
