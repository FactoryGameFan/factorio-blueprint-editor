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

export * from './core/bpString'
// OverlayContainer is exported for tests/overlay-container.spec.ts, which tallies
// what createEntityInfo draws per entity. Nothing in the app imports it from here.
export { Editor, Book, Blueprint, GridPattern, FD, OverlayContainer }
export default {
    registerAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
}
