import { Application, Texture, Assets, Renderer } from 'pixi.js'
import { Blueprint } from '../core/Blueprint'
import { UIContainer } from '../UI/UIContainer'
import { BlueprintContainer } from '../containers/BlueprintContainer'
import { ActionRegistry } from '../actions'

const debug = false

export interface ILogMessage {
    text: string
    type: 'success' | 'info' | 'warning' | 'error'
}

export type Logger = (msg: ILogMessage) => void

const logger: Logger = msg => {
    switch (msg.type) {
        case 'error':
            console.error(msg.text)
            break
        case 'warning':
            console.warn(msg.text)
            break
        case 'info':
            console.info(msg.text)
            break
        case 'success':
            console.log(msg.text)
            break
    }
}

/**
 * The globals Editor.init assigns on its way up, before anything reads them.
 *
 * These five used to be `let` declarations with no initialiser, there only to
 * give the exported object its property types - the values were always assigned
 * to the object's properties (`G.BPC = ...`), never to the variables, which
 * stayed undefined for the life of the module. So the object literal captured
 * five undefineds and each of them was a "used before being assigned" error,
 * held off with an oxlint-disable that had to explain the same thing in prose.
 *
 * Declaring the shape says it once, in the type, and lets the object literal
 * carry only what genuinely has a value at module scope.
 */
interface Globals {
    debug: boolean
    app: Application<Renderer<HTMLCanvasElement>>
    BPC: BlueprintContainer
    UI: UIContainer
    bp: Blueprint
    actions: ActionRegistry
    getTexture: typeof getTexture
    logger: Logger
}

const started = new Map<string, Promise<Texture>>()
const textureCache = new Map<string, Texture>()

let count = 0
let T: number

function getBT(path: string): Promise<Texture> {
    if (count === 0) {
        T = performance.now()
    }
    count += 1
    return Assets.load(path).then(bt => {
        count -= 1
        if (count <= 0) {
            console.log('done', performance.now() - T)
        }
        return bt
    })
}

function getTexture(path: string, x = 0, y = 0, w = 0, h = 0): Texture {
    const key = `/data/${path.replace('.png', '.basis')}`
    const KK = `${key}-${x}-${y}-${w}-${h}`
    let t = textureCache.get(KK)
    if (t) return t
    t = new Texture({ source: Texture.EMPTY.source, dynamic: true })
    t.noFrame = false
    textureCache.set(KK, t)
    let prom = started.get(key)
    if (!prom) {
        prom = getBT(key)
        started.set(key, prom)
    }
    prom.then(
        bt => {
            t.source = bt.source
            t.frame.x = x
            t.frame.y = y
            t.frame.width = w || bt.width
            t.frame.height = h || bt.height
            t.update()
            t.dynamic = false
        },
        err => console.error(err)
    )
    return t
}

// The cast is the whole of the "assigned by Editor.init" protocol, in one place
// rather than spread across five declarations.
export default {
    debug,
    getTexture,
    logger,
} as Globals
