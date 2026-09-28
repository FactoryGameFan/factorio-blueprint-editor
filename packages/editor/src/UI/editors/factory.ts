import { Entity } from '../../core/Entity'
import { Editor } from './Editor'
import { ChestEditor } from './ChestEditor'
import { InserterEditor } from './InserterEditor'
import { SplitterEditor } from './SplitterEditor'
import { TempEditor } from './TempEditor'
import { TrainStopEditor } from './TrainStopEditor'
import { DisplayPanelEditor } from './DisplayPanelEditor'

export function createEditor(entity: Entity): Editor | undefined {
    switch (entity.name) {
        case 'burner-inserter':
        case 'inserter':
        case 'long-handed-inserter':
        case 'fast-inserter':
        case 'bulk-inserter':
        case 'stack-inserter':
            return new InserterEditor(entity)
        case 'splitter':
        case 'fast-splitter':
        case 'express-splitter':
        case 'turbo-splitter':
            return new SplitterEditor(entity)
        case 'buffer-chest':
        case 'requester-chest':
        case 'storage-chest':
            return new ChestEditor(entity)
        /*
            The Space Age machines after rocket-silo came in with issue #345.
            They are listed by name rather than routed by prototype type,
            because those types also hold the stone and steel furnaces, the
            burner mining drill and the captive biter spawner. None of those
            has a module slot, and routing by type would give them a dialog.
        */
        case 'assembling-machine-1':
        case 'assembling-machine-2':
        case 'assembling-machine-3':
        case 'beacon':
        case 'electric-mining-drill':
        case 'lab':
        case 'electric-furnace':
        case 'pumpjack':
        case 'oil-refinery':
        case 'chemical-plant':
        case 'centrifuge':
        case 'rocket-silo':
        case 'foundry':
        case 'biochamber':
        case 'biolab':
        case 'crusher':
        case 'cryogenic-plant':
        case 'electromagnetic-plant':
        case 'recycler':
        case 'big-mining-drill':
            return new TempEditor(entity)
        case 'train-stop':
            return new TrainStopEditor(entity)
        case 'display-panel':
            return new DisplayPanelEditor(entity)
        default:
            return undefined
    }
}
