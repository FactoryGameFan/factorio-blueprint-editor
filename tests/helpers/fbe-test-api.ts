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
