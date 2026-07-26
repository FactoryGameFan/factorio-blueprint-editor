import { Container, Rectangle, Text } from 'pixi.js'
import FD, {
    getModule,
    isBeacon,
    isCraftingMachine,
    isInserter,
    isTransportBeltConnectable,
    recipeIngredients,
    recipeResults,
} from '../core/factorioData'
import G from '../common/globals'
import util from '../common/util'
import { Entity } from '../core/Entity'
import F from './controls/functions'
import { Panel } from './controls/Panel'
import { styles } from './style'

function template(strings: TemplateStringsArray, ...keys: (number | string)[]) {
    return (...values: (unknown | Record<string, unknown>)[]) => {
        const result = [strings[0].replace('\n', '')]
        keys.forEach((key, i) => {
            result.push(
                typeof key === 'number'
                    ? (values as string[])[key]
                    : (values[0] as Record<string, string>)[key],
                strings[i + 1]
            )
        })
        return result.join('')
    }
}

const entityInfoTemplate = template`
Crafting speed: ${'craftingSpeed'} ${'speedMultiplier'}
Power consumption: ${'energyUsage'} kW ${'energyMultiplier'}`

const SIZE_OF_ITEM_ON_BELT = 0.25

const getBeltSpeed = (beltSpeed: number): number => beltSpeed * 60 * (1 / SIZE_OF_ITEM_ON_BELT) * 2

const containerToContainer = (rotationSpeed: number, n: number): number => rotationSpeed * 60 * n

/**
    nr of items to ignore the time it takes to place them on a belt

    because: first item is being placed instantly and also in front so
    this also reduces the time it takes to put down the second item by about 75%
*/
const NR_OF_ITEMS_TO_IGNORE = 1.75
const containerToBelt = (rotationSpeed: number, beltSpeed: number, n: number): number => {
    const armTime = 1 / (rotationSpeed * 60)
    const itemTime = (1 / (beltSpeed * 60)) * SIZE_OF_ITEM_ON_BELT
    return n / (armTime + itemTime * Math.max(n - NR_OF_ITEMS_TO_IGNORE, 0))
}
// TODO: add beltToContainer

const roundToTwo = (n: number): number => Math.round(n * 100) / 100
const roundToFour = (n: number): number => Math.round(n * 10000) / 10000

/**
 * This class creates a panel to show detailed informations about each entity (as the original game and maybe more).
 * @function updateVisualization (Update informations and show/hide panel)
 * @function setPosition (top right corner of the screen)
 * Extends Panel (from /controls/panel, which extends Container).
 * @see instantiation in /index.ts - event in /containers/entity.ts
 */
export class EntityInfoPanel extends Panel {
    private title: Text
    private m_EntityName: Text
    private m_entityInfo: Text
    private m_RecipeContainer: Container
    private m_RecipeIOContainer: Container

    public constructor() {
        super(270, 270)

        this.eventMode = 'none'
        this.visible = false

        this.title = new Text({ text: 'Information', style: styles.dialog.title })
        this.title.anchor.set(0.5, 0)
        this.title.position.set(super.width / 2, 2)
        this.addChild(this.title)

        this.m_EntityName = new Text({ text: '', style: styles.dialog.label })
        this.m_entityInfo = new Text({ text: '', style: styles.dialog.label })
        this.m_RecipeContainer = new Container()
        this.m_RecipeIOContainer = new Container()

        this.addChild(
            this.m_EntityName,
            this.m_entityInfo,
            this.m_RecipeContainer,
            this.m_RecipeIOContainer
        )
    }

