import { expect, it } from 'vite-plus/test'
import { FRAME, FRAME_FILL, PANEL } from './barFaces'
import { BAR_PADDING } from './barLayout'

/*
    drawBarFrame draws the frame's edges inward from the bar's outside and the
    panels' edges outward from boxes placed BAR_PADDING in. Nothing else ties
    the two together, so a change to either edge list or to the padding would
    leave a strip of the wrong colour or draw one edge over the other.
*/
it('fits the frame edge, its fill and the panel edge in BAR_PADDING on every side', () => {
    const sides = [
        [FRAME.left, PANEL.left],
        [FRAME.right, PANEL.right],
        [FRAME.top, PANEL.above],
        [FRAME.bottom, PANEL.below],
    ]
    for (const [frame, panel] of sides) {
        expect(frame.length + FRAME_FILL + panel.length).toBe(BAR_PADDING)
    }
})
