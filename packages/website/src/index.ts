import './index.css'

import { isMobile } from 'pixi.js'
import EDITOR, {
    Editor,
    Blueprint,
    Book,
    CorruptedBlueprintStringError,
    BookWithNoBlueprintsError,
    EmptyBlueprintStringError,
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
    type QuickActions,
    Dialog,
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

/*
    Whether startup has run to the point where `bp` and the editor's `G.UI`
    both exist - set at exactly the moment `__fbe_test` goes on `window`, and
    for the same reason its own comment gives. Read by the clipboard listeners
    below; see clipboardShortcutsBelongToCanvas for why they need it.

    Measured before it existed: with the canvas focused during a cold data.json
    load, Ctrl+C threw an uncaught "Cannot read properties of undefined
    (reading 'isEmpty')" and Ctrl+V raised a "Blueprint string could not be
    loaded" toast naming nothing about the real problem. Neither is what a
    keypress before the editor is up should do.
*/
let startupFinished = false

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
    '\n%cLooking for the source?\nhttps://github.com/FactoryGameFan/factorio-blueprint-editor\n',
    'color: #1f79aa; font-weight: bold'
)

const createToast = initToasts()

function saveBlob(blob: Blob, filename: string): void {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href))
}

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
            'If you think this is a mistake, feel free to report this bug on github.',
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

/**
 * The four actions ToolsPanel's quick-action buttons trigger through
 * `G.quickActions` (see `QuickActions` in `packages/editor/src/common/globals.ts`) -
 * the same logic the `copy`/`paste` document listeners and the
 * `appendBlueprint`/`takePicture` keybinds below call, extracted so both the
 * keyboard and the button reach one implementation instead of two.
 *
 * `importReplace`/`importAppend` read the OS clipboard when called with no
 * argument - a key press or a ToolsPanel button - or use `source` directly
 * when ImportDialog's textarea calls them, which never touches the
 * clipboard at all.
 */
/**
 * Resolves `true` once the loaded blueprint has actually changed, `false`
 * after a failure this already reported through `createBPImportError` - see
 * `QuickActions.importReplace`'s own doc comment for who reads that and why.
 */
function importReplace(source?: string): Promise<boolean> {
    loadingScreen.show()

    return (source !== undefined ? Promise.resolve(source) : navigator.clipboard.readText())
        .then(getBlueprintOrBookFromSource)
        .then(loadBp)
        .then(() => true)
        .catch(error => {
            loadingScreen.hide()
            createBPImportError(error)
            return false
        })
}

/** Same as `importReplace` re: the resolved value. */
function importAppend(source?: string): Promise<boolean> {
    return (source !== undefined ? Promise.resolve(source) : navigator.clipboard.readText())
        .then(getBlueprintOrBookFromSource)
        .then(bp => editor.appendBlueprint(bp instanceof Book ? bp.selectBlueprint(0) : bp))
        .then(() => true)
        .catch(error => {
            createBPImportError(error)
            return false
        })
}

function exportString(): boolean {
    if (bp.isEmpty()) return false

    encode(book || bp)
        .then(s => navigator.clipboard.writeText(s))
        .then(() => createToast({ text: 'Blueprint string copied to clipboard', type: 'success' }))
        .catch(error => createErrorMessage('Blueprint string could not be generated.', error))
    return true
}

function exportImage(): boolean {
    if (bp.isEmpty()) return false

    editor
        .getPicture()
        .then(blob => {
            saveBlob(blob, `${bp.name}.png`)
            createToast({ text: 'Blueprint image successfully generated', type: 'success' })
        })
        .catch(error => createErrorMessage('Failed to generate the image.', error))
    return true
}

/** For ExportDialog's textarea - the same guard `exportString`/`exportImage`
 * use, but handing back the string instead of writing it to the clipboard. */
function encodeCurrent(): Promise<string | undefined> {
    if (bp.isEmpty()) return Promise.resolve(undefined)
    return encode(book || bp)
}

/** For ImportDialog's Paste button - fills the textarea from the OS
 * clipboard without parsing or loading it, unlike `importReplace`/
 * `importAppend`'s own clipboard reads. */
function readClipboardText(): Promise<string> {
    return navigator.clipboard.readText()
}

/*
    exportString stays a local function - it's what the `copy` listener below
    calls directly - but is deliberately not part of `quickActions`: nothing
    in the editor package has a one-click "copy the string" action to trigger
    it from (see QuickActions' own doc comment in common/globals.ts).
*/
const quickActions: QuickActions = {
    importReplace,
    importAppend,
    exportImage,
    encodeCurrent,
    readClipboardText,
}

