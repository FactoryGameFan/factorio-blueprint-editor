import EventEmitter from 'eventemitter3'
import { IBPConnection, IConnSide, IPoint, IWireColor, BlueprintWire, WireColor } from '../types'
import FD, { getMaxWireDistance } from './factorioData'
import U from './generators/util'
import { Blueprint } from './Blueprint'
import { WireConnectionMap } from './WireConnectionMap'

const MAX_POLE_CONNECTION_COUNT = 5

/** A wire endpoint anchored to one of an entity's connection points. */
export interface IEntityConnectionPoint {
    entityNumber: number
    entitySide: number
}

/**
 * A wire endpoint that is a bare world position. Only the wire currently being
 * dragged has one - it is where the cursor is, before the far end is anchored.
 */
export interface ILooseConnectionPoint {
    position: IPoint
}

export type IConnectionPoint = IEntityConnectionPoint | ILooseConnectionPoint

/**
 * A wire between two entities. This is what gets stored, hashed and serialized,
 * so both ends are always anchored.
 */
export interface IConnection {
    color: WireColor
    cps: [IEntityConnectionPoint, IEntityConnectionPoint]
}

/**
 * A wire that can be drawn but not necessarily stored, because one end may still
 * be a loose position. Every IConnection is also drawable.
 */
export interface IDrawableConnection {
    color: WireColor
    cps: [IConnectionPoint, IConnectionPoint]
}

export interface WireConnectionsEvents {
    create: [hash: string, connection: IConnection]
    remove: [hash: string, connection: IConnection]
}

export class WireConnections extends EventEmitter<WireConnectionsEvents> {
    private bp: Blueprint
    private readonly connections = new WireConnectionMap()

    public constructor(bp: Blueprint) {
        super()
        this.bp = bp
    }

    private static hash(conn: IConnection): string {
        // Sorts in place on purpose: this normalises the connection before it is
        // stored, so cps[0] is always the lower entity number afterwards.
        const cps = conn.cps.sort(
            (cp1, cp2) => cp1.entityNumber - cp2.entityNumber || cp1.entitySide - cp2.entitySide
        )
        const [firstE, secondE] = cps.map(cp => cp.entityNumber)
        const [firstS, secondS] = cps.map(cp => cp.entitySide)
        return `${conn.color}-${firstE}-${secondE}-${firstS}-${secondS}`
    }

    public static deserialize(
        entityNumber: number,
        connections: IBPConnection | undefined,
        neighbours: number[] | undefined
    ): IConnection[] {
        const parsedConnections: IConnection[] = []

        const addConnSide = (connSide: IConnSide | undefined, side: '1' | '2'): void => {
            if (connSide === undefined) return
            for (const c in connSide) {
                const color = c as WireColor
                const wires = connSide[color]
                if (wires === undefined) continue
                for (const data of wires) {
                    parsedConnections.push({
                        color,
                        cps: [
                            {
                                entityNumber: entityNumber,
                                entitySide: Number(side),
                            },
                            {
                                entityNumber: data.entity_id,
                                entitySide: data.circuit_id || 1,
                            },
                        ],
                    })
                }
            }
        }

        const addCopperConnSide = (
            wires: IWireColor[] | undefined,
            side: 'Cu0' | 'Cu1',
            color: WireColor
        ): void => {
            // For some reason Cu0 and Cu1 are arrays but the switch can only have 1 copper connection
            const data = wires?.[0]
            if (data === undefined) return
            parsedConnections.push({
                color,
                cps: [
                    {
                        entityNumber: entityNumber,
                        entitySide: Number(side.slice(2, 3)) + 1,
                    },
                    {
                        entityNumber: data.entity_id,
                        entitySide: 1,
                    },
                ],
            })
        }

        if (connections) {
            addConnSide(connections['1'], '1')
            addConnSide(connections['2'], '2')
            // power_switch only connections
            addCopperConnSide(connections.Cu0, 'Cu0', 'copper')
            addCopperConnSide(connections.Cu1, 'Cu1', 'copper')
        }

        if (neighbours) {
            for (const entNr of neighbours) {
                parsedConnections.push(WireConnections.toPoleConnection(entityNumber, entNr))
            }
        }

        return parsedConnections
    }

