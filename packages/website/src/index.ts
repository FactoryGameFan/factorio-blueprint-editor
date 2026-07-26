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
    FD,
    EntitySprite,
    EntityInfoPanel,
    getSpriteData,
    SPRITE_GENERATION_FAILED,
} from '@fbe/editor'
import { initToasts } from './toasts'
import { initSettingsPane } from './settingsPane'

document.addEventListener('contextmenu', e => e.preventDefault())

const editor = new Editor()

let t0 = performance.now()

const CANVAS = document.getElementById('editor') as HTMLCanvasElement

let bp: Blueprint
let book: Book

const loadingScreen = {
    el: document.getElementById('loadingScreen'),
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
        if (localStorage.getItem('quickbarItemNames')) {
            const quickbarItems = JSON.parse(localStorage.getItem('quickbarItemNames'))
            editor.quickbarItems = quickbarItems
        }

        registerActions()

        const changeBookIndex = async (index: number): Promise<void> => {
            bp = book.selectBlueprint(index)
            await editor.loadBlueprint(bp)
        }
        changeBookForIndexSelector = initSettingsPane(editor, changeBookIndex).changeBook

        getBlueprintOrBookFromSource(bpSource)
            .catch(error => createBPImportError(error))

            .then(bpOrBook => loadBp(bpOrBook || new Blueprint()))

            .then(() => createWelcomeMessage())
            .catch(error => createBPImportError(error))
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

// Expose loading functions for Playwright test automation
;(window as any).__fbe_test = {
    getBlueprintOrBookFromSource,
    loadBp,
    /*
        The interaction mode the canvas is in, by name. The first thing any spec
        driving real pointer or keyboard input needs to assert on (issue #44).
    */
    editorMode: () => editor.mode,
    loadingScreen,
    getBook: () => book,
    selectBookIndex: async (index: number) => {
        if (!book) throw new Error('No book loaded')
        bp = book.selectBlueprint(index)
        await editor.loadBlueprint(bp)
    },
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
                if (bp.isEmpty()) return

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
        const infoPanel = document.getElementById('info-panel')
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

    EDITOR.importKeybinds(JSON.parse(localStorage.getItem('keybinds2')))

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