    public updateVisualization(entity?: Entity): void {
        this.m_RecipeContainer.removeChildren()
        this.m_RecipeIOContainer.removeChildren()

        if (!entity) {
            this.visible = false
            this.m_EntityName.text = ''
            this.m_entityInfo.text = ''
            return
        }

        this.visible = true
        let nextY = this.title.position.y + this.title.height + 10

        this.m_EntityName.text = `Name: ${FD.entities[entity.name].localised_name}`
        this.m_EntityName.position.set(10, nextY)
        nextY = this.m_EntityName.position.y + this.m_EntityName.height + 10

        const machineData = entity.entityData
        if (machineData.type === 'assembling-machine' && isCraftingMachine(machineData)) {
            // Details for assembling machines with or without recipe
            let productivity = 0
            let consumption = 0
            // let pollution = 0
            let speed = 0

            for (const module of entity.modules) {
                if (!module) continue

                const moduleData = getModule(module)
                if (moduleData.effect.productivity) {
                    productivity += moduleData.effect.productivity
                }
                if (moduleData.effect.consumption) {
                    consumption += moduleData.effect.consumption
                }
                // if (moduleData.effect.pollution) {
                //     pollution += moduleData.effect.pollution
                // }
                if (moduleData.effect.speed) {
                    speed += moduleData.effect.speed
                }
            }

            for (const beacon of this.findNearbyBeacons(entity)) {
                const beaconData = beacon.entityData
                if (!isBeacon(beaconData)) continue
                for (const module of beacon.modules) {
                    if (!module) continue

                    const moduleData = getModule(module)
                    if (moduleData.effect.productivity) {
                        productivity +=
                            moduleData.effect.productivity * beaconData.distribution_effectivity
                    }
                    if (moduleData.effect.consumption) {
                        consumption +=
                            moduleData.effect.consumption * beaconData.distribution_effectivity
                    }
                    // if (moduleData.effect.pollution) {
                    //     pollution += moduleData.effect.pollution * beaconData.distribution_effectivity
                    // }
                    if (moduleData.effect.speed) {
                        speed += moduleData.effect.speed * beaconData.distribution_effectivity
                    }
                }
            }

            consumption = consumption < -0.8 ? -0.8 : consumption
            const newCraftingSpeed = machineData.crafting_speed * (1 + speed)
            const newEnergyUsage =
                parseInt(machineData.energy_usage.slice(0, -2)) * (1 + consumption)

            const fmt = (n: number): string =>
                `(${Math.sign(n) === 1 ? '+' : '-'}${roundToTwo(Math.abs(n) * 100)}%)`

            // Show modules effect and some others informations
            this.m_entityInfo.text = entityInfoTemplate({
                craftingSpeed: roundToFour(newCraftingSpeed),
                speedMultiplier: speed ? fmt(speed) : '',
                energyUsage: roundToTwo(newEnergyUsage),
                energyMultiplier: consumption ? fmt(consumption) : '',
            })

            this.m_entityInfo.position.set(10, nextY)
            nextY = this.m_entityInfo.position.y + this.m_entityInfo.height + 10

            if (!entity.recipe) return

            // Details for assembling machines with recipe
            this.m_RecipeContainer.removeChildren()
            const recipe = FD.recipes[entity.recipe]
            if (recipe === undefined) return

            // Show the original recipe
            this.m_RecipeContainer.addChild(
                new Text({
                    text: 'Recipe:',
                    style: styles.dialog.label,
                })
            )
            F.CreateRecipe(
                this.m_RecipeContainer,
                0,
                20,
                recipeIngredients(recipe),
                recipeResults(recipe),
                recipe.energy_required
            )
            this.m_RecipeContainer.position.set(10, nextY)
            nextY = this.m_RecipeContainer.position.y + this.m_RecipeContainer.height + 20

            // Show recipe that takes entity effects into account
            this.m_RecipeIOContainer.addChild(
                new Text({
                    text: 'Recipe (takes entity effects into account):',
                    style: styles.dialog.label,
                })
            )
            const energy_required = recipe.energy_required || 0.5
            F.CreateRecipe(
                this.m_RecipeIOContainer,
                0,
                20,
                recipeIngredients(recipe).map(i => ({
                    ...i,
                    amount: roundToTwo((i.amount * newCraftingSpeed) / energy_required),
                })),
                // A result states either an amount or an amount_min/amount_max
                // range; every result in the current data states an amount.
                recipeResults(recipe).map(r => ({
                    ...r,
                    amount: roundToTwo(
                        (((r.amount ?? 0) * newCraftingSpeed) / energy_required) *
                            (1 + productivity)
                    ),
                })),
                1
            )
            this.m_RecipeIOContainer.position.set(10, nextY)
            nextY = this.m_RecipeIOContainer.position.y + this.m_RecipeIOContainer.height + 20
        }

        const isBelt = (e: Entity): boolean =>
            e.entityData.type === 'transport-belt' ||
            e.entityData.type === 'underground-belt' ||
            e.entityData.type === 'splitter' ||
            e.entityData.type === 'loader'

        const inserterData = entity.entityData
        if (isInserter(inserterData)) {
            // Details for inserters
            let speed = containerToContainer(inserterData.rotation_speed, entity.inserterStackSize)
            const tiles = entity.name === 'long-handed-inserter' ? 2 : 1
            // const fromP = util.rotatePointBasedOnDir([0, -tiles], entity.direction)
            const toP = util.rotatePointBasedOnDir([0, tiles], entity.direction)
            // const from = G.bp.entities.get(
            //     G.bp.entityPositionGrid.getCellAtPosition(
            //         util.sumprod(entity.position, fromP)
            //     )
            // )
            const to = G.bp.entityPositionGrid.getEntityAtPosition(
                util.sumprod(entity.position, toP)
            )
            const toData = to?.entityData
            if (to && isBelt(to) && toData && isTransportBeltConnectable(toData)) {
                speed = containerToBelt(
                    inserterData.rotation_speed,
                    toData.speed,
                    entity.inserterStackSize
                )
            }
            this.m_entityInfo.text = `Speed: ${roundToTwo(
                speed
            )} items/s\n> changes if inserter unloads to a belt`
            this.m_entityInfo.position.set(10, nextY)
            nextY = this.m_entityInfo.position.y + this.m_entityInfo.height + 20
        }

        const beltData = entity.entityData
        if (isBelt(entity) && isTransportBeltConnectable(beltData)) {
            // Details for belts
            this.m_entityInfo.text = `Speed: ${roundToTwo(getBeltSpeed(beltData.speed))} items/s`
            this.m_entityInfo.position.set(10, nextY)
        }
    }

    protected override setPosition(): void {
        this.position.set(G.app.screen.width - this.width + 1, 0)
    }

    private findNearbyBeacons(entity: Entity): Entity[] {
        const entityRect = new Rectangle(entity.position.x, entity.position.y)
        entityRect.pad(entity.size.x / 2, entity.size.y / 2)

        return entity.Blueprint.entities.filter((beacon: Entity): boolean => {
            if (beacon.type !== 'beacon') {
                return false
            }

            const beaconAura = new Rectangle(beacon.position.x, beacon.position.y, 1, 1)
            const beaconProto = FD.entities.beacon
            beaconAura.pad((isBeacon(beaconProto) ? beaconProto.supply_area_distance : 0) + 1)

            return (
                beaconAura.contains(entityRect.left, entityRect.top) ||
                beaconAura.contains(entityRect.right, entityRect.top) ||
                beaconAura.contains(entityRect.left, entityRect.bottom) ||
                beaconAura.contains(entityRect.right, entityRect.bottom)
            )
        })
    }
}
