import util from '../common/util'

/** Private enumaration to determine the value (new value or old value) should be applied during action */
enum HistoryValue {
    New,
    Old,
}

/** Private class for historical actions */
class Action<V> {
    /** Field to store old value (=overwritten value) */
    public readonly oldValue: V

    /** Field to store new value (=overwriting value) */
    public readonly newValue: V

    /** Field to store description */
    public readonly text: string

    /** Field to store apply function */
    private readonly applyFn: (value: V) => void

    /** Field to store functions to emit after execution of action */
    private readonly emits: ((value: V, oldValue: V) => void)[] = []

    /** Reference to History */
    private readonly history: History

    public applyImmediate = true

    public constructor(
        history: History,
        oldValue: V,
        newValue: V,
        text: string,
        applyFn: (value: V) => void
    ) {
        this.history = history
        this.oldValue = oldValue
        this.newValue = newValue
        this.text = text
        this.applyFn = applyFn
    }

    /**
     * Commit the action to the history
     * This allows for emits to be set up first
     */
    public commit(): this {
        try {
            if (this.applyImmediate) {
                this.apply()
            }
        } finally {
            this.history.commitTransaction()
        }

        return this
    }

    /**
     * Execute action and therfore apply value
     * @param value Whether to apply the new or the old value (Default: New)
     */
    public apply(value: HistoryValue = HistoryValue.New): void {
        const newValue = value === HistoryValue.New ? this.newValue : this.oldValue
        const oldValue = value === HistoryValue.New ? this.oldValue : this.newValue

        this.applyFn(newValue)

        for (const f of this.emits) {
            f(newValue, oldValue)
        }
    }

    /**
     * Adds the function to a queue
     *
     * The function will be executed after the action has been applied
     */
    public onDone(f: (newValue: V, oldValue: V) => void): Action<V> {
        this.emits.push(f)
        return this
    }
}

/** A wrapper that stores multiple `Action`s */
class Transaction {
    /** Field to store description */
    public text: string | undefined

    /** Should actions be applied immediately */
    private applyImmediate: boolean

    /** Field to store historical actions */
    private readonly actions: Action<unknown>[] = []

    public constructor(text?: string, applyImmediate = true) {
        this.text = text
        this.applyImmediate = applyImmediate
    }

    public empty(): boolean {
        return this.actions.length === 0
    }

    public apply(): void {
        if (this.applyImmediate) return
        for (const action of this.actions) {
            action.apply(HistoryValue.New)
        }
    }

    /** Undo all actions from this transaction in reversed order */
    public undo(): void {
        const reversed = this.actions.map((_, i, arr) => arr[arr.length - 1 - i])
        for (const action of reversed) {
            action.apply(HistoryValue.Old)
        }
    }

    /** Redo all actions from this transaction */
    public redo(): void {
        for (const action of this.actions) {
            action.apply(HistoryValue.New)
        }
    }

    /** Logs all actions */
    public log(): void {
        console.log(`[DO] ${this.text}:`)
        this.actions.forEach((a, i) =>
            console.log('\t', i, a.text, ' - ', a.oldValue, ' -> ', a.newValue)
        )
    }

    /** Add action to this transaction */
    // Generic in V so callers can push a concrete Action<V> (under
    // strictFunctionTypes Action<V> is not assignable to Action<unknown>
    // because V appears in the apply callback's parameter position). The
    // transaction stores actions heterogeneously and only ever invokes each
    // through its own closure, so widening to Action<unknown> for storage is
    // safe.
    public push<V>(action: Action<V>): void {
        if (this.text === undefined && this.actions.length === 0) {
            this.text = action.text
        }
        action.applyImmediate = this.applyImmediate
        this.actions.push(action as Action<unknown>)
    }
}

