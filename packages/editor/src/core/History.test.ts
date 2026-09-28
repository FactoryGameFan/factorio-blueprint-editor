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

    it('is busy for the whole of a batch and settles once at its end', () => {
        const history = new History()
        const target = { a: 0, b: 0 }
        const seen: boolean[] = []
        let settled = 0
        history.onSettled(() => (settled += 1))
        const watch = (): void => {
            seen.push(history.busy)
        }

        history.transaction('two writes', () => {
            history.updateValue(target, 'a', 1, 'a').onDone(watch).commit()
            history.updateValue(target, 'b', 1, 'b').onDone(watch).commit()
        })
        expect(seen).toEqual([true, true])
        expect(settled).toBe(1)
        expect(history.busy).toBe(false)

        // undo and redo replay both writes, and settle once each
        history.undo()
        history.redo()
        expect(seen).toEqual([true, true, true, true, true, true])
        expect(settled).toBe(3)
        expect(history.busy).toBe(false)
    })

    it('settles after a throw too, and stops calling a removed listener', () => {
        const history = new History()
        let settled = 0
        const off = history.onSettled(() => (settled += 1))

        expect(() =>
            history.transaction('throws', () => {
                throw new Error('boom')
            })
        ).toThrow('boom')
        expect(settled).toBe(1)
        expect(history.busy).toBe(false)

        off()
        history.updateValue({ value: 0 }, 'value', 1, 'Set value').commit()
        expect(settled).toBe(1)
    })
})