    // pre 2.0
    public static serialize(
        entityNumber: number,
        connections: IConnection[],
        getType: (entityNumber: number) => string,
        entNrWhitelist?: Set<number>
    ): { connections: IBPConnection | undefined; neighbours: number[] | undefined } {
        const serialized: IBPConnection = {}
        const neighbours: number[] = []

        for (const connection of connections) {
            const isEntity0 = connection.cps[0].entityNumber === entityNumber
            // Not connection.cps.reverse() - that reordered the caller's connection in place
            const [thisE, otherE] = isEntity0
                ? connection.cps
                : [connection.cps[1], connection.cps[0]]
            const entitySide = thisE.entitySide
            const color = connection.color

            if (entNrWhitelist && !entNrWhitelist.has(otherE.entityNumber)) continue

            if (color === 'copper' && getType(otherE.entityNumber) === 'electric-pole') {
                if (getType(entityNumber) === 'electric-pole') {
                    neighbours.push(otherE.entityNumber)
                } else if (getType(entityNumber) === 'power-switch') {
                    const SIDE = `Cu${entitySide - 1}` as 'Cu0' | 'Cu1'
                    let wires = serialized[SIDE]
                    if (wires === undefined) {
                        wires = []
                        serialized[SIDE] = wires
                    }
                    wires.push({
                        entity_id: otherE.entityNumber,
                        wire_id: 0,
                    })
                }
            } else if (color === 'red' || color === 'green') {
                const sideKey = entitySide as 1 | 2
                let side = serialized[sideKey]
                if (side === undefined) {
                    side = {}
                    serialized[sideKey] = side
                }
                let wires = side[color]
                if (wires === undefined) {
                    wires = []
                    side[color] = wires
                }
                wires.push({
                    entity_id: otherE.entityNumber,
                    circuit_id: otherE.entitySide,
                })
            }
        }

        return {
            connections: Object.keys(serialized).length === 0 ? undefined : serialized,
            neighbours: neighbours.length === 0 ? undefined : neighbours,
        }
    }

    private static toPoleConnection(entityNumber1: number, entityNumber2: number): IConnection {
        return {
            color: 'copper',
            cps: [
                {
                    entityNumber: entityNumber1,
                    entitySide: 1,
                },
                {
                    entityNumber: entityNumber2,
                    entitySide: 1,
                },
            ],
        }
    }

    public has(connection: IConnection): boolean {
        const hash = WireConnections.hash(connection)
        return this.connections.has(hash)
    }

    public create(connection: IConnection): void {
        const hash = WireConnections.hash(connection)
        if (this.connections.has(hash)) return

        this.bp.history
            .updateMap(this.connections, hash, connection, 'Connect entities')
            .onDone(this.onCreateOrRemoveConnection.bind(this))
            .commit()
    }

    public remove(connection: IConnection): void {
        const hash = WireConnections.hash(connection)
        if (!this.connections.has(hash)) return

        this.bp.history
            .updateMap(this.connections, hash, undefined, 'Disconnect entities')
            .onDone(this.onCreateOrRemoveConnection.bind(this))
            .commit()
    }

    private onCreateOrRemoveConnection(newValue?: IConnection, oldValue?: IConnection): void {
        if (newValue) {
            this.emit('create', WireConnections.hash(newValue), newValue)
        } else if (oldValue) {
            this.emit('remove', WireConnections.hash(oldValue), oldValue)
        }
    }

    /** The hash must be one that getEntityConnectionHashes handed out. */
    public get(hash: string): IConnection {
        const connection = this.connections.get(hash)
        if (connection === undefined) {
            throw new Error(`Connection ${hash} is indexed but missing from the connection map`)
        }
        return connection
    }

    public forEach(fn: (value: IConnection, key: string) => void): void {
        this.connections.forEach(fn)
    }

    // post 2.0
    public createBpConnections(wires: BlueprintWire[]): void {
        const connections: IConnection[] = []
        const getColorAndSide = (id: defines.wire_connector_id): [WireColor, number] => {
            switch (id) {
                case FD.defines.wire_connector_id.circuit_red:
                    return ['red', 1]
                case FD.defines.wire_connector_id.circuit_green:
                    return ['green', 1]
                case FD.defines.wire_connector_id.combinator_input_red:
                    return ['red', 1]
                case FD.defines.wire_connector_id.combinator_input_green:
                    return ['green', 1]
                case FD.defines.wire_connector_id.combinator_output_red:
                    return ['red', 2]
                case FD.defines.wire_connector_id.combinator_output_green:
                    return ['green', 2]
                case FD.defines.wire_connector_id.pole_copper:
                    return ['copper', 1]
                case FD.defines.wire_connector_id.power_switch_left_copper:
                    return ['copper', 1]
                case FD.defines.wire_connector_id.power_switch_right_copper:
                    return ['copper', 2]
                default:
                    throw new Error('Missing mapping!')
            }
        }
        for (const wire of wires) {
            const [c0, s0] = getColorAndSide(wire[1])
            const [c1, s1] = getColorAndSide(wire[3])
            if (c0 !== c1) {
                throw new Error('Wire color mismatch!')
            }
            connections.push({
                color: c0,
                cps: [
                    {
                        entityNumber: wire[0],
                        entitySide: s0,
                    },
                    {
                        entityNumber: wire[2],
                        entitySide: s1,
                    },
                ],
            })
        }
        for (const conn of connections) {
            this.create(conn)
        }
    }

