import { Book } from './core/Book'
import { Blueprint } from './core/Blueprint'
import { GridPattern } from './containers/BlueprintContainer'
import {
    registerAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
} from './actions'
import { Editor } from './Editor'
import FD from './core/factorioData'
import { OverlayContainer } from './containers/OverlayContainer'
import { EntitySprite } from './containers/EntitySprite'
import { EntityInfoPanel } from './UI/EntityInfoPanel'
import { getSpriteData, SPRITE_GENERATION_FAILED } from './core/spriteDataBuilder'

export * from './core/bpString'
// OverlayContainer is exported for tests/overlay-container.spec.ts, which tallies
// what createEntityInfo draws per entity. EntitySprite, getSpriteData and
// SPRITE_GENERATION_FAILED are exported for tests/sprite-data.spec.ts, which
// digests the sprite data every entity generates. EntityInfoPanel is exported for
// tests/recipe-shapes.spec.ts, which needs the panel a hover updates without
// hovering. Nothing in the app imports any of them from here.
export {
    Editor,
    Book,
    Blueprint,
    GridPattern,
    FD,
    OverlayContainer,
    EntitySprite,
    EntityInfoPanel,
    getSpriteData,
    SPRITE_GENERATION_FAILED,
}
export default {
    registerAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
}
