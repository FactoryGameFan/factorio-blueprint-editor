import { Entity } from '../../core/Entity'
import { Editor } from './Editor'
import { Modules } from './components/Modules'

export class TempEditor extends Editor {
    public constructor(entity: Entity) {
        /*
            A furnace picks its recipe from what it is fed, so it has no recipe
            to set - which matters for the recycler, whose 311 accepted recipes
            are every item's recycling. The rocket silo's one is fixed.
        */
        const hasRecipe =
            entity.acceptedRecipes.length > 0 &&
            !(entity.type === 'furnace' || entity.name === 'rocket-silo')
        const recipeHeight = hasRecipe ? 38 : 0
        const moduleRows = Math.ceil(entity.moduleSlots / Modules.COLUMNS)

        super(402, Math.max(171, 45 + recipeHeight + moduleRows * 38 + 12), entity)

        if (hasRecipe) {
            this.addLabel(140, 56, 'Recipe:')
            this.addRecipe(208, 45)
        }

        if (entity.moduleSlots !== 0) {
            this.addLabel(140, 56 + recipeHeight, 'Modules:')
            this.addModules(208, 45 + recipeHeight)
        }
    }
}