/**
 * **Component to store history for undo / redo actions**
 *
 * - Supports history for maps and for objects
 * - Supports changing values in nested arrays and objects
 * - Supports multiple actions being applied as a single action via transaction (only 1 undo / redo needed to revert)
 * - Supports nested transactions
 * - Supports emitting of functions to be executed subsequently to historical action on undo / redo
 * - Supports history length constraint
 *
 * @example
 * // Import and init
 * import History from './history'
 * const history = new History()
 *
 * // Update value of object
 * const o = { name: 'test name' }
 * history.updateValue(o, ['name'], 'updated name', 'Update Object Name').commit()
 *
 * // Update value of nested object
 * const o = { name: { nestedName: 'test name' } }
 * history.updateValue(o, ['name', 'nestedName'], 'updated name', 'Update Object Name').commit()
 *
 * // Update item of map
 * const m: Map<number, string> = new Map()
 * m.push(1, 'fff')
 * history.updateMap(m, 1, 'updated fff', 'Update Map Item')
 *
 * // Transaction of 2 actions and naming of transaction
 * const o = { firstName: 'test first name', lastName: 'test last name'}
 * history.transaction('Update 2 values', () => {
 *     history.updateValue(o, ['firstName'], 'update first name').commit()
 *     history.updateValue(o, ['lastName'], 'update last name').commit()
 * })
 *
 * // Emit function after action execution
 * const o = { name: 'test name'}
 * history.updateValue(o, ['name'], 'updated name', 'Update Object Name').onDone(name => console.log(name)).commit()
 */
export class History {
    public logging = false

    private readonly MAX_HISTORY_LENGTH = 1000
    private readonly MIN_HISTORY_LENGTH = 800

    /** Counts how many times a 'startTransaction' was called so we know when 'commitTransaction' actually needs to apply */
    private transactionCount = 0

    private historyIndex = 0
    private activeTransaction: Transaction | undefined
    private transactionHistory: Transaction[] = []

    /**
     * A cheap "did anything happen" signal for a caller that wants to react
     * to edits without diffing the blueprint itself (`ExportDialog`'s own
     * re-encode, see its doc comment) - only that reading, not "changes by
     * exactly ±1 on every commit", which this used to claim and measured
     * wrong in three ways (#242 review):
     *
     * - Only the *outermost* `commitTransaction` of a nested pair moves it.
     *   `updateValue`/`updateMap` open their own inner transaction around a
     *   single write; `transactionCount` reaching 0 is what gates the block
     *   below, so an inner commit that leaves an outer one still open
     *   decrements the count and returns without touching `historyIndex` at
     *   all - only the caller whose own `commitTransaction` brings the
     *   count to 0 sees it move.
     * - Not guaranteed to move on that outermost commit either: one that
     *   turns out empty (`openTransaction.empty()`) returns before
     *   `historyIndex` is touched.
     * - Not exactly ±1 once history is long enough to trim: crossing
     *   `MAX_HISTORY_LENGTH` splices `MAX_HISTORY_LENGTH -
     *   MIN_HISTORY_LENGTH` entries off the front and reindexes to the new
     *   length before the usual `+= 1`, so a commit landing on that
     *   boundary moves this backward by roughly that amount instead of
     *   forward by one.
     *
     * None of that matters to `ExportDialog`'s own use, which only ever
     * asks "is this different from what I last saw" - undo, redo and a trim
     * all still change the number, the only property that comparison needs.
     * It would matter to a future caller trying to count edits or identify
     * a particular state from this value alone, which is exactly what the
     * old wording invited.
     */
    public get revision(): number {
        return this.historyIndex
    }

    /** Removes all history entries */
    public reset(): void {
        this.historyIndex = 0
        this.transactionHistory = []
    }

    /** Updates a value in an `Array` or `Object` at the specified key and stores it in the history  */
    public updateValue<T, K extends keyof T>(
        target: T,
        key: K,
        value: T[K],
        text: string
    ): Action<T[K] | undefined> {
        const oldValue = this.GetValue(target, key)
        const newValue = value

        const historyAction = new Action(this, oldValue, newValue, text, v => {
            if (v === undefined) {
                const current = this.GetValue(target, key)
                if (current !== undefined) {
                    this.DeleteValue(target, key)
                }
            } else {
                this.SetValue(target, key, v)
            }
        })

        this.startTransaction()
        this.openTransaction.push(historyAction)

        return historyAction
    }

