/*
    Belt and inserter throughput, for the entity info panel.

    Lives here rather than in `UI/EntityInfoPanel.ts`, where it used to, because
    it is pure arithmetic over prototype numbers with no FD and no pixi in it -
    so it can be unit tested without a browser or the two dev servers, which is
    true of almost nothing else in `UI/`. See `throughput.test.ts`; before that
    file existed a wrong formula here looked exactly like a right one.

    `containerToContainer`, `containerToBelt` and `beltThroughput` are the
    panel's originals, moved rather than rewritten. `beltToContainer` and
    `inserterThroughput` are new (issue #96).

    A caveat that belongs on the whole file: these are the editor's own
    approximations, not figures read out of the game. `beltThroughput` is exact
    and checkable against Factorio's published 15/30/45/60, and the inserter ones
    are close but not tick-accurate - a fast inserter's real chest-to-chest rate
    is nearer 2.31/s than the 2.4 this gives, because the model counts swings and
    the game also spends ticks picking up and dropping. Treat them as guidance,
    which is what the panel presents them as.
*/

/** Belt item spacing, in tiles. Four items to a tile, per lane. */
const SIZE_OF_ITEM_ON_BELT = 0.25

/**
 * A belt's carrying rate in items/s, both lanes.
 *
 * The one exactly checkable function here: this reproduces Factorio's published
 * tier throughputs (15, 30, 45, 60) from `speed` alone.
 */
export const beltThroughput = (beltSpeed: number): number =>
    beltSpeed * 60 * (1 / SIZE_OF_ITEM_ON_BELT) * 2

/** An inserter swinging between two containers: swings per second times the stack. */
export const containerToContainer = (rotationSpeed: number, n: number): number =>
    rotationSpeed * 60 * n

/**
 * Items to ignore when charging belt-arrival time.
 *
 * The first item is placed instantly and in front, which also cuts the time to
 * put down the second by roughly 75%.
 */
const NR_OF_ITEMS_TO_IGNORE = 1.75

/**
 * An inserter unloading onto a belt: one arm swing, plus the time for belt space
 * to arrive under each item past the ignored head.
 */
export const containerToBelt = (rotationSpeed: number, beltSpeed: number, n: number): number => {
    const armTime = 1 / (rotationSpeed * 60)
    const itemTime = (1 / (beltSpeed * 60)) * SIZE_OF_ITEM_ON_BELT
    return n / (armTime + itemTime * Math.max(n - NR_OF_ITEMS_TO_IGNORE, 0))
}

/**
 * An inserter picking off a belt, which the panel used to report at the
 * container rate (issue #96).
 *
 * Two ceilings apply at once - how fast the inserter can swing, and how fast the
 * belt brings items under the hand - so the answer is the smaller. Deliberately
 * a bound rather than a curve: both limits are real and the true figure sits at
 * or below their minimum, but saying where exactly would mean measuring the
 * game, which has not been done. It is never worse than the container rate it
 * replaces, and strictly better whenever the inserter could out-pace the belt -
 * a bulk inserter wants 28.8 items/s and a yellow belt cannot give more than 15.
 */
export const beltToContainer = (rotationSpeed: number, beltSpeed: number, n: number): number =>
    Math.min(containerToContainer(rotationSpeed, n), beltThroughput(beltSpeed))

/**
 * What an inserter moves per second, given what sits at each end.
 *
 * A belt speed is `undefined` where that end is not a belt. The panel used to
 * look only at the destination, so picking off a belt was reported as though
 * both ends were containers.
 */
export function inserterThroughput(p: {
    rotationSpeed: number
    stackSize: number
    sourceBeltSpeed?: number
    destBeltSpeed?: number
}): number {
    const { rotationSpeed, stackSize, sourceBeltSpeed, destBeltSpeed } = p

    // The destination sets the base rate: placing onto a belt costs arrival time
    // per item, placing into a container does not.
    const base =
        destBeltSpeed === undefined
            ? containerToContainer(rotationSpeed, stackSize)
            : containerToBelt(rotationSpeed, destBeltSpeed, stackSize)

    // A belt at the source caps it again, whatever the destination was - nothing
    // can be taken off a belt faster than the belt delivers it.
    return sourceBeltSpeed === undefined ? base : Math.min(base, beltThroughput(sourceBeltSpeed))
}
