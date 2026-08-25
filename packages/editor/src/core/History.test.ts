import { describe, expect, it } from 'vite-plus/test'
import { History } from './History'

describe('History transactions', () => {
    it('clears an empty transaction', () => {
        const history = new History()

        expect(history.startTransaction('empty')).toBe(true)
        expect(history.commitTransaction()).toBe(false)
        expect(history.startTransaction('next')).toBe(true)
        expect(history.commitTransaction()).toBe(false)
    })

    it('records applied actions before a transaction callback throws', () => {
        const history = new History()
        const target = { value: 0 }

        expect(() =>
            history.transaction('update', () => {
                history.updateValue(target, 'value', 1, 'Set value').commit()
                throw new Error('boom')
            })
        ).toThrow('boom')
        expect(target.value).toBe(1)
        expect(history.undo()).toBe(true)
        expect(target.value).toBe(0)
    })

    it('closes an action transaction when an apply callback throws', () => {
        const history = new History()
        const broken = { value: 0 }
        const next = { value: 0 }

        expect(() =>
            history.transaction('broken update', () => {
                history
                    .updateValue(broken, 'value', 1, 'Set broken value')
                    .onDone(() => {
                        throw new Error('boom')
                    })
                    .commit()
            })
        ).toThrow('boom')

        history.updateValue(next, 'value', 1, 'Set next value').commit()
        expect(history.undo()).toBe(true)
        expect(next.value).toBe(0)
    })
})
