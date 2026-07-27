import './index.css'

import { isMobile } from 'pixi.js'
import FileSaver from 'file-saver'
import EDITOR, {
    Editor,
    Blueprint,
    Book,
    TrainBlueprintError,
    ModdedBlueprintError,
    CorruptedBlueprintStringError,
    BookWithNoBlueprintsError,
    encode,
    getBlueprintOrBookFromSource,
    getAndClearLoadWarnings,
    OverlayContainer,
    EntityContainer,
    Entity,
    FD,
    EntitySprite,
    EntityInfoPanel,
    getSpriteData,
    SPRITE_GENERATION_FAILED,
} from '@fbe/editor'
import { initToasts } from './toasts'
import { initSettingsPane } from './settingsPane'
import { storedJson } from './storage'

document.addEventListener('contextmenu', e => e.preventDefault())

/**
 * An element this page's own index.html declares, by id.
 *
 * `getElementById` answers `HTMLElement | null` because in general an id may
 * not be there. Every id read here is written statically in index.html and
 * shipped with it, so absence means the markup and this file have drifted -
 * which is worth a sentence naming the id rather than a null that reaches
 * `.classList` a line later. Same shape as the editor's `PositionGrid.entityAt`
 * and `EntityContainer.containerOf`.
 */
function element<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id)
    if (el === null) throw new Error(`index.html has no element with id "${id}"`)
    return el as T
}

const editor = new Editor()

/**
 * The loaded blueprint's entity by number, for the test hooks below. A miss
 * means the spec named an entity its blueprint does not have, which is worth
 * saying rather than an undefined that reaches `.filters` a line later.
 */
function entityOf(entityNumber: number): Entity {
    const entity = bp.entities.get(entityNumber)
    if (entity === undefined) {
        throw new Error(`no entity ${entityNumber} in the loaded blueprint`)
    }
    return entity
}

let t0 = performance.now()

const CANVAS = element<HTMLCanvasElement>('editor')

let bp: Blueprint
// undefined whenever a bare blueprint is loaded rather than a book, which is
// what loadBp's else branch assigns and what getBook/encodeLoaded read.
let book: Book | undefined

const loadingScreen = {
    el: element('loadingScreen'),
    show() {
        this.el.classList.add('active')
        t0 = performance.now()
    },
    hide() {
        this.el.classList.remove('active')
        const t1 = performance.now()
        if (editor.debug) {
            console.log('Load time:', t1 - t0)
        }
    },
}

console.log(
    '\n%cLooking for the source?\nhttps://github.com/Teoxoy/factorio-blueprint-editor\n',
    'color: #1f79aa; font-weight: bold'
)

const createToast = initToasts()

if (isMobile.any) {
    createToast({
        text: 'Viewing in read-only mode. Editing features are not available on mobile devices.',
        type: 'warning',
        timeout: 10000,
    })
}

if (typeof WebAssembly !== 'object' && typeof WebAssembly.instantiate !== 'function') {
    createToast({
        text:
            "Current browser doesn't support WebAssembly.<br>" +
            'If you think this is a mistake, feel free to report this bug on github or using the feedback button.',
        type: 'error',
        timeout: Infinity,
    })
    loadingScreen.el.classList.add('error')
    throw new Error('WEB_ASSEMBLY_NOT_SUPPORTED')
}

const params = window.location.search.slice(1).split('&')

let bpSource: string
let bpIndex = 0
for (const p of params) {
    if (p.includes('source')) {
        const raw = p.split('=')[1]
        // decodeURIComponent throws URIError on malformed input (e.g. ?source=%);
        // fall back to the raw value so a bad param can't abort app init.
        try {
            bpSource = decodeURIComponent(raw)
        } catch {
            bpSource = raw
        }
    }
    if (p.includes('index')) {
        bpIndex = Number(p.split('=')[1])
    }
}

let changeBookForIndexSelector: (bpOrBook: Book | Blueprint) => void

