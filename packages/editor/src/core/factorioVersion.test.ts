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
