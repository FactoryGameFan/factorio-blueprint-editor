/*
    The inventory bar (QuickbarPanel) and the shortcut bar sit side by side on
    the bottom edge, so both size themselves by one rule and come out the same
    height (#509). It is the game's rule: the same padding on every side, and a
    gap between slots but none after the last one.

    The numbers are the game's, measured from a Factorio 2.0.77 screenshot at
    100% UI scale and matching `core/prototypes/style.lua` (#513): 40 px slots
    (`slot_button`, `size = 40`) that touch, and 8 px padding, so two rows make
    the 96 px of `quickbar_holder_flow`'s `minimal_height`. With the gaps below,
    the inventory bar comes to 468 px wide, `quick_bar_slot_window_frame`'s
    `minimal_width`, and the screenshot measures the same.
*/

/** Padding round a bar's slots, the same on every side. */
export const BAR_PADDING = 8

/** A slot's size. */
export const BAR_SLOT_SIZE = 40

/** A slot and the gap after it, which is none: the game's slots touch. */
export const BAR_SLOT_PITCH = 40

/** One side of a bar holding `slots` slots in a line. */
export function barLength(slots: number): number {
    return 2 * BAR_PADDING + slots * BAR_SLOT_PITCH - (BAR_SLOT_PITCH - BAR_SLOT_SIZE)
}

/*
    The gaps in the inventory bar, both from `core/prototypes/style.lua` and
    both measured in a Factorio 2.0.77 screenshot at 100% UI scale. The page
    buttons sit in the bar's frame, `quick_bar_slot_window_frame`, whose
    parent `slot_window_frame` spaces its children 8 px apart. The slots sit
    in `quick_bar_inner_panel`, which spaces its two halves of five 4 px apart.
*/

/** The space between the page buttons and the slots. */
export const QUICKBAR_PAGE_GAP = 8

/** The space between the two halves of five slots. */
export const QUICKBAR_HALVES_GAP = 4

/** Where the inventory bar's slots start: past the page buttons and the gap after them. */
export const QUICKBAR_PAGE_COLUMN = BAR_SLOT_SIZE + QUICKBAR_PAGE_GAP

/** Space added between the two halves, on top of the gap every slot already has after it. */
export const QUICKBAR_MIDDLE_GAP = QUICKBAR_HALVES_GAP - (BAR_SLOT_PITCH - BAR_SLOT_SIZE)

/** The inventory bar's width: the page buttons, ten slots and the gaps between them. */
export const QUICKBAR_WIDTH = QUICKBAR_PAGE_COLUMN + barLength(10) + QUICKBAR_MIDDLE_GAP