editor
    .init(CANVAS, createToast)
    .then(() => {
        const quickbarItems = storedJson<string[]>('quickbarItemNames')
        if (quickbarItems) {
            editor.quickbarItems = quickbarItems
        }

        registerActions()

        const changeBookIndex = async (index: number): Promise<void> => {
            // The settings pane only shows a book index selector while a book is
            // loaded, so this cannot fire without one - same check, and the same
            // reason for it, as the selectBookIndex test hook below.
            if (!book) throw new Error('No book loaded')
            bp = book.selectBlueprint(index)
            await editor.loadBlueprint(bp)
        }
        changeBookForIndexSelector = initSettingsPane(editor, changeBookIndex).changeBook

        getBlueprintOrBookFromSource(bpSource)
            .catch(error => createBPImportError(error))

            .then(bpOrBook => loadBp(bpOrBook || new Blueprint()))

            .then(() => createWelcomeMessage())
            .catch(error => createBPImportError(error))

            /*
                Only now does the test hook go on `window`. It is the signal every
                spec waits for, so it has to mean the data is loaded and the
                initial blueprint is on screen, not merely that this module has
                run (issue #109). It comes after the catch on purpose: a source
                that fails to import is a state specs still need to drive.
            */
            .then(() => {
                ;(window as any).__fbe_test = testApi
            })
            .catch(error => createErrorMessage('Could not finish starting up.', error))
    })
    .catch(error => {
        createErrorMessage('Something went wrong.', error, Infinity)
        loadingScreen.el.classList.add('error')
        throw new Error('UNRECOVERABLE_ERROR')
    })

window.addEventListener('visibilitychange', () => {
    localStorage.setItem('quickbarItemNames', JSON.stringify(editor.quickbarItems))
})

async function loadBp(bpOrBook: Blueprint | Book): Promise<void> {
    if (bpOrBook instanceof Book) {
        book = bpOrBook
        bp = book.selectBlueprint(bpIndex ? bpIndex : undefined)
    } else {
        book = undefined
        bp = bpOrBook
    }

    await editor.loadBlueprint(bp)
    changeBookForIndexSelector(bpOrBook)

    loadingScreen.hide()

    const bpIsEmpty = bpOrBook instanceof Blueprint && bpOrBook.isEmpty()
    if (!bpIsEmpty) {
        createToast({ text: 'Blueprint string loaded successfully', type: 'success' })
    }

    const warnings = getAndClearLoadWarnings()
    for (const warning of warnings) {
        console.warn(warning)
        createToast({ text: warning, type: 'warning', timeout: 10000 })
    }
}

document.addEventListener('copy', (e: ClipboardEvent) => {
    if (document.activeElement !== CANVAS) return
    e.preventDefault()

    if (bp.isEmpty()) return

    const onSuccess = (): void => {
        createToast({ text: 'Blueprint string copied to clipboard', type: 'success' })
    }

    const onError = (error: Error): void => {
        createErrorMessage('Blueprint string could not be generated.', error)
    }

    encode(book || bp)
        .then(s => navigator.clipboard.writeText(s))
        .then(onSuccess)
        .catch(onError)
})

document.addEventListener('paste', (e: ClipboardEvent) => {
    if (document.activeElement !== CANVAS) return
    e.preventDefault()

    loadingScreen.show()

    navigator.clipboard
        .readText()
        .then(getBlueprintOrBookFromSource)
        .then(loadBp)
        .catch(error => {
            loadingScreen.hide()
            createBPImportError(error)
        })
})

