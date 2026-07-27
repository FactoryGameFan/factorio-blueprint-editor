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
import FD, { localisedName } from './core/factorioData'
import { OverlayContainer } from './containers/OverlayContainer'
import { EntityContainer } from './containers/EntityContainer'
import { Entity } from './core/Entity'
import { EntitySprite } from './containers/EntitySprite'
import { EntityInfoPanel } from './UI/EntityInfoPanel'
import { getSpriteData, SPRITE_GENERATION_FAILED } from './core/spriteDataBuilder'

export * from './core/bpString'
// OverlayContainer is exported for tests/overlay-container.spec.ts, which tallies
// what createEntityInfo draws per entity. EntitySprite, getSpriteData and
// SPRITE_GENERATION_FAILED are exported for tests/sprite-data.spec.ts, which
// digests the sprite data every entity generates. EntityInfoPanel is exported for
// tests/recipe-shapes.spec.ts, which needs the panel a hover updates without
// hovering. EntityContainer is exported for tests/entity-container-mappings.spec.ts,
// which measures its static container index across a blueprint swap. Nothing in
// the app imports any of them from here.
export {
    Editor,
    Book,
    Blueprint,
    GridPattern,
    FD,
    // For settingsPane.ts, which built its module dropdown keys with
    // `localised_name as string` - the same cast this reader replaced in the
    // editor, and the same silent "[object Object]" if a name is ever nested.
    localisedName,
    OverlayContainer,
    EntityContainer,
    // For the entityFilters/setEntityFilters test hooks in packages/website,
    // which look an entity up by number and need to name what they got back.
    Entity,
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
