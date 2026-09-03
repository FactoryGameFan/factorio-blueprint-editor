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
            return new TempEditor(entity)
        case 'train-stop':
            return new TrainStopEditor(entity)
        case 'display-panel':
            return new DisplayPanelEditor(entity)
        default:
            return undefined
    }
}
