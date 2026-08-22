/*
    The `window.__fbe_test` surface the website exposes for these specs, declared
    once. Two specs used to declare it independently and TypeScript rejects two
    `declare global` blocks that give the same property different types, so any
    spec needing a new hook has to add it here.

    The implementation lives in packages/website/src/index.ts.
*/

/** Entity name -> info overlay child count per placement, -1 for no overlay. */
export type OverlayTally = Record<string, number[]>

/** Entity name -> sprite data digest per placement, "FAILED" if the generator threw. */
export type SpriteDataTally = Record<string, string[]>

/**
 * Recipe name -> what each reader of its ingredient/result lists answered, in the
 * order [assemblerHasFluidInputs, assemblerHasFluidOutputs, createEntityInfo child
 * count]. "THREW" where the reader did not answer.
 */
export type RecipeShapeTally = Record<string, string[]>

/**
 * A filter as `Entity.filters` answers it: 1-based slot index, item name, count,
 * plus the 2.0 fields that used to be dropped on the way through (#88).
 */
export interface TestFilter {
    index: number
    name: string
    count?: number
    quality?: string
    comparator?: string
    max_count?: number
}

/**
 * The wider shape the setter takes, one entry per *slot*, so an empty slot is
 * present with no name. Mirrors the editor's `IFilterSlot`, structurally rather
 * than by import - the editor does not export it and this only needs the shape.
 */
export interface TestFilterSlot extends Omit<TestFilter, 'name'> {
    name: string | undefined
}