    // pre 2.0
    public createEntityConnections(
        entityNumber: number,
        connections: IBPConnection,
        neighbours: number[]
    ): void {
        const conns = WireConnections.deserialize(entityNumber, connections, neighbours)
        for (const conn of conns) {
            this.create(conn)
        }
    }

    public removeEntityConnections(entityNumber: number): void {
        const conns = this.getEntityConnections(entityNumber)
        for (const conn of conns) {
            this.remove(conn)
        }
    }

    public getEntityConnectionHashes(entityNumber: number): string[] {
        return this.connections.getEntityConnectionHashes(entityNumber)
    }

    public getEntityConnections(entityNumber: number): IConnection[] {
        return this.connections.getEntityConnections(entityNumber)
    }

    // post 2.0
    public serializeBpWires(): BlueprintWire[] {
        const wires: BlueprintWire[] = []
        const getId = (type: string, color: string, side: number): defines.wire_connector_id => {
            switch (color) {
                case 'red':
                    switch (type) {
                        case 'arithmetic-combinator':
                        case 'decider-combinator':
                        case 'selector-combinator':
                            if (side === 1) {
                                return FD.defines.wire_connector_id.combinator_input_red
                            } else {
                                return FD.defines.wire_connector_id.combinator_output_red
                            }
                        default:
                            return FD.defines.wire_connector_id.circuit_red
                    }
                case 'green':
                    switch (type) {
                        case 'arithmetic-combinator':
                        case 'decider-combinator':
                        case 'selector-combinator':
                            if (side === 1) {
                                return FD.defines.wire_connector_id.combinator_input_green
                            } else {
                                return FD.defines.wire_connector_id.combinator_output_green
                            }
                        default:
                            return FD.defines.wire_connector_id.circuit_green
                    }
                case 'copper':
                    switch (type) {
                        case 'power-switch': {
                            if (side === 1) {
                                return FD.defines.wire_connector_id.power_switch_left_copper
                            } else {
                                return FD.defines.wire_connector_id.power_switch_right_copper
                            }
                        }
                        case 'electric-pole':
                            return FD.defines.wire_connector_id.pole_copper
                        default:
                            throw new Error('Missing mapping!')
                    }
                default:
                    throw new Error('Missing mapping!')
            }
        }
        for (const conn of this.connections.values()) {
            const en0 = conn.cps[0].entityNumber
            const en1 = conn.cps[1].entityNumber
            const id0 = getId(this.entityType(en0), conn.color, conn.cps[0].entitySide)
            const id1 = getId(this.entityType(en1), conn.color, conn.cps[1].entitySide)
            wires.push([en0, id0, en1, id1])
        }
        return wires
    }

    /**
     * Throws rather than skipping the wire: a connection to an entity the blueprint
     * does not have cannot be serialized, and dropping it would silently export a
     * blueprint that is missing wires.
     */
    private entityType(entityNumber: number): string {
        const entity = this.bp.entities.get(entityNumber)
        if (entity === undefined) {
            throw new Error(
                `Wire connects to entity ${entityNumber}, which is not in the blueprint`
            )
        }
        return entity.type
    }

    // pre 2.0
    public serializeConnectionData(
        entityNumber: number,
        entNrWhitelist?: Set<number>
    ): { connections: IBPConnection | undefined; neighbours: number[] | undefined } {
        const connections = this.getEntityConnections(entityNumber)
        return WireConnections.serialize(
            entityNumber,
            connections,
            entityNumber => this.entityType(entityNumber),
            entNrWhitelist
        )
    }

    public connectPowerPole(entityNumber: number): void {
        const entity = this.bp.entities.get(entityNumber)
        if (entity === undefined || entity.type !== 'electric-pole') return

        const areaSize = (entity.maxWireDistance + 1) * 2

        const poles = this.bp.entityPositionGrid
            .getEntitiesInArea({
                x: entity.position.x,
                y: entity.position.y,
                w: areaSize,
                h: areaSize,
            })
            .filter(
                e =>
                    e !== entity &&
                    e.type === 'electric-pole' &&
                    this.getEntityConnections(e.entityNumber).filter(c => c.color === 'copper')
                        .length < MAX_POLE_CONNECTION_COUNT &&
                    U.pointInCircle(
                        e.position,
                        entity.position,
                        Math.min(e.maxWireDistance, entity.maxWireDistance)
                    )
            )
            .sort(
                (a, b) =>
                    U.manhattenDistance(a.position, entity.position) -
                    U.manhattenDistance(b.position, entity.position)
            )

        let counter = MAX_POLE_CONNECTION_COUNT
        const blacklist = new Set<number>()
        for (const pole of poles) {
            if (counter === 0) break
            if (blacklist.has(pole.entityNumber)) continue
            counter -= 1

            blacklist.add(pole.entityNumber)
            for (const connection of this.getEntityConnections(pole.entityNumber)) {
                if (connection.color === 'copper') {
                    const otherEntNr =
                        pole.entityNumber === connection.cps[0].entityNumber
                            ? connection.cps[1].entityNumber
                            : connection.cps[0].entityNumber
                    blacklist.add(otherEntNr)
                }
            }

            this.create(WireConnections.toPoleConnection(entity.entityNumber, pole.entityNumber))
        }
    }