    /** Updates a value in a `Map` and stores it in the history */
    public updateMap<K, V>(
        target: Map<K, V>,
        key: K,
        value: V | undefined,
        text: string
    ): Action<V | undefined> {
        const oldValue = target.get(key)
        const newValue = value

        const historyAction = new Action(this, oldValue, newValue, text, v => {
            if (v === undefined) {
                if (target.has(key)) {
                    target.delete(key)
                }
            } else {
                target.set(key, v)
            }
        })

        this.startTransaction()
        this.openTransaction.push(historyAction)

        return historyAction
    }

    /**
     * Undo last action stored in history
     * @returns `false` if there are no actions left for undo
     * */
    public undo(): boolean {
        if (this.historyIndex === 0) return false
        const historyEntry = this.transactionHistory[this.historyIndex - 1]
        historyEntry.undo()
        this.historyIndex -= 1

        if (this.logging) {
            console.log(`[UNDO] ${historyEntry.text}`)
        }

        return true
    }

    /**
     * Redo last action stored in history
     * @returns `false` if there are no actions left for redo
     * */
    public redo(): boolean {
        if (this.historyIndex === this.transactionHistory.length) return false
        const historyEntry = this.transactionHistory[this.historyIndex]
        historyEntry.redo()
        this.historyIndex += 1

        if (this.logging) {
            console.log(`[REDO] ${historyEntry.text}`)
        }

        return true
    }

    /**
     * Starts a new transaction
     * @param text Description of transaction - If not specified it will be the description of the first action
     * @returns `false` if there is already an active transaction
     */
    /**
     * The open transaction. startTransaction() creates one if there is not
     * already one, so every call site below that has just called it is holding a
     * real invariant rather than a hope - naming it here means a violation says
     * so instead of surfacing as a TypeError on .push of undefined.
     */
    private get openTransaction(): Transaction {
        if (this.activeTransaction === undefined) {
            throw new Error('no open transaction')
        }
        return this.activeTransaction
    }

    public startTransaction(text?: string, applyImmediate = true): boolean {
        this.transactionCount += 1

        if (this.activeTransaction === undefined) {
            this.activeTransaction = new Transaction(text, applyImmediate)
            return true
        } else {
            return false
        }
    }

    /** Runs a transaction and closes it even when the callback throws. */
    public transaction<T>(text: string | undefined, fn: () => T): T {
        this.startTransaction(text)
        try {
            return fn()
        } finally {
            this.commitTransaction()
        }
    }

    /**
     * Commits the active transaction and pushes it into the history
     * @returns `false` if `transactionCount` is not 0 or transaction is empty
     */
    public commitTransaction(): boolean {
        this.transactionCount -= 1

        if (this.transactionCount === 0) {
            const transaction = this.openTransaction
            if (transaction.empty()) {
                this.activeTransaction = undefined
                return false
            }

            try {
                while (this.transactionHistory.length > this.historyIndex) {
                    this.transactionHistory.pop()
                }

                transaction.apply()
                this.transactionHistory.push(transaction)
                if (this.logging) {
                    if (this.historyIndex !== 0 && this.historyIndex % 20 === 0) {
                        console.clear()
                    }
                    transaction.log()
                }

                if (this.historyIndex > this.MAX_HISTORY_LENGTH) {
                    this.transactionHistory.splice(
                        0,
                        this.MAX_HISTORY_LENGTH - this.MIN_HISTORY_LENGTH
                    )
                    this.historyIndex = this.transactionHistory.length
                }

                this.historyIndex += 1

                return true
            } finally {
                this.activeTransaction = undefined
            }
        }

        return false
    }

    /** Gets the value of the `Array` or `Object` at the specified key  */
    private GetValue<T, K extends keyof T>(obj: T, key: K): T[K] | undefined {
        if (util.objectHasOwnProperty(obj, key)) {
            return obj[key]
        }
    }

    /** Sets the value of the `Array` or `Object` at the specified key  */
    private SetValue<T, K extends keyof T>(obj: T, key: K, value: T[K]): void {
        obj[key] = value
    }

    /** Deletes the value of the `Array` or `Object` at the specified key  */
    private DeleteValue<T, K extends keyof T>(obj: T, key: K): void {
        // oxlint-disable-next-line @typescript-eslint/no-dynamic-delete -- generic undo/redo helper; key is type-constrained to keyof T
        delete obj[key]
    }
}
