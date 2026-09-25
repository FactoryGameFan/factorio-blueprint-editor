/*
    The inventory bar (QuickbarPanel) and the shortcut bar sit side by side on
    the bottom edge, so both size themselves by one rule and come out the same
    height (#509). It is the game's rule: the same padding on every side, and a
    gap between slots but none after the last one. The inventory bar used to
    keep a gap after its last row and column, which made it 2 px taller and
    wider than its slots, and stepped its top edge 2 px above the shortcut bar.

    The numbers are the editor's own. The game's bars are 96 px, from 40 px
    slots that touch and 8 px padding; #513 covers matching those.
*/

/** Padding round a bar's slots, the same on every side. */
export const BAR_PADDING = 12

/** A slot's size. */
export const BAR_SLOT_SIZE = 36

/** A slot and the 2 px gap after it. */
export const BAR_SLOT_PITCH = 38

/** One side of a bar holding `slots` slots in a line. */
export function barLength(slots: number): number {
    return 2 * BAR_PADDING + slots * BAR_SLOT_PITCH - (BAR_SLOT_PITCH - BAR_SLOT_SIZE)
}

/**
 * The extra space between the inventory bar's two halves of five slots, which
 * the row-swap triangle sits in.
 */
export const QUICKBAR_MIDDLE_GAP = 38

/** The inventory bar's width: ten slots and the middle gap. */
export const QUICKBAR_WIDTH = barLength(10) + QUICKBAR_MIDDLE_GAP
