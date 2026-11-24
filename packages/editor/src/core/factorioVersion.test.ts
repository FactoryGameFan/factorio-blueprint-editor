import { describe, expect, it } from 'vite-plus/test'
import { getFactorioVersion } from './factorioVersion'

const decode = (version: number): number[] =>
    [48n, 32n, 16n, 0n].map(shift => Number((BigInt(version) >> shift) & 0xffffn))

describe('getFactorioVersion', () => {
    it('packs the default export version as 2.0.45.0', () => {
        expect(decode(getFactorioVersion())).toEqual([2, 0, 45, 0])
    })

    it('packs a nonzero major version without borrowing from the minor field', () => {
        expect(decode(getFactorioVersion(0, 17, 10))).toEqual([0, 17, 10, 0])
    })
})

/*
    Every version this editor compares against, as { threshold, last version
    below it }. Blueprint.ts compares `data.version < getFactorioVersion(...)`
    (1.1.11 for generated power-pole wires, 2.0.0 for the old direction scale and
    the pre-2.0 shape migrations) and nameMigrations.ts uses `below:` the same
    way (0.17.0, 0.17.10, 2.0.0, 2.1.0).

    The old packing, `(minor << 16) + (major | (main << 16)) * 0xffffffff`, put
    every one of these slightly low, so a blueprint stamped just under a
    threshold compared as at or above it (issue #646). A round trip of the
    threshold alone cannot see that, so each row also names the highest version
    that must still compare below it, with every field at its largest where the
    field below the threshold's own allows it.

    These are built with BigInt shifts, which are exact, rather than with
    packVersion, so the expected values do not share the arithmetic under test.
*/
const pack = (main: number, major: number, minor: number, dev = 0): number =>
    Number((BigInt(main) << 48n) | (BigInt(major) << 32n) | (BigInt(minor) << 16n) | BigInt(dev))

const thresholds: {
    name: string
    at: [number, number, number]
    justBelow: [number, number, number, number]
}[] = [
    { name: '0.17.0', at: [0, 17, 0], justBelow: [0, 16, 65535, 65535] },
    { name: '0.17.10', at: [0, 17, 10], justBelow: [0, 17, 9, 65535] },
    { name: '1.1.11', at: [1, 1, 11], justBelow: [1, 1, 10, 65535] },
    { name: '2.0.0', at: [2, 0, 0], justBelow: [1, 65535, 65535, 65535] },
    { name: '2.1.0', at: [2, 1, 0], justBelow: [2, 0, 65535, 65535] },
]

describe.each(thresholds)('threshold $name', ({ at, justBelow }) => {
    it('round-trips through the packed value', () => {
        expect(decode(getFactorioVersion(...at))).toEqual([...at, 0])
    })

    it('equals the exact 64-bit packing', () => {
        expect(getFactorioVersion(...at)).toBe(pack(...at))
    })

    it('puts the highest version below it below it', () => {
        expect(pack(...justBelow)).toBeLessThan(getFactorioVersion(...at))
    })

    it('does not count the threshold itself, or a developer build of it, as below', () => {
        expect(pack(...at)).not.toBeLessThan(getFactorioVersion(...at))
        expect(pack(...at, 1)).not.toBeLessThan(getFactorioVersion(...at))
    })
})
