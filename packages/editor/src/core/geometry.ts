import Delaunator from 'delaunator'
import { IPoint } from '../types'

/*
    Point geometry for the wire code. This was generators/util.ts, shared with
    the oil outpost generator until G moved to the oil field planner; only what
    the wire code still calls is kept. pointsToTriangles is what
    WireConnections.generatePowerPoleWires uses to wire up the power poles of a
    pre-1.1.11 blueprint, which carried no wires of its own.
*/

/** Returns unique points from points array */
const uniqPoints = <T extends IPoint>(list: T[]): T[] =>
    list
        .sort((a, b) => (a.x - b.x ? a.x - b.x : a.y - b.y))
        .filter((v, i, arr) => i === 0 || !(v.x === arr[i - 1].x && v.y === arr[i - 1].y))

const pointToArray = (point: IPoint): number[] => [point.x, point.y]

const manhattenDistance = (p0: IPoint, p1: IPoint): number =>
    Math.abs(p0.x - p1.x) + Math.abs(p0.y - p1.y)

const pointInCircle = (point: IPoint, origin: IPoint, r: number): boolean =>
    Math.pow(origin.x - point.x, 2) + Math.pow(origin.y - point.y, 2) <= r * r

const range = (from: number, to: number): number[] =>
    [...Array(to - from).keys()].map(i => from + i)

// https://stackoverflow.com/a/38024982
/** Returns the angle (0-360) anticlockwise from the horizontal for a point on a circle */
const getAngle = (cX: number, cY: number, pX: number, pY: number): number => {
    const x = pX - cX
    const y = pY - cY
    if (x === 0 && y === 0) return 0
    const angle = (Math.acos(x / Math.sqrt(x * x + y * y)) * 180) / Math.PI
    if (y < 0) return 360 - angle
    return angle
}

/**
 * Creates triangles between points based on delaunay triangulation
 *
 * If triangles can not be formed, it's going to return lines
 */
const pointsToTriangles = <T extends IPoint>(nodes: T[]): T[][] => {
    const filteredNodes = uniqPoints(nodes)

    if (filteredNodes.length === 1) return [[filteredNodes[0], filteredNodes[0]]]
    if (filteredNodes.length === 2) return [filteredNodes]

    // Check that nodes are not collinear
    let lastSlope = 0
    for (let i = 0; i < filteredNodes.length; i++) {
        if (i === filteredNodes.length - 1) {
            return filteredNodes.flatMap((_, i, arr) => (i === 0 ? [] : [[arr[i - 1], arr[i]]]))
        }
        const node = filteredNodes[i]
        const next = filteredNodes[i + 1]
        const dX = Math.abs(node.x - next.x)
        const dY = Math.abs(node.y - next.y)
        if (i === 0) {
            lastSlope = dY / dX
        } else if (lastSlope !== dY / dX) {
            break
        }
    }

    const delaunay = Delaunator.from(filteredNodes.map(pointToArray))

    // Return triangles from delaunay data
    return range(0, delaunay.triangles.length / 3).map(t =>
        [3 * t, 3 * t + 1, 3 * t + 2].map(e => filteredNodes[delaunay.triangles[e]])
    )
}

export default {
    uniqPoints,
    pointToArray,
    manhattenDistance,
    pointInCircle,
    range,
    getAngle,
    pointsToTriangles,
}