/*
    The Playwright test API. Built here, but not put on `window` until startup
    has finished - see the `.then` above that assigns it, and issue #109.

    Every spec waits for `window.__fbe_test` and treats its arrival as "the
    editor is ready". That was only true by luck: this used to be assigned
    synchronously while `editor.init()` - which fetches data.json and calls
    `loadData` - was still in flight, so a spec could start work against an
    empty `FD`. Measured with data.json held back 1.5s, the first call after the
    hook appeared failed with `Cannot read properties of undefined (reading
    'wooden-chest')` from `stripUnknownPrototypes`, and kept failing for the
    length of the delay. Warm, the gap is 0ms, which is why it only ever showed
    up under load or on a cold start - as two to five random specs failing per
    full run, each passing in isolation.
*/
const testApi = {
    getBlueprintOrBookFromSource,
    loadBp,
    /*
        The interaction mode the canvas is in, by name. The first thing any spec
        driving real pointer or keyboard input needs to assert on (issue #44).
    */
    editorMode: () => editor.mode,
    /*
        Where an entity sits on screen, so a spec can put the pointer on it.
        Hovering is the only way into EDIT, and that is the entry point for
        pipette, the entity editor and settings copy/paste (issue #44).
    */
    entityScreenPosition: (entityNumber: number) => editor.entityScreenPosition(entityNumber),
    /*
        Which entity is hovered. `editorMode` says EDIT at both ends of a move
        from one entity to the next, so it cannot see a hover swap that stopped
        happening.
    */
    hoveredEntityNumber: () => editor.hoveredEntityNumber,
    /*
        Whether the paint container is drawn, undefined when there is none.
        `editorMode` says PAINT for both a shown and a hidden one, and the
        difference is the whole of issue #53.
    */
    paintContainerVisible: () => editor.paintContainerVisible,
    /*
        How many tile sprites are drawn. Nothing else asserts that tiles render
        at all - the round-trip spec only checksums their positions in the model.
    */
    tileSpriteCount: () => editor.tileSpriteCount,
    /*
        The keybinds that differ from their defaults, which is what
        importKeybinds was asked to apply and what exportKeybinds would persist.
        Empty means every action is on its default combo.
    */
    keyCombos: () => EDITOR.exportKeybinds(),
    /*
        The loaded blueprint's wires, in the form they would be serialized to a
        blueprint string. Reads live editor state, unlike wire-connections.spec,
        which walks a blueprint it decoded itself - pasting is the case that
        needs the difference.
    */
    wireCount: () => bp.wireConnections.serializeBpWires().length,
    loadingScreen,
    getBook: () => book,
    selectBookIndex: async (index: number) => {
        if (!book) throw new Error('No book loaded')
        bp = book.selectBlueprint(index)
        await editor.loadBlueprint(bp)
    },
    /*
        The blueprint string a copy would put on the clipboard, which for a loaded
        book is Book.serialize(). Nothing else reaches that method: the round-trip
        spec serializes the selected Blueprint, never the book around it, so the
        active_index Book writes - its own and each nested book's - was read by
        nothing at all.
    */
    encodeLoaded: () => encode(book || bp),
    /*
        An entity's filters, and a write through the same setter. Reading covers
        the paste-settings path a spec can drive with real input; writing covers
        what that path cannot say, since paste always sends a full list copied
        off another entity - clearing a chest, and the partial slot lists the
        chest editor sends. The chest editor drives those through real clicks in
        tests/chest-editor.spec.ts now that #87 has it back in the factory; this
        stays because it says them directly, without a dialog layout in between.
    */
    entityFilters: (entityNumber: number) => entityOf(entityNumber).filters,
    setEntityFilters: (
        entityNumber: number,
        list: { index: number; name: string | undefined; count?: number }[] | undefined
    ) => {
        entityOf(entityNumber).filters = list
    },
    /*
        A cargo wagon's inventory limit and slot filters, which it nests in one
        field. Written here rather than read, because the thing it exists to
        check cannot be seen in a single paste: whether the target ended up with
        its own copy of the source's object or a reference to it. Change the
        target, then look at the source (tests/paste-entity-settings.spec.ts).
    */
    setWagonInventory: (
        entityNumber: number,
        inventory: { bar?: number; filters?: { index: number; name: string }[] } | undefined
    ) => {
        entityOf(entityNumber).wagonInventory = inventory
    },
    /*
        A constant combinator's signals. The only reader of
        control_behavior.sections there is, which makes it the only way to ask
        whether the pre-2.0 migration that builds that field produced something
        the model can read, rather than only something that serializes.
    */
    constantCombinatorFilters: (entityNumber: number) =>
        entityOf(entityNumber).constantCombinatorFilters,
    /*
        The dialogs are drawn with pixi, so nothing outside the canvas can find
        a control inside one to click. These two are the entity editor's
        equivalent of entityScreenPosition: a count, and where the topmost
        dialog sits in client coordinates.
    */
    /*
        Modules by slot, and what the entity would accept. `modules` is a
        positional array - undefined for an empty slot - so a spec can see a
        module that moved, which a set or a count could not (issue #100).
    */
    entityModules: (entityNumber: number) => entityOf(entityNumber).modules,
    /*
        What the info panel says about an entity. Builds a panel of its own
        rather than reading the live one, the same way recipeShapeTally does, so
        the app's panel is not left showing whatever a spec last asked about.
    */
    entityInfoText: (entityNumber: number) => {
        const panel = new EntityInfoPanel()
        try {
            panel.updateVisualization(entityOf(entityNumber))
            return panel.infoText
        } finally {
            panel.destroy()
        }
    },
    openDialogCount: () => editor.openDialogCount,
    topDialogBounds: () => editor.topDialogBounds,
    /*
        The size of EntityContainer.mappings, the static entity-number -> container
        index. Loading a blueprint should leave it holding exactly that
        blueprint's containers; anything above is retention from a previously
        loaded one (issue #42).
    */
    entityContainerCount: () => EntityContainer.mappings.size,
    /*
        Per entity name, the number of children each entity's info overlay came
        out with, or -1 where it produced no overlay at all. Deliberately calls
        the static createEntityInfo rather than the instance method, so a throw
        propagates instead of being swallowed by the latter's try/catch.
    */
    overlayInfoTally: () => {
        const out: Record<string, number[]> = {}
        for (const entity of bp.entities.valuesArray()) {
            const info = OverlayContainer.createEntityInfo(entity, { x: 0, y: 0 })
            ;(out[entity.name] ??= []).push(info === undefined ? -1 : info.children.length)
        }
        return out
    },
    /*
        Per entity name, a digest of the sprite data every placement generated:
        "<layer count>:<hash of the layer fields>", or "FAILED" where the
        generator threw. Calls getSpriteData rather than EntitySprite.getParts so
        no textures are needed and nothing is mutated on the way out.

        The layer count alone would miss a layer whose shift or sheet offset
        moved, and a hash alone would say nothing useful when it changes, so the
        digest carries both.

        draw_wall and draw_heat_pipe pick a sprite variation at random, so
        Math.random is swapped for a fixed sequence while the tally runs -
        otherwise their digests differ run to run.

        Takes the blueprint to walk rather than reading the loaded one, so the
        caller can tally every blueprint of a book without loading each in turn -
        the position grid a Blueprint carries is populated as its entities are
        created, so no rendering is needed for the neighbour branches to work.

        `withGrid: false` withholds the grid, which is what the entity editor
        preview and the paint preview do. Nothing else in the suite draws an
        entity that way, and the branches it reaches are different ones - a wall
        with no neighbours, a belt with no connector index.
    */
    spriteDataTally: (blueprint?: Blueprint, opts?: { withGrid?: boolean }) => {
        const target = blueprint ?? bp
        const grid = opts?.withGrid === false ? undefined : target.entityPositionGrid
        const out: Record<string, string[]> = {}
        const realRandom = Math.random
        let seed = 1
        Math.random = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648
            return seed / 2147483648
        }
        try {
            for (const entity of target.entities.valuesArray()) {
                const data = getSpriteData(EntitySprite.getDrawData(entity, grid)) as unknown
                ;(out[entity.name] ??= []).push(spriteDataDigest(data))
            }
        } finally {
            Math.random = realRandom
        }
        return out
    },
    /*
        The same digest for the bare `{ name, direction, directionType }` object
        PaintEntityContainer draws with - no Entity, no position, no grid, and
        none of the flags. That is the only caller that reaches
        EntitySprite.getDrawData's defaults, since anything walking a blueprint
        hands over an Entity that supplies every field.
    */
    paintPreviewTally: (directions: (number | undefined)[]) => {
        const out: Record<string, string[]> = {}
        const realRandom = Math.random
        let seed = 1
        Math.random = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648
            return seed / 2147483648
        }
        try {
            for (const name of Object.keys(FD.entities).sort()) {
                for (const direction of directions) {
                    const data = getSpriteData(
                        EntitySprite.getDrawData({ name, direction })
                    ) as unknown
                    ;(out[name] ??= []).push(spriteDataDigest(data))
                }
            }
        } finally {
            Math.random = realRandom
        }
        return out
    },
    /*
        Per recipe, what each reader of its ingredient and result lists answers,
        or "THREW" where it did not answer at all.

        The two fields hold three runtime shapes - a list, `{}`, or nothing - and
        the readers disagree about which they handle: OverlayContainer defends
        against the missing one, Entity's accessors against the missing one, and
        EntityInfoPanel against neither. `{}` defeats all three, since it is
        neither undefined nor iterable.

        Keyed by recipe rather than by entity because that is what varies here; the
        machine is the same one throughout. This walks every recipe in FD, not just
        the ones the test blueprints use, which is the point - the shapes that
        break are on recipes no real base contains.

        Takes the blueprint to walk rather than reading the loaded one, and for the
        same reason spriteDataTally does plus a sharper one: loading this blueprint
        renders it, EntitySprite.getDrawData asks every crafting machine for
        assemblerHasFluidInputs, and on the `{}` recipes that throws inside
        EntityContainer's constructor and takes the whole load down. Decoding
        without rendering is the only way to reach the readers one at a time.
    */
    recipeShapeTally: (blueprint?: Blueprint) => {
        const bpToWalk = blueprint ?? bp
        const out: Record<string, string[]> = {}
        const attempt = (fn: () => unknown): string => {
            try {
                return String(fn())
            } catch {
                return 'THREW'
            }
        }
        // A panel of its own rather than the live one, so the tally does not leave
        // the app's info panel showing the last recipe walked.
        const panel = new EntityInfoPanel()
        for (const entity of bpToWalk.entities.valuesArray()) {
            const recipe = entity.recipe
            if (recipe === undefined) continue
            out[recipe] = [
                attempt(() => entity.assemblerHasFluidInputs),
                attempt(() => entity.assemblerHasFluidOutputs),
                attempt(() => {
                    const info = OverlayContainer.createEntityInfo(entity, { x: 0, y: 0 })
                    return info === undefined ? -1 : info.children.length
                }),
                attempt(() => {
                    panel.updateVisualization(entity)
                    return 'ok'
                }),
            ]
        }
        panel.destroy()
        return out
    },
}