editor
    .init(CANVAS, { quickActions, logger: createToast })
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

                `import.meta.env.DEV` gates the assignment so the test API never
                reaches the production bundle at fbe.factorygamefan.com (issue
                #292). Vite replaces it with `false` in a `vp build`, which drops
                this branch and lets Rolldown tree-shake `testApi` and everything
                only it references. The e2e job serves the app with `vp dev`
                (via `npm run localpreview`), where it is `true`, so every spec
                still gets its hook. `startupFinished` stays outside the guard -
                the clipboard listeners below read it in production too.
            */
            .then(() => {
                startupFinished = true
                if (import.meta.env.DEV) {
                    ;(window as any).__fbe_test = testApi
                }
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

/**
 * Whether Ctrl+C and Ctrl+V belong to the canvas right now (issue #279).
 *
 * The focus half alone is not enough, and the reason is that the ordinary
 * route to ImportDialog leaves the canvas focused: clicking ToolsPanel's
 * Import slot *is* a click on the canvas, and ImportDialog never focuses its
 * own field (only ExportDialog does). So Ctrl+V with that dialog open ran
 * `importReplace()` -> `loadBp` -> `Editor.loadBlueprint`, which assigns a
 * fresh `G.bp` and calls `Dialog.closeAll()`. The whole blueprint was replaced
 * from the OS clipboard, the dialog went with it along with anything typed
 * into its field, and the new blueprint's empty `History` meant neither Ctrl+Z
 * nor the ToolsPanel Undo slot brought the old one back. The dialog on screen
 * offers Paste, Replace and Append as three separate choices, and the shortcut
 * silently picked Replace.
 *
 * **Both listeners take this, not only `paste`.** Copy is the milder twin
 * rather than a different case. With ImportDialog open, the only Ctrl+C that
 * reaches here is one pressed while the user is looking at a field they were
 * about to paste a blueprint string into - clicking into that field would make
 * it the `activeElement` and stop the listener anyway - and what it does is
 * overwrite that string on the OS clipboard with the loaded blueprint's own.
 * Losing the string you were about to import is smaller than losing the
 * blueprint you had, but it is the same mistake, silent in the same way, and
 * gating one and not the other is not explainable from the outside: nothing on
 * screen tells a user that the two halves of the clipboard follow different
 * rules while a dialog is up.
 *
 * ExportDialog is unaffected either way - it focuses its own textarea on open,
 * so it already fails the focus half.
 *
 * The order is load-bearing. `Editor.openDialogCount` reads `G.UI`, which
 * `Editor.init` assigns only after awaiting data.json, and these listeners are
 * registered while that await is still in flight. The canvas is reachable in
 * that window - it carries `tabindex="1"` and one Tab press focuses it through
 * the loading screen (measured) - so `startupFinished` has to be read before
 * `openDialogCount`, or a keypress during a cold load throws a TypeError
 * naming `G.UI` instead of doing nothing.
 */
function clipboardShortcutsBelongToCanvas(): boolean {
    return startupFinished && document.activeElement === CANVAS && editor.openDialogCount === 0
}

document.addEventListener('copy', (e: ClipboardEvent) => {
    if (!clipboardShortcutsBelongToCanvas()) return
    e.preventDefault()
    exportString()
})

document.addEventListener('paste', (e: ClipboardEvent) => {
    if (!clipboardShortcutsBelongToCanvas()) return
    e.preventDefault()
    // Fire-and-forget, same as before importReplace reported success/failure
    // to its callers - this one has nothing to do with the resolved value,
    // unlike ImportDialog's Replace button.
    void importReplace()
})

/*
    The Playwright test API. Built here, but not put on `window` until startup
    has finished - see the `.then` above that assigns it, and issue #109 - and
    then only under `import.meta.env.DEV`, so a production build strips the whole
    thing (issue #292).

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

/*
    A dialog whose constructor throws after `super()` has run, and nothing else.

    `tests/dialog-registry-leak.spec.ts` needs one to prove that `Dialog`
    registers on the pixi `added` event rather than in its constructor - a
    phantom entry in `Dialog.s_openDialogs` is invisible to `openDialogCount`,
    which counts pixi children, so the only thing that can see one is the `E`
    keybind branching on `Dialog.anyOpen()`.

    It used to reach a throwing constructor through a live bug instead, an editor
    drawing an icon the data did not have. #286 guarded every one of those, so
    that fixture is gone - and a test that needs a bug to stay unfixed is a test
    that argues against fixing it. This is the fixture written down instead.
*/
class ThrowingDialog extends Dialog {
    public constructor() {
        super(300, 200, 'never shown')
        throw new Error('deliberate: a dialog constructor that throws after super()')
    }
}

const testApi = {
    getBlueprintOrBookFromSource,
    loadBp,
    /**
     * Opens ImportDialog, ToolsPanel's Import slot with no keybind of its own
     * to reach it by. See tests/quick-actions.spec.ts.
     */
    openImportDialog: () => editor.openImportDialog(),
    /** Opens ExportDialog. See tests/quick-actions.spec.ts. */
    openExportDialog: () => editor.openExportDialog(),
    /** `Editor.exportEncodeCount`. See tests/quick-actions.spec.ts. */
    exportEncodeCount: () => editor.exportEncodeCount,
    /**
     * `exportString`/`exportImage`'s own guard result, without running
     * either - `!bp.isEmpty()` is the exact condition both functions open
     * with, before either touches `navigator.clipboard`/`saveBlob`. This
     * used to call `exportString()`/`exportImage()` themselves and report
     * whatever they returned, which mirrors the guard only for an *empty*
     * blueprint; for a loaded one it silently performs the real action -
     * an actual clipboard write and an actual PNG download - every time it
     * is called. The gate below removes one half of that reach: this no
     * longer sits on `window` at fbe.factorygamefan.com for any script on the
     * page to call (issue #292). It does not remove the other half. The specs
     * run against `vp dev`, where the hook is present, so a mutating predicate
     * would still do a real clipboard write and a real PNG download on every
     * call inside a Playwright run. What makes this safe is that it reads
     * state instead of changing it, not the gate. See
     * tests/quick-actions.spec.ts.
     */
    exportGuardResult: () => ({ exportString: !bp.isEmpty(), exportImage: !bp.isEmpty() }),
    /**
     * `encodeCurrent`'s own empty-blueprint guard - undefined rather than a
     * string, the same condition `exportGuardResult` pins for the other two
     * QuickActions members. See tests/quick-actions.spec.ts.
     */
    encodeCurrentResult: () => encodeCurrent(),
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
    viewportRenderedInSync: () => editor.viewportRenderedInSync,
    viewportScale: () => editor.viewportScale,
    paintContainerState: () => editor.paintContainerState,
    entityPosition: (entityNumber: number) => editor.entityPosition(entityNumber),
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
    /*
        Where a wire attaches to an entity and how far it may run. Both answers
        come from a per-type switch in factorioData.ts, and neither is visible
        from outside: the connection point only becomes a wire sprite's origin,
        and the distance only becomes that sprite's alpha.

        Side 1 is the circuit side for everything that is not a combinator or a
        power switch, which is what the entities asking this are.
    */
    entityWireAttachment: (entityNumber: number) => {
        const entity = entityOf(entityNumber)
        return {
            maxWireDistance: entity.maxWireDistance,
            red: entity.getWireConnectionPoint('red', 1) !== undefined,
            green: entity.getWireConnectionPoint('green', 1) !== undefined,
        }
    },
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
    /*
        Whether the copy cursor box is drawn - the outline shown on a settings
        copy source while hovering a valid target. The only visible consequence
        of Entity.canPasteSettings, and so the only way to tell a pair the editor
        refuses from one it accepts and then writes nothing for.
    */
    copyCursorBoxVisible: () => editor.copyCursorBoxVisible,
    /*
        Constructs a dialog whose constructor throws, and answers whether it did.
        Never added to the display tree, so with registration on the `added`
        event it leaves nothing behind; with the pre-#280 constructor push it
        leaves a phantom that the next `E` press is swallowed by.

        The return value is the control: it says the constructor really threw,
        which a spec cannot otherwise tell from the throw being swallowed
        somewhere. See tests/dialog-registry-leak.spec.ts.
    */
    throwingDialogAttempt: () => {
        try {
            new ThrowingDialog()
            return false
        } catch {
            return true
        }
    },
    openDialogCount: () => editor.openDialogCount,
    topDialogBounds: () => editor.topDialogBounds,
    toolsPanelBounds: () => editor.toolsPanelBounds,
    /*
        Whether the entity's info overlay container is currently visible - not
        what it was built with, which overlayInfoTally already covers, but
        whether EntityContainer has it switched on right now. The display panel
        editor swaps this opposite the hover tooltip so the two never draw at
        once; nothing else needed to read it before.
    */
    entityInfoVisible: (entityNumber: number) =>
        EntityContainer.containerOf(entityNumber).entityInfoVisible,
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
                // Fire-and-forget, same reason as the `paste` listener above.
                void importAppend()
                return true
            },
        },
    })

    /*
        Bound to the physical `=` and `-` keys, which are matched on `e.code` -
        so they work without a layout table on keyboards where those characters
        need a modifier. The game has the same two controls (`zoom-in` and
        `zoom-out`); this editor had none, which left the measured ladder
        reachable only from tests once the wheel went continuous (#206).
    */
    EDITOR.registerAction('zoomIn', {
        trigger: { code: 'Equal' },
        callbacks: {
            onPress: () => {
                editor.zoomStep(true)
                return true
            },
        },
    })

    EDITOR.registerAction('zoomOut', {
        trigger: { code: 'Minus' },
        callbacks: {
            onPress: () => {
                editor.zoomStep(false)
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
            onPress: () => exportImage(),
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
            'report this bug on github.',
        type: 'error',
        timeout,
    })
}
function createBPImportError(
    error:
        | Error
        | CorruptedBlueprintStringError
        | BookWithNoBlueprintsError
        | EmptyBlueprintStringError
): void {
    /*
        Not through `createErrorMessage`, which is the whole point of the class
        existing (issue #298). That helper appends "report this bug on github",
        and an empty `?source=` or a paste from an empty clipboard is not a bug
        anyone should file. It is also not an error: the import declined to
        happen and whatever was already loaded is untouched, so this says what
        happened and gets out of the way.

        It comes first because the arms below it end in a catch-all - an
        unrecognised error is exactly what this used to be.
    */
    if (error instanceof EmptyBlueprintStringError) {
        createToast({ text: error.error, type: 'warning' })
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