    public generatePowerPoleWires(): void {
        interface IPole extends IPoint {
            entityNumber: number
            name: string
        }

        const poles = this.bp.entities
            .filter(e => e.type === 'electric-pole')
            .map<IPole>(e => ({
                entityNumber: e.entityNumber,
                name: e.name,
                x: e.position.x,
                y: e.position.y,
            }))

        if (poles.length < 2) return

        const poleSetsTriangles = U.pointsToTriangles(poles).map(tri =>
            tri
                .flatMap<[IPole, IPole]>((_, i, arr) => {
                    if (i === arr.length - 1) return [[arr[0], arr[i]]]
                    return [[arr[i], arr[i + 1]]]
                })
                .filter(([pole0, pole1]) =>
                    U.pointInCircle(
                        pole0,
                        pole1,
                        Math.min(
                            getMaxWireDistance(FD.entities[pole0.name]),
                            getMaxWireDistance(FD.entities[pole1.name])
                        )
                    )
                )
        )

        const poleSets = poleSetsTriangles
            .flat()
            .sort((a, b) => {
                const minPos = (l: IPole[]): number =>
                    Math.min(l[0].x, l[1].x) + Math.min(l[0].y, l[1].y)
                return minPos(a) - minPos(b)
            })
            .sort((a, b) => U.manhattenDistance(a[0], a[1]) - U.manhattenDistance(b[0], b[1]))

        const hashPoleSet = ([pole0, pole1]: [IPole, IPole]): string => {
            const min = Math.min(pole0.entityNumber, pole1.entityNumber)
            const max = Math.max(pole0.entityNumber, pole1.entityNumber)
            return `${min}-${max}`
        }

        const hashedTriangles = poleSetsTriangles
            .filter(lines => lines.length === 3)
            .map(lines => lines.map(hashPoleSet))

        const finalPoleSets: [IPole, IPole][] = []
        const addedMap: Set<string> = new Set()

        let poleSet: [IPole, IPole] | undefined
        while ((poleSet = poleSets.shift()) !== undefined) {
            const hash = hashPoleSet(poleSet)

            const formsATriangle = hashedTriangles
                .filter(tri => tri.includes(hash))
                .map(tri => tri.filter(h => h !== hash))
                .map(oLines => oLines.every(h => addedMap.has(h)))
                .reduce((acc, bool) => acc || bool, false)

            if (!formsATriangle) {
                finalPoleSets.push(poleSet)
                addedMap.add(hash)
            }
        }

        for (const poleSet of finalPoleSets) {
            this.create(
                WireConnections.toPoleConnection(poleSet[0].entityNumber, poleSet[1].entityNumber)
            )
        }
    }

    public getPowerPoleDirection(entityNumber: number): number {
        const connections = this.getEntityConnections(entityNumber).map(conn =>
            entityNumber === conn.cps[0].entityNumber
                ? conn.cps[1].entityNumber
                : conn.cps[0].entityNumber
        )
        if (connections.length === 0) return 0

        const points = connections
            .map(entNr => this.bp.entities.get(entNr))
            .filter(e => !!e)
            .map(ent => ent.position)

        if (points.length === 0) return 0

        const pole = this.bp.entities.get(entityNumber)
        if (pole === undefined) return 0

        return getPowerPoleRotation(pole.position, points)

        function getPowerPoleRotation(centre: IPoint, points: IPoint[]): number {
            const sectorSum = points
                .map(p =>
                    U.getAngle(0, 0, p.x - centre.x, (p.y - centre.y) * -1 /* invert Y axis */)
                )
                .map(angleToSector)
                .reduce<number>((acc, sec) => acc + sec, 0)

            return Math.floor(sectorSum / points.length) * 4

            function angleToSector(angle: number): 0 | 1 | 2 | 3 {
                const cwAngle = 360 - angle
                const sectorAngle = 360 / 8
                const offset = sectorAngle * 1.5
                let newAngle = cwAngle - offset
                if (Math.sign(newAngle) === -1) {
                    newAngle = 360 + newAngle
                }
                const sector = Math.floor(newAngle / sectorAngle)
                return (sector % 4) as 0 | 1 | 2 | 3
            }
        }
    }
}