/*
    The layer fields that decide what ends up on screen, in a fixed order so the
    digest does not depend on the key order of whatever prototype object the
    generator happened to return.
*/
const DIGESTED_FIELDS = [
    'filename',
    'filenames',
    'x',
    'y',
    'width',
    'height',
    'size',
    'scale',
    'shift',
    'tint',
    'anchorX',
    'anchorY',
    'squishY',
    'rotAngle',
    'flipX',
    'flipY',
    'divW',
    'divH',
    'draw_as_shadow',
    'blend_mode',
] as const

function spriteDataDigest(data: unknown): string {
    if (data === SPRITE_GENERATION_FAILED) return 'FAILED'
    const layers = data as readonly Record<string, unknown>[]
    const parts = layers.map(layer =>
        layer === undefined || layer === null
            ? 'MISSING'
            : DIGESTED_FIELDS.map(f => JSON.stringify(layer[f] ?? null)).join(',')
    )
    // FNV-1a, 32 bit. Only needs to be stable and to change when the input does.
    let h = 0x811c9dc5
    const s = parts.join('|')
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return `${layers.length}:${(h >>> 0).toString(16).padStart(8, '0')}`
}

function registerActions(): void {
    EDITOR.registerAction('clear', {
        trigger: { code: 'KeyN' },
        modifiers: { shift: true },
        callbacks: {
            onPress: () => {
                loadBp(new Blueprint()).catch(error => createBPImportError(error))
                return true
            },
        },
    })

    EDITOR.registerAction('appendBlueprint', {
        trigger: { code: 'KeyV' },
        modifiers: { shift: true, control: true },
        callbacks: {
            onPress: () => {
                navigator.clipboard
                    .readText()
                    .then(getBlueprintOrBookFromSource)
                    .then(bp =>
                        editor.appendBlueprint(bp instanceof Book ? bp.selectBlueprint(0) : bp)
                    )
                    .catch(error => {
                        createBPImportError(error)
                    })
                return true
            },
        },
    })

    EDITOR.registerAction('generateOilOutpost', {
        trigger: { code: 'KeyG' },
        callbacks: {
            onPress: () => {
                const errorMessage = bp.generatePipes()
                if (errorMessage) {
                    createToast({ text: errorMessage, type: 'warning' })
                }
                return true
            },
        },
    })

    EDITOR.registerAction('takePicture', {
        trigger: { code: 'KeyS' },
        modifiers: { control: true },
        callbacks: {
            onPress: () => {
                // false, not a bare return: onPress answers whether the action was
                // handled, and an empty blueprint takes no picture.
                if (bp.isEmpty()) return false

                editor
                    .getPicture()
                    .then(blob => {
                        FileSaver.saveAs(blob, `${bp.name}.png`)
                        createToast({
                            text: 'Blueprint image successfully generated',
                            type: 'success',
                        })
                    })
                    .catch(error => createErrorMessage('Failed to generate the image.', error))
                return true
            },
        },
    })

    window.addEventListener('keydown', e => {
        if (e.target instanceof HTMLInputElement) return
        if (e.target instanceof HTMLTextAreaElement) return
        const infoPanel = element('info-panel')
        if (e.key === 'i') {
            if (infoPanel.classList.contains('active')) {
                infoPanel.classList.remove('active')
            } else {
                infoPanel.classList.add('active')
            }
        } else if (e.key === 'Escape') {
            infoPanel.classList.remove('active')
        }
    })

    EDITOR.importKeybinds(storedJson<Record<string, string>>('keybinds2'))

    window.addEventListener('visibilitychange', () => {
        const keybinds = EDITOR.exportKeybinds()
        if (Object.keys(keybinds).length) {
            localStorage.setItem('keybinds2', JSON.stringify(keybinds))
        } else {
            localStorage.removeItem('keybinds2')
        }
    })
}