export interface FbeTestApi {
    getBlueprintOrBookFromSource: (source: string) => Promise<BlueprintOrBook>
    loadBp: (bp: unknown) => Promise<void>
    /** Opens BlueprintInfoEditor. See tests/blueprint-grid-position.spec.ts. */
    openBlueprintInfoEditor: () => void
    /**
     * `Blueprint.getIcon(1..4)`, read directly rather than through a
     * serialize() call - `encodeLoaded()` would work too, but `serialize()`
     * regenerates empty icon slots on every call (by design, see
     * `Blueprint.setIcon`'s own doc comment), which makes it unable to tell
     * "undo removed the regenerated icon" from "nothing happened and
     * serialize() regenerated it again anyway" - both look identical
     * through a re-serialize. See tests/blueprint-info-editor.spec.ts.
     */
    blueprintIcons: () => (string | undefined)[]
    /**
     * The size of `EntityContainer.mappings`, the static entity-number ->
     * container index. Loading a blueprint should leave it holding exactly that
     * blueprint's containers - see tests/entity-container-mappings.spec.ts.
     */
    entityContainerCount: () => number
    overlayInfoTally: () => OverlayTally
    /**
     * Defaults to the loaded blueprint; pass one to tally a book entry instead.
     * `withGrid: false` withholds the position grid, the way the entity editor
     * and paint previews draw.
     */
    spriteDataTally: (blueprint?: unknown, opts?: { withGrid?: boolean }) => SpriteDataTally
    /**
     * The bare-object path PaintEntityContainer draws with, for each direction.
     * An `undefined` entry omits `direction` entirely, which is what exercises
     * EntitySprite.getDrawData's `dir` default.
     */
    paintPreviewTally: (directions: (number | undefined)[]) => SpriteDataTally
    /**
     * Keyed by the recipe each entity carries. Takes the blueprint rather than
     * reading the loaded one: loading renders, and rendering is itself one of the
     * readers that throws on the awkward shapes.
     */
    recipeShapeTally: (blueprint?: unknown) => RecipeShapeTally
    /**
     * The interaction mode the canvas is in: NONE, EDIT, PAINT, PAN, COPY or
     * DELETE. See tests/editor-mode-input.spec.ts.
     */
    editorMode: () => string
    /**
     * Where the entity sits in client coordinates - the space a synthetic
     * pointer move takes - or undefined if the loaded blueprint has no such
     * entity. Hovering one is the only way into EDIT.
     */
    entityScreenPosition: (entityNumber: number) => { x: number; y: number } | undefined
    /**
     * Where the entity sits in the model, in tiles. Loading re-centres a
     * blueprint, so this is not the coordinate it was encoded with - a spec
     * computing positions relative to a loaded entity has to ask.
     */
    entityPosition: (entityNumber: number) => { x: number; y: number } | undefined
    /** The hovered entity's number, or undefined in any mode but EDIT. */
    hoveredEntityNumber: () => number | undefined
    /**
     * Whether the blueprint is drawn where the viewport says it is. False only
     * between a viewport change and the next frame - see
     * tests/viewport-transform-freshness.spec.ts.
     */
    viewportRenderedInSync: () => boolean
    /**
     * The viewport's continuous scale, ie. the zoom level. 32 px per tile at 1,
     * the same baseline Factorio uses - see tests/zoom-ladder.spec.ts.
     */
    viewportScale: () => number
    /** Whether the paint container is drawn; undefined when there is none. */
    paintContainerVisible: () => boolean | undefined
    /**
     * Where the paint container sits in tiles and which way it faces, or
     * undefined when there is none. The only way to see rail signal snapping -
     * which position and direction it settled on is otherwise invisible until
     * the entity is placed. See tests/rail-signal-snapping.spec.ts.
     */
    paintContainerState: () => { x: number; y: number; direction: number | undefined } | undefined
    /**
     * Action name -> key combo, for the actions not on their default combo.
     * Empty when every action is default. See tests/keybinds.spec.ts.
     */
    keyCombos: () => Record<string, string>
    /** How many wires the loaded blueprint would serialize. */
    wireCount: () => number
    /**
     * What a wire attaches to on this entity: the reach `getMaxWireDistance`
     * answers, and whether `getWireConnectionPoint` has a red and a green
     * position for the facing the entity is on.
     *
     * Both come from per-type switches in `factorioData.ts` that a new entity
     * type has to be added to by hand, and neither is otherwise readable. The
     * connector is at least fatal when it is missing - nothing catches around
     * `WiresContainer.add` - but the distance is silent: it defaults to 0, which
     * only draws the wire at alpha 0.3 as though it never reached, and no spec
     * reads a sprite alpha. See tests/splitter-wires.spec.ts.
     */
    entityWireAttachment: (entityNumber: number) => {
        maxWireDistance: number
        red: boolean
        green: boolean
    }
    /** How many tile sprites the canvas is drawing. See tests/tiles.spec.ts. */
    tileSpriteCount: () => number
    /**
     * The blueprint string a copy would produce - `Book.serialize()` when a book
     * is loaded, which nothing else reaches. See tests/book-serialize.spec.ts.
     */
    encodeLoaded: () => Promise<string>
    /** Make the book's blueprint at this flattened index the active one. */
    selectBookIndex: (index: number) => Promise<void>
    /**
     * What `Entity.filters` answers, or undefined for an entity type that has
     * none. See tests/chest-filters.spec.ts.
     */
    entityFilters: (entityNumber: number) => TestFilter[] | undefined
    /**
     * A write through `Entity.set filters`, saying the value directly where the
     * UI can only say it through a dialog layout. Paste-settings always sends a
     * full list taken from another entity, so it can express neither clearing a
     * chest nor a partial slot list; the chest editor can do both since #87, and
     * tests/chest-editor.spec.ts drives it that way.
     */
    /**
     * Whether the copy cursor box is drawn on a settings-copy source. The only
     * visible effect of `Entity.canPasteSettings`, which is otherwise
     * unobservable for a pair that is accepted but writes nothing. See
     * tests/paste-cross-type-settings.spec.ts.
     */
    copyCursorBoxVisible: () => boolean
    setEntityFilters: (entityNumber: number, list: TestFilterSlot[] | undefined) => void
    /**
     * Writes a cargo wagon's nested inventory - bar and slot filters together.
     * A write rather than a read because it exists to show the target holds its
     * own copy of a pasted settings object and not a reference to the source's;
     * one paste cannot tell those apart. See tests/paste-entity-settings.spec.ts.
     */
    setWagonInventory: (
        entityNumber: number,
        inventory: { bar?: number; filters?: { index: number; name: string }[] } | undefined
    ) => void
    /**
     * The signal names a constant combinator holds, flattened across all its
     * sections. The only reader of `control_behavior.sections`, and so the only
     * way to see whether the pre-2.0 migration that builds it produced
     * something the model can use. See tests/pre-2-0-shape-migrations.spec.ts.
     */
    constantCombinatorFilters: (entityNumber: number) => string[]
    /**
     * An entity's modules, one entry per slot with undefined for an empty one -
     * so the positions matter, not just the set. See tests/paste-modules.spec.ts.
     */
    entityModules: (entityNumber: number) => (string | undefined)[]
    /**
     * The detail line EntityInfoPanel shows for this entity - the inserter or
     * belt speed line, the crafting block for a machine. See
     * tests/inserter-throughput.spec.ts.
     */
    entityInfoText: (entityNumber: number) => string
    /** How many dialogs are open. See tests/chest-editor.spec.ts. */
    openDialogCount: () => number
    /**
     * Where the topmost open dialog sits, in the client coordinates a synthetic
     * pointer event takes. Dialogs are drawn with pixi, so this plus the
     * dialog's own layout constants is the only way for a spec to click a
     * control inside one. Throws when nothing is open.
     */
    topDialogBounds: () => { x: number; y: number; width: number; height: number }
    /**
     * Whether `EntityContainer.entityInfo` is currently visible for this
     * entity - the persistent always-show label and the hover tooltip toggle
     * it opposite each other so the two never stack. See
     * tests/display-panel-editor.spec.ts.
     */
    entityInfoVisible: (entityNumber: number) => boolean
}

/**
 * What getBlueprintOrBookFromSource hands back, as much of it as the specs need.
 * A book answers selectBlueprint; a bare blueprint does not.
 */
export interface BlueprintOrBook {
    selectBlueprint: (index: number) => unknown
    lastBookIndex?: number
}

declare global {
    interface Window {
        __fbe_test: FbeTestApi
    }
}

type Page = import('@playwright/test').Page

/** Load the editor and wait for the test hooks to be attached. */
export async function waitForEditor(page: Page): Promise<void> {
    await page.goto('/')
    await page.waitForFunction(() => window.__fbe_test !== undefined, { timeout: 60_000 })
}

/** Load a blueprint string into the running editor. */
export async function loadBlueprint(page: Page, source: string): Promise<void> {
    await page.evaluate(async (src: string) => {
        const t = window.__fbe_test
        const bp = await t.getBlueprintOrBookFromSource(src)
        await t.loadBp(bp)
    }, source)
}
