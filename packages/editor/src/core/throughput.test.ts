import { describe, expect, it } from 'vite-plus/test'
import {
    beltThroughput,
    containerToContainer,
    containerToBelt,
    beltToContainer,
    inserterThroughput,
} from './throughput'

/*
    The throughput maths behind the entity info panel (issue #96).

    These moved out of `UI/EntityInfoPanel.ts` to be tested at all: they are pure
    functions of numbers with no FD dependency, so unlike the rest of `UI/` they
    need neither a browser nor the two dev servers. Until now none of them had a
    test, which for a formula means a wrong one looks exactly like a right one.

    The prototype values below are the real ones out of data.json.
*/

// rotation_speed, straight from the prototypes
const INSERTER = 0.014000000000000002
const LONG_HANDED = 0.02
const FAST = 0.04
const BULK = 0.04

// speed, likewise
const YELLOW = 0.03125
const RED = 0.0625
const BLUE = 0.09375
const TURBO = 0.125

describe('beltThroughput', () => {
    /*
        The one function here with an external check. Factorio's belt tiers carry
        exactly 15, 30, 45 and 60 items/s, figures that come from the game rather
        than from this codebase - so these four assertions validate the formula
        against something outside our own loop, which none of the others can.
    */
    it('gives the published items/s for every belt tier', () => {
        expect(beltThroughput(YELLOW)).toBe(15)
        expect(beltThroughput(RED)).toBe(30)
        expect(beltThroughput(BLUE)).toBe(45)
        expect(beltThroughput(TURBO)).toBe(60)
    })
})

describe('containerToContainer', () => {
    it('is swings per second times the stack size', () => {
        expect(containerToContainer(FAST, 1)).toBeCloseTo(2.4, 10)
        expect(containerToContainer(FAST, 3)).toBeCloseTo(7.2, 10)
        expect(containerToContainer(INSERTER, 1)).toBeCloseTo(0.84, 10)
    })

    it('is unaffected by any belt, having none at either end', () => {
        expect(containerToContainer(LONG_HANDED, 2)).toBeCloseTo(2.4, 10)
    })
})

describe('containerToBelt', () => {
    /*
        Unchanged from what the panel has always computed - moved, not rewritten.
        The model: one arm swing, plus belt-space arrival time for each item past
        the first 1.75 (the first lands instantly and in front, which also covers
        most of the second).
    */
    it('matches the arm-time plus item-time model', () => {
        const armTime = 1 / (FAST * 60)
        const itemTime = (1 / (YELLOW * 60)) * 0.25
        expect(containerToBelt(FAST, YELLOW, 3)).toBeCloseTo(
            3 / (armTime + itemTime * (3 - 1.75)),
            10
        )
    })

    it('is the plain swing rate while the stack is inside the ignored head', () => {
        // At or below 1.75 items nothing waits on belt space, so it collapses to
        // one swing's worth - the max(n - 1.75, 0) arm of the model.
        expect(containerToBelt(FAST, YELLOW, 1)).toBeCloseTo(containerToContainer(FAST, 1), 10)
    })
})

describe('beltToContainer', () => {
    /*
        The one that did not exist (#96). An inserter picking off a belt is bound
        by two things at once - how fast it can swing, and how fast the belt
        brings items under the hand - so this is the smaller of the two.

        Deliberately an upper bound rather than a curve: the swing limit and the
        belt limit are both real ceilings, and the true figure sits at or below
        their minimum. Claiming more than that would need measuring the game,
        which nothing here has done.
    */
    it('is swing-limited when the inserter is slower than the belt', () => {
        // A fast inserter moving one item at a time takes 2.4/s off a 15/s belt.
        expect(beltToContainer(FAST, YELLOW, 1)).toBeCloseTo(2.4, 10)
        expect(beltToContainer(FAST, YELLOW, 1)).toBe(containerToContainer(FAST, 1))
    })

    it('is belt-limited when the inserter could out-pace the belt', () => {
        // A bulk inserter swinging 12 at a time wants 28.8/s; a yellow belt
        // cannot deliver more than 15/s, so 15 is the answer.
        expect(containerToContainer(BULK, 12)).toBeCloseTo(28.8, 10)
        expect(beltToContainer(BULK, YELLOW, 12)).toBe(15)
    })

    it('stops being belt-limited once the belt is fast enough', () => {
        expect(beltToContainer(BULK, TURBO, 12)).toBeCloseTo(28.8, 10)
    })

    it('never reports more than the belt can deliver', () => {
        for (const belt of [YELLOW, RED, BLUE, TURBO]) {
            for (const n of [1, 4, 12, 30]) {
                expect(beltToContainer(BULK, belt, n)).toBeLessThanOrEqual(beltThroughput(belt))
            }
        }
    })
})

describe('inserterThroughput', () => {
    /*
        What the panel actually calls: it knows what sits at each end and picks
        the binding constraint. The old panel read only the destination, so an
        inserter picking off a belt was reported at the container rate.
    */
    it('uses the container rate with a container at both ends', () => {
        expect(inserterThroughput({ rotationSpeed: FAST, stackSize: 2 })).toBeCloseTo(
            containerToContainer(FAST, 2),
            10
        )
    })

    it('uses the belt-placing rate when unloading onto a belt', () => {
        expect(
            inserterThroughput({ rotationSpeed: FAST, stackSize: 3, destBeltSpeed: YELLOW })
        ).toBeCloseTo(containerToBelt(FAST, YELLOW, 3), 10)
    })

    it('uses the belt-picking rate when loading off a belt', () => {
        expect(
            inserterThroughput({ rotationSpeed: BULK, stackSize: 12, sourceBeltSpeed: YELLOW })
        ).toBe(beltToContainer(BULK, YELLOW, 12))
    })

    it('applies both limits with a belt at each end', () => {
        // Belt to belt was covered by neither branch before. Placing onto the
        // destination bounds it, and the source belt bounds it again.
        const both = inserterThroughput({
            rotationSpeed: BULK,
            stackSize: 12,
            sourceBeltSpeed: YELLOW,
            destBeltSpeed: TURBO,
        })
        expect(both).toBeLessThanOrEqual(containerToBelt(BULK, TURBO, 12))
        expect(both).toBeLessThanOrEqual(beltThroughput(YELLOW))
    })
})