function createWelcomeMessage(): void {
    const notFirstRun = localStorage.getItem('firstRun') === 'false'
    if (notFirstRun) return
    localStorage.setItem('firstRun', 'false')

    // Wait a bit just to capture the users attention
    // This way they will see the toast animation
    setTimeout(() => {
        createToast({
            text:
                '> To access the inventory and start building press E<br>' +
                '> To import/export a blueprint string use ctrl/cmd + C/V<br>' +
                '> For more info press I<br>' +
                '> Also check out the settings area',
            timeout: 30000,
        })
    }, 1000)
}
function createErrorMessage(text: string, error: unknown, timeout = 10000): void {
    console.error(error)
    createToast({
        text:
            `${text}<br>` +
            'Please check out the console (F12) for an error message and ' +
            'report this bug on github or using the feedback button.',
        type: 'error',
        timeout,
    })
}
function createBPImportError(
    error:
        | Error
        | TrainBlueprintError
        | ModdedBlueprintError
        | CorruptedBlueprintStringError
        | BookWithNoBlueprintsError
): void {
    if (error instanceof TrainBlueprintError) {
        createErrorMessage(
            'Blueprint with train entities not supported yet. If you think this is a mistake:',
            error.errors
        )
        return
    }

    if (error instanceof ModdedBlueprintError) {
        createErrorMessage(
            'Blueprint with modded items not supported yet. If you think this is a mistake:',
            error.errors
        )
        return
    }

    if (error instanceof CorruptedBlueprintStringError) {
        createErrorMessage(
            'Blueprint string might be corrupted. If you think this is a mistake:',
            error.error
        )
        return
    }

    if (error instanceof BookWithNoBlueprintsError) {
        createErrorMessage(`${error.error} If you think this is a mistake:`, error.error)
        return
    }

    createErrorMessage('Blueprint string could not be loaded.', error)
}
