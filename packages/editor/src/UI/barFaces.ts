import { Graphics } from 'pixi.js'

/*
    How the inventory bar and the shortcut bar are drawn, pixel row by pixel
    row, as Factorio 2.0.77 draws them (#521). Every colour here was read off a
    screenshot of the game's own GUI at 100% UI scale, taken in game with
    `take_screenshot{show_gui = true}`. The canvas has antialiasing off, so
    each edge is drawn as whole 1 px rows and columns rather than a stroke.

    Edge colours are listed from the outside in.
*/

/** `quick_bar_slot_window_frame`, and the shortcut bar's frame beside it. */
const FRAME = {
    fill: 0x313131,
    top: [0x605e5d, 0x454342],
    bottom: [0x000000, 0x1a1817],
    left: [0x251e1c, 0x2e2928],
    right: [0x1d1816, 0x282423],
}

/** `quick_bar_inner_panel`, the sunken panel the slots and the page buttons sit in. */
const PANEL = {
    fill: 0x251d1a,
    above: [0x191615, 0x000000],
    below: [0x474241, 0x605d5b],
    left: [0x2c2726, 0x272321],
    right: [0x2c2725, 0x231b18],
}

/** `slot_button`: dark, lit along the top, with rounded corners. */
const SLOT = {
    face: 0x313131,
    top: [0x494848, 0x393939, 0x2f2f2f],
    bottom: [0x111111, 0x202020, 0x2f2f2f],
    sides: [0x222222, 0x2b2b2b, 0x2f2f2f],
}

/**
 * `quick_bar_page_button` and the shortcut bar's `slot_sized_button`: the
 * game's grey button, raised. The face is the one `ShortcutBar` has always
 * used, read off `__core__/graphics/gui-new.png`; the game's icons are dark
 * ink made for it, at 5.0:1 where the editor's usual 0x646464 slot gave 2.85:1.
 */
const RAISED = {
    face: 0x8c8c8c,
    top: [0xc0c0c0, 0x9f9f9f, 0x888888],
    bottom: [0x121212, 0x505050, 0x888888],
    left: [0x646464, 0x7d7d7d, 0x888888],
    right: [0x656565, 0x7d7d7d, 0x888888],
}

/** Both faces leave a 1 px margin inside their 40 px, where the panel shows. */
const MARGIN = 1

/** A sunken panel round a block of slots, as its x, y, width and height. */
export interface PanelBox {
    x: number
    y: number
    width: number
    height: number
}

/**
 * A bar's frame, with a sunken panel round each box. The panels' edges sit in
 * the frame's 8 px padding: 2 px of frame edge, 4 px of fill, then 2 px of
 * panel edge, which is how the game's padding breaks down.
 */
export function drawBarFrame(width: number, height: number, panels: PanelBox[]): Graphics {
    const g = new Graphics().rect(0, 0, width, height).fill(FRAME.fill)
    FRAME.left.forEach((c, i) => g.rect(i, 0, 1, height).fill(c))
    FRAME.right.forEach((c, i) => g.rect(width - 1 - i, 0, 1, height).fill(c))
    FRAME.top.forEach((c, i) => g.rect(0, i, width, 1).fill(c))
    FRAME.bottom.forEach((c, i) => g.rect(0, height - 1 - i, width, 1).fill(c))

    for (const { x, y, width: w, height: h } of panels) {
        g.rect(x, y, w, h).fill(PANEL.fill)
        PANEL.left.forEach((c, i) => g.rect(x - 2 + i, y, 1, h).fill(c))
        PANEL.right.forEach((c, i) => g.rect(x + w + 1 - i, y, 1, h).fill(c))
        PANEL.above.forEach((c, i) => g.rect(x - 2, y - 2 + i, w + 4, 1).fill(c))
        PANEL.below.forEach((c, i) => g.rect(x - 2, y + h + 1 - i, w + 4, 1).fill(c))
    }
    return g
}

/**
 * A bar slot's face. Its three outer rows and columns shade towards the
 * edge, and the rows stop short of the corner, which rounds it by about 2 px.
 */
export function drawSlotFace(size: number): Graphics {
    const a = MARGIN
    const b = size - MARGIN
    const g = new Graphics().rect(a + 1, a + 1, b - a - 2, b - a - 2).fill(SLOT.face)
    SLOT.sides.forEach((c, i) => {
        g.rect(a + i, a + 2, 1, b - a - 4).fill(c)
        g.rect(b - 1 - i, a + 2, 1, b - a - 4).fill(c)
    })
    // Inset by two, one and one from each end, which is what cuts the corners.
    const inset = [2, 1, 1]
    SLOT.top.forEach((c, i) => g.rect(a + inset[i], a + i, b - a - 2 * inset[i], 1).fill(c))
    SLOT.bottom.forEach((c, i) => g.rect(a + inset[i], b - 1 - i, b - a - 2 * inset[i], 1).fill(c))
    return g
}

/** A raised grey button's face, with square corners. */
export function drawRaisedFace(size: number): Graphics {
    const a = MARGIN
    const b = size - MARGIN
    const g = new Graphics().rect(a, a, b - a, b - a).fill(RAISED.face)
    RAISED.left.forEach((c, i) => g.rect(a + i, a, 1, b - a).fill(c))
    RAISED.right.forEach((c, i) => g.rect(b - 1 - i, a, 1, b - a).fill(c))
    RAISED.top.forEach((c, i) => g.rect(a, a + i, b - a, 1).fill(c))
    RAISED.bottom.forEach((c, i) => g.rect(a, b - 1 - i, b - a, 1).fill(c))
    return g
}
