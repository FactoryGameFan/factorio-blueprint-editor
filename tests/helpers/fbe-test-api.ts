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

/** A filter as `Entity.filters` answers it: 1-based slot index, item name, count. */
export interface TestFilter {
    index: number
    name: string
    count?: number
}

/**
 * The wider shape the setter takes, one entry per *slot*, so an empty slot is
 * present with no name. Mirrors the editor's `IFilterSlot`, structurally rather
 * than by import - the editor does not export it and this only needs the shape.
 */
export interface TestFilterSlot {
    index: number
    name: string | undefined
    count?: number
}

export interface FbeTestApi {
    getBlueprintOrBookFromSource: (source: string) => Promise<BlueprintOrBook>
    loadBp: (bp: unknown) => Promise<void>
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
    /** The hovered entity's number, or undefined in any mode but EDIT. */
    hoveredEntityNumber: () => number | undefined
    /** Whether the paint container is drawn; undefined when there is none. */
    paintContainerVisible: () => boolean | undefined
    /**
     * Action name -> key combo, for the actions not on their default combo.
     * Empty when every action is default. See tests/keybinds.spec.ts.
     */
    keyCombos: () => Record<string, string>
    /** How many wires the loaded blueprint would serialize. */
    wireCount: () => number
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
     * A write through `Entity.set filters`. Real input reaches that setter only
     * via paste-settings, which always sends a full list taken from another
     * entity; this covers what paste cannot say - clearing a chest, and the
     * partial slot lists the chest editor sends, which is commented out of the
     * editor factory and so unreachable through the UI.
     */
    setEntityFilters: (entityNumber: number, list: TestFilterSlot[] | undefined) => void
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
