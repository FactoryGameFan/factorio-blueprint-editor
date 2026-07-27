import { Container, Rectangle, Text } from 'pixi.js'
import FD, {
    getModule,
    isBeacon,
    isCraftingMachine,
    isInserter,
    isTransportBeltConnectable,
    localisedName,
    recipeIngredients,
    recipeResults,
} from '../core/factorioData'
import G from '../common/globals'
import util from '../common/util'
import { Entity } from '../core/Entity'
import F from './controls/functions'
import { Panel } from './controls/Panel'
import { styles } from './style'
import { beltThroughput, inserterThroughput } from '../core/throughput'

/*
    A tagged template whose holes are either positions or names: `${0}` reads
    the first argument, `${'craftingSpeed'}` reads that property off a single
    object argument. The two forms are not mixed - a template uses one or the
    other, and `entityInfoTemplate` below is the named kind.

    The parameter used to be `(unknown | Record<string, unknown>)[]`, which is
    just `unknown[]` - the Record arm is absorbed - so it documented an intent
    the type did not carry, and the body cast its way through twice to compensate
    (issue #81). Saying it as an overloaded pair puts the check where the intent
    was and removes both casts.
*/
type NamedValues = Record<string, string | number>

function template(
    strings: TemplateStringsArray,
    ...keys: number[]
): (...values: (string | number)[]) => string
function template(strings: TemplateStringsArray, ...keys: string[]): (values: NamedValues) => string
function template(strings: TemplateStringsArray, ...keys: (number | string)[]) {
    return (...values: [NamedValues] | (string | number)[]) => {
        const result = [strings[0].replace('\n', '')]
        for (const [i, key] of keys.entries()) {
            const value =
                typeof key === 'number'
                    ? (values as (string | number)[])[key]
                    : (values[0] as NamedValues)[key]
            result.push(String(value), strings[i + 1])
        }
        return result.join('')
    }
}

const entityInfoTemplate = template`
Crafting speed: ${'craftingSpeed'} ${'speedMultiplier'}
Power consumption: ${'energyUsage'} kW ${'energyMultiplier'}`

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

    /**
     * The detail line the panel is currently showing - the speed line for an
     * inserter or a belt, the crafting block for a machine, empty when nothing
     * is hovered.
     *
     * Read-only, and here so a spec can assert on what the panel says: it is
     * drawn with pixi, so there is no other way to see it from outside the
     * canvas. See tests/inserter-throughput.spec.ts.
     */
    public get infoText(): string {
        return this.m_entityInfo.text
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

        this.m_EntityName.text = `Name: ${localisedName(FD.entities[entity.name])}`
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
        /*
            stackSize is null only for an entity that is not an inserter and
            carries no override_stack_size, so the isInserter narrowing beside it
            already rules that out - but the narrowing is on entityData and the
            getter reads it again, which TypeScript cannot connect. Tested rather
            than asserted: if it ever is null the speed line is left off, which
            is a missing line and not a thrown panel.
        */
        const stackSize = entity.inserterStackSize
        if (isInserter(inserterData) && stackSize !== null) {
            // Details for inserters
            const tiles = entity.name === 'long-handed-inserter' ? 2 : 1

            /*
                The belt speed at one end of the swing, or undefined where that
                end is not a belt.

                Which end is which comes from the prototypes rather than from
                guessing: every inserter declares `pickup_position` at a negative
                offset and `insert_position` at a positive one - {0, -1} and
                {0, 1.2} for all of them but long-handed, which is {0, -2} and
                {0, 2.2}. So the negative offset is the pickup side.

                That the two positions are also in `data.json` means `tiles`
                below could read them instead of switching on the name, which is
                the pattern this codebase otherwise avoids. Left alone here: it
                is right for all six inserters that exist, and the 1.2 would
                bring a rounding question that has nothing to do with #96.
            */
            const beltSpeedAt = (offset: readonly [number, number]): number | undefined => {
                const at = G.bp.entityPositionGrid.getEntityAtPosition(
                    util.sumprod(
                        entity.position,
                        util.rotatePointBasedOnDir(offset, entity.direction)
                    )
                )
                if (at === undefined || !isBelt(at)) return undefined
                const data = at.entityData
                return isTransportBeltConnectable(data) ? data.speed : undefined
            }

            /*
                Both ends, not only the destination. The pickup lookup was
                written out here and commented out, so an inserter taking items
                off a belt was reported at the container-to-container rate -
                too high, with nothing on screen to say so (issue #96).
            */
            const speed = inserterThroughput({
                rotationSpeed: inserterData.rotation_speed,
                stackSize,
                sourceBeltSpeed: beltSpeedAt([0, -tiles]),
                destBeltSpeed: beltSpeedAt([0, tiles]),
            })

            this.m_entityInfo.text = `Speed: ${roundToTwo(
                speed
            )} items/s\n> depends on what sits at each end`
            this.m_entityInfo.position.set(10, nextY)
            nextY = this.m_entityInfo.position.y + this.m_entityInfo.height + 20
        }

        const beltData = entity.entityData
        if (isBelt(entity) && isTransportBeltConnectable(beltData)) {
            // Details for belts
            this.m_entityInfo.text = `Speed: ${roundToTwo(beltThroughput(beltData.speed))} items/s`
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
