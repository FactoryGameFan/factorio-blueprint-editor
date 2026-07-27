import { describe, expect, test } from 'vitest'
import util from './util'

// util.ts is pure and FD-free, so it can be unit tested - but nothing did.
// The two equivalence helpers are reached only from Entity's setters, which no
// spec drives: entity-accessors.spec.ts tallies getters. So both could start
// answering true for every pair and the whole suite would stay green while
// edits silently no-opped. These pin what they answer today.

describe('sumprod', () => {
    test('sums vectors with no weights', () => {
        expect(util.sumprod({ x: 1, y: 2 }, { x: 10, y: 20 })).toEqual({ x: 11, y: 22 })
    })

    test('accepts tuples and points interchangeably', () => {
        expect(util.sumprod([1, 2], { x: 10, y: 20 })).toEqual({ x: 11, y: 22 })
    })

    test('applies a weight to the vector that follows it', () => {
        expect(util.sumprod(2, { x: 1, y: 3 })).toEqual({ x: 2, y: 6 })
    })

    test('multiplies consecutive weights together', () => {
        expect(util.sumprod(2, 3, { x: 1, y: 1 })).toEqual({ x: 6, y: 6 })
    })

    // The subtraction form every caller uses: sumprod(a, -1, b) is a - b.
    test('negative weights subtract', () => {
        expect(util.sumprod({ x: 5, y: 5 }, -1, { x: 2, y: 1 })).toEqual({ x: 3, y: 4 })
    })

    // A weight applies to one vector only - it is cleared after being consumed.
    // Drop that reset and this becomes { x: 4, y: 4 }.
    test('a weight does not carry over to the next vector', () => {
        expect(util.sumprod(2, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({ x: 3, y: 3 })
    })

    test('no arguments is the origin', () => {
        expect(util.sumprod()).toEqual({ x: 0, y: 0 })
    })

    test('a trailing weight with no vector throws', () => {
        expect(() => util.sumprod({ x: 1, y: 1 }, 2)).toThrow(TypeError)
    })
})

describe('areObjectsEquivalent', () => {
    test('equal own properties are equivalent', () => {
        expect(util.areObjectsEquivalent({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true)
    })

    test('a differing value is not', () => {
        expect(util.areObjectsEquivalent({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false)
    })

    test('a differing property count is not', () => {
        expect(util.areObjectsEquivalent({ x: 1 }, { x: 1, y: 2 })).toBe(false)
    })

    // Same count, different keys: b has no `y`, so the read is undefined.
    test('same count with different keys is not', () => {
        expect(util.areObjectsEquivalent({ x: 1, y: 2 }, { x: 1, z: 2 })).toBe(false)
    })

    // The comparison is shallow - nested objects compare by reference.
    test('equal nested objects are not equivalent', () => {
        expect(util.areObjectsEquivalent({ p: { x: 1 } }, { p: { x: 1 } })).toBe(false)
    })

    // An explicit undefined is still an own property, so it counts toward length.
    test('an explicit undefined property counts', () => {
        expect(util.areObjectsEquivalent({ x: 1, y: undefined }, { x: 1 })).toBe(false)
    })
})

describe('areArraysEquivalent', () => {
    const filter = (index: number, name: string): { index: number; name: string } => ({
        index,
        name,
    })

    test('element-wise equal arrays are equivalent', () => {
        expect(util.areArraysEquivalent([filter(1, 'iron-plate')], [filter(1, 'iron-plate')])).toBe(
            true
        )
    })

    test('order matters', () => {
        expect(
            util.areArraysEquivalent(
                [filter(1, 'iron-plate'), filter(2, 'copper-plate')],
                [filter(2, 'copper-plate'), filter(1, 'iron-plate')]
            )
        ).toBe(false)
    })

    test('differing lengths are not equivalent', () => {
        expect(util.areArraysEquivalent([filter(1, 'iron-plate')], [])).toBe(false)
    })

    test('two empty arrays are equivalent', () => {
        expect(util.areArraysEquivalent([], [])).toBe(true)
    })

    // undefined is never equivalent to anything, including another undefined.
    // Entity's setters rely on this: they return early when both sides are
    // undefined *before* calling, so reaching here with one means "changed".
    test('undefined is not equivalent to undefined', () => {
        expect(util.areArraysEquivalent(undefined, undefined)).toBe(false)
    })

    test('undefined is not equivalent to an empty array', () => {
        expect(util.areArraysEquivalent(undefined, [])).toBe(false)
        expect(util.areArraysEquivalent([], undefined)).toBe(false)
    })
})

describe('Point', () => {
    test('converts a tuple to a point', () => {
        expect(util.Point([1, 2])).toEqual({ x: 1, y: 2 })
    })

    test('copies a point rather than aliasing it', () => {
        const p = { x: 1, y: 2 }
        expect(util.Point(p)).not.toBe(p)
        expect(util.Point(p)).toEqual(p)
    })
})

describe('rotatePointBasedOnDir', () => {
    test.each([
        [0, { x: 1, y: 2 }],
        [4, { x: -2, y: 1 }],
        [8, { x: -1, y: -2 }],
        [12, { x: 2, y: -1 }],
    ])('direction %i', (dir, expected) => {
        expect(util.rotatePointBasedOnDir([1, 2], dir)).toEqual(expected)
    })

    // Unlike getDirName, a non-cardinal direction does not throw here - the
    // switch has no default, so the point stays at its initialised origin.
    // Recorded as current behaviour, not as the desired answer.
    test('a diagonal direction silently returns the origin', () => {
        expect(util.rotatePointBasedOnDir([1, 2], 2)).toEqual({ x: 0, y: 0 })
    })
})

describe('getDirName', () => {
    test.each([
        [0, 'north'],
        [4, 'east'],
        [8, 'south'],
        [12, 'west'],
    ])('direction %i is %s', (dir, expected) => {
        expect(util.getDirName(dir)).toBe(expected)
    })

    test('a diagonal direction throws', () => {
        expect(() => util.getDirName(2)).toThrow('Unexpected direction!')
    })
})

describe('vectorToTuple', () => {
    test('passes a tuple through', () => {
        expect(util.vectorToTuple([1, 2])).toEqual([1, 2])
    })

    test('converts the struct form', () => {
        expect(util.vectorToTuple({ x: 1, y: 2 })).toEqual([1, 2])
    })
})
