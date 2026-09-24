import { describe, expect, it } from 'vite-plus/test'
import {
    QUALITY_BADGE_FRAME,
    QUALITY_PIP_RADIUS,
    QUALITY_PIP_STROKE,
    entityBadgeCorner,
    entityBadgeSize,
    qualityBadgeStyle,
} from './qualityBadge'

/*
    Every expected value here was measured from Factorio 2.0.77's own rendering,
    not derived from the code: alt-mode screenshots of legendary entities at 128
    px per tile, and the game's 64 px quality icons. See qualityBadge.ts.
*/

describe('qualityBadgeStyle', () => {
    it('draws nothing for normal, for no quality and for a name it does not know', () => {
        expect(qualityBadgeStyle('normal')).toBeUndefined()
        expect(qualityBadgeStyle(undefined)).toBeUndefined()
        expect(qualityBadgeStyle('mythic')).toBeUndefined()
    })

    it("uses the game icons' fill colours", () => {
        expect(qualityBadgeStyle('uncommon')?.color).toBe(0x3eec57)
        expect(qualityBadgeStyle('rare')?.color).toBe(0x2495ff)
        expect(qualityBadgeStyle('epic')?.color).toBe(0xc400ff)
        expect(qualityBadgeStyle('legendary')?.color).toBe(0xff9500)
    })

    it('has one more pip per tier, with legendary adding a fifth rather than a sixth', () => {
        expect(
            ['uncommon', 'rare', 'epic', 'legendary'].map(q => qualityBadgeStyle(q)?.pips.length)
        ).toEqual([2, 3, 4, 5])
    })

    /*
        The game's glyph is not centred in its frame. Its opaque extent in the
        24-unit frame is x 0..12 for uncommon and 0..22.1 for rare and epic, and
        y 1.9..24 for all three, and the badge is placed by the frame corner - so
        this is what puts the pips where the game puts them.
    */
    it('sits against the left and bottom of its frame, as the game glyph does', () => {
        const outer = QUALITY_PIP_RADIUS + QUALITY_PIP_STROKE / 2
        for (const q of ['uncommon', 'rare', 'epic']) {
            const pips = qualityBadgeStyle(q)?.pips ?? []
            const left = Math.min(...pips.map(p => p[0])) - outer
            const bottom = Math.max(...pips.map(p => p[1])) + outer
            expect(left).toBeCloseTo(0.1, 1)
            expect(bottom).toBeCloseTo(QUALITY_BADGE_FRAME - 0.1, 1)
        }
    })

    it('draws the legendary centre pip last, over the corners', () => {
        const pips = qualityBadgeStyle('legendary')?.pips ?? []
        expect(pips.at(-1)).toEqual([11.375, 12.625])
    })
})

describe('entityBadgeSize', () => {
    it('is a quarter tile when the smaller side is 1', () => {
        expect(entityBadgeSize({ x: 1, y: 1 })).toBe(1 / 4)
        expect(entityBadgeSize({ x: 2, y: 1 })).toBe(1 / 4) // splitter
    })

    it('is a third of a tile when the smaller side is 2', () => {
        expect(entityBadgeSize({ x: 2, y: 2 })).toBe(1 / 3)
        expect(entityBadgeSize({ x: 3, y: 2 })).toBe(1 / 3) // boiler
    })

    it('is half a tile from 3 up, whatever the longer side', () => {
        expect(entityBadgeSize({ x: 3, y: 3 })).toBe(1 / 2)
        expect(entityBadgeSize({ x: 3, y: 5 })).toBe(1 / 2) // steam-engine
        expect(entityBadgeSize({ x: 9, y: 9 })).toBe(1 / 2) // rocket-silo
    })
})

describe('entityBadgeCorner', () => {
    // A boiler: 3x2, selection box -1.5..1.5 by -1..1 facing north.
    const boiler = [
        [-1.5, -1],
        [1.5, 1],
    ] as const

    it('is the bottom-left of the selection box facing north', () => {
        expect(entityBadgeCorner(boiler, 0)).toEqual({ x: -1.5, y: 1 })
    })

    /*
        The game at each direction, read off `LuaEntity.selection_box` relative to
        the entity's position: east -1..1 by -1.5..1.5, south -1.5..1.5 by
        -1..1, west -1..1 by -1.5..1.5. The badge sat on each box's bottom-left.
    */
    it('follows the box as it rotates', () => {
        expect(entityBadgeCorner(boiler, 4)).toEqual({ x: -1, y: 1.5 })
        expect(entityBadgeCorner(boiler, 8)).toEqual({ x: -1.5, y: 1 })
        expect(entityBadgeCorner(boiler, 12)).toEqual({ x: -1, y: 1.5 })
    })

    it('keeps the unrotated box for a diagonal, which was not measured', () => {
        expect(entityBadgeCorner(boiler, 2)).toEqual({ x: -1.5, y: 1 })
    })
})
