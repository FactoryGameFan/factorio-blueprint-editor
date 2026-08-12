import { Container, Text } from 'pixi.js'
import { Entity } from '../../core/Entity'
import { ICondition } from '../../types'
import { TextInput } from '../controls/TextInput'
import { Checkbox } from '../controls/Checkbox'
import F from '../controls/functions'
import { styles } from '../style'
import G from '../../common/globals'
import { Editor } from './Editor'
import { DisplayPanelIcon } from './components/DisplayPanelIcon'

const ROW_HEIGHT = 26
const MAX_ROWS = 20
const ROW_WIDTH = 296
const CONDITION_ICON_SIZE = 18
const ICON_COL_WIDTH = 24
const COMPARATOR_COL_WIDTH = 18
const VALUE_COL_WIDTH = 40
const CONDITION_WIDTH = ICON_COL_WIDTH + COMPARATOR_COL_WIDTH + VALUE_COL_WIDTH

/** Icon(s) + comparator + value, laid out in fixed-width columns to line up across rows */
function createConditionDisplay(condition: ICondition | undefined): Container {
    const container = new Container()
    if (!condition || !condition.first_signal?.name) return container

    const icon = F.CreateIcon(condition.first_signal.name, CONDITION_ICON_SIZE)
    icon.position.set(ICON_COL_WIDTH / 2, CONDITION_ICON_SIZE / 2)
    container.addChild(icon)

    const comparatorLabel = new Text({
        text: condition.comparator || '<',
        style: styles.dialog.label,
    })
    comparatorLabel.position.set(ICON_COL_WIDTH, (CONDITION_ICON_SIZE - comparatorLabel.height) / 2)
    container.addChild(comparatorLabel)

    const valueX = ICON_COL_WIDTH + COMPARATOR_COL_WIDTH
    if (condition.second_signal?.name) {
        const secondIcon = F.CreateIcon(condition.second_signal.name, CONDITION_ICON_SIZE)
        secondIcon.position.set(valueX + CONDITION_ICON_SIZE / 2, CONDITION_ICON_SIZE / 2)
        container.addChild(secondIcon)
    } else {
        const constLabel = new Text({
            text: `${condition.constant ?? 0}`,
            style: styles.dialog.label,
        })
        constLabel.position.set(valueX, (CONDITION_ICON_SIZE - constLabel.height) / 2)
        container.addChild(constLabel)
    }

    return container
}

/**
 * Display Panel Editor.
 *
 * A circuit-connected panel's text and icon come from `control_behavior.parameters`
 * instead of the top-level `text`/`icon` fields this editor writes, so editing
 * those live per the connected signals is not something this UI can offer -
 * see the wiki's "custom text depending on circuit conditions". Showing the
 * conditions read-only at least answers "why does this panel say that".
 */
export class DisplayPanelEditor extends Editor {
    public constructor(entity: Entity) {
        const allParameters = entity.displayPanelParameters || []
        const parameters = allParameters.slice(0, MAX_ROWS)
        const connected = entity.generateConnector
        const rowCount = parameters.length + (allParameters.length > MAX_ROWS ? 1 : 0)
        const height = connected ? 222 + rowCount * ROW_HEIGHT : 214

        super(320, height, entity)

        const alwaysShow = new Checkbox(
            entity.displayPanelAlwaysShow,
            "Always show text in 'Alt-mode'"
        )
        alwaysShow.position.set(12, connected ? 160 : 168)
        this.addChild(alwaysShow)

        alwaysShow.on('changed', () => {
            this.m_Entity.displayPanelAlwaysShow = alwaysShow.checked
        })

        this.onEntityChange('displayPanelAlwaysShow', alwaysShowValue => {
            alwaysShow.checked = alwaysShowValue
        })

        if (connected) {
            this.addLabel(12, 190, 'Conditions (read only):')
            parameters.forEach((param, i) => {
                const row = new Container()
                row.position.set(12, 210 + i * ROW_HEIGHT)

                if (param.icon?.name) {
                    const icon = F.CreateIcon(param.icon.name, 20)
                    icon.position.set(10, 10)
                    row.addChild(icon)
                }

                const text = param.text ? `"${param.text}"` : ''
                row.addChild(this.addLabel(24, 4, text))

                const conditionDisplay = createConditionDisplay(param.condition)
                conditionDisplay.position.x = ROW_WIDTH - CONDITION_WIDTH
                row.addChild(conditionDisplay)

                this.addChild(row)
            })
            if (allParameters.length > MAX_ROWS) {
                this.addLabel(
                    12,
                    210 + parameters.length * ROW_HEIGHT,
                    `+${allParameters.length - MAX_ROWS} more`
                )
            }
            return
        }

        this.addLabel(140, 46, 'Icon:')
        const icon = new DisplayPanelIcon(entity)
        icon.position.set(140, 65)
        this.addChild(icon)

        this.addLabel(140, 110, 'Text:')
        const textInput = new TextInput(G.app.renderer, 150, entity.displayPanelText || '', 100)
        textInput.position.set(140, 129)
        this.addChild(textInput)

        textInput.on('changed', () => {
            this.m_Entity.displayPanelText = textInput.text || undefined
        })

        this.onEntityChange('displayPanelText', text => {
            textInput.text = text || ''
        })
    }
}
