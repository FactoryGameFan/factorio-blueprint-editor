#!/usr/bin/env python3
"""Generate this project's identity assets.

Writes, relative to the repository root:

    .github/logo.svg                       README lockup, on its own dark plate
    packages/website/public/logo.svg       loading screen, transparent
    packages/website/public/logo-small.svg 140x80 corner panel, transparent
    packages/website/public/favicon.png    196x196, the mark alone

The mark is a belt turning a corner, feeding a placed entity.

Two things about it are measured rather than chosen, both at the sizes a favicon
actually renders at. The chevron count is **two**, one per straight run: three
stay distinct down to 32 pixels but merge into a dash at 16, and 16 is what some
browsers ask for. And the belt spans 20..84 rather than the 16..88 it was drawn
at, because the stroke is centred on the path - at 28 units wide, a run ending at
88 reaches 102 and is clipped by the 0..100 viewBox the favicon renders through.
Nothing here draws a guard box, so that clipping is invisible until you compare
the corner of the PNG against the SVG.

The earlier mark was a chamfered plate holding a 3x3 grid with one placed tile.
It was legible at 32 and said nothing: a blue rounded square with an orange dot
is every second icon in a tab strip. The belt is the departure - asymmetric, so
it has a findable silhouette, and specific, so a Factorio player reads it at a
glance.

The type is Titillium Web 400, which the site already serves under the SIL Open
Font License, outlined to paths here because an SVG loaded through an <img> tag
cannot use the page's fonts. Only the 400 weight is in the repo, so weight is
faked with a stroke in the same colour as the fill.

Needs `fonttools` for the outlining and `rsvg-convert` for the favicon:

    python3 -m venv .venv && .venv/bin/pip install fonttools
    brew install librsvg
    .venv/bin/python tools/logo/generate-logo.py
"""

import math
import pathlib
import shutil
import subprocess
import sys

from fontTools.misc.transform import Transform
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
FONT = ROOT / 'packages/website/public/fonts/titillium-web-v8-latin/400.woff'

# Every colour here is already on screen in packages/website/src/index.css.
CREAM = '#ffe6c0'
BLUE = '#27abdb'
DEEP = '#173347'
AMBER = '#db9215'
MUTED = '#8fa6b4'
BG = '#303030'

_font = TTFont(FONT)
_upem = _font['head'].unitsPerEm
_cmap = _font.getBestCmap()
_glyphs = _font.getGlyphSet()
_hmtx = _font['hmtx']


def text_path(s, size, tracking=0.0, x=0.0, y=0.0):
    """Outline `s`. Returns (path data, advance width). `y` is the baseline."""
    scale = size / _upem
    pen = SVGPathPen(_glyphs)
    cursor = 0.0
    for ch in s:
        gname = _cmap.get(ord(ch))
        if gname is None:
            cursor += 0.35 * _upem
            continue
        _glyphs[gname].draw(
            TransformPen(pen, Transform(scale, 0, 0, -scale, x + cursor * scale, y))
        )
        cursor += _hmtx[gname][0] + tracking * _upem
    return pen.getCommands(), cursor * scale


def chamfer(x, y, w, h, c):
    """Factorio's corner cut, used for the plate, the placed tile and the README backing."""
    return (
        f'M{x + c},{y} L{x + w - c},{y} L{x + w},{y + c} L{x + w},{y + h - c} '
        f'L{x + w - c},{y + h} L{x + c},{y + h} L{x},{y + h - c} L{x},{y + c} Z'
    )


# The belt. X0/Y0 is the corner, X1/Y1 the two open ends, BELT_W the full width.
# Keep X0 - BELT_W/2 >= 0 and X1 + BELT_W/2 <= 100 or the favicon clips - see the
# module docstring.
BELT_W = 28.0
X0 = Y0 = 20.0
X1 = Y1 = 84.0
CORNER_R = 22.0


def _chevron(cx, cy, rot, s, x, y, arm=11.0):
    """One direction arrow, pointing along the belt. `rot` is degrees clockwise."""
    a = math.radians(rot)
    ox, oy = x + cx * s, y + cy * s
    pts = ((-arm, arm * 0.66), (0.0, -arm * 0.44), (arm, arm * 0.66))
    return 'M' + ' L'.join(
        f'{ox + (px * math.cos(a) - py * math.sin(a)) * s:.2f},'
        f'{oy + (px * math.sin(a) + py * math.cos(a)) * s:.2f}'
        for px, py in pts
    )


def mark(size=100.0, x=0.0, y=0.0):
    s = size / 100.0
    belt = (
        f'M{x + X0 * s:.2f},{y + Y1 * s:.2f} L{x + X0 * s:.2f},{y + (Y0 + CORNER_R) * s:.2f} '
        f'Q{x + X0 * s:.2f},{y + Y0 * s:.2f} {x + (X0 + CORNER_R) * s:.2f},{y + Y0 * s:.2f} '
        f'L{x + X1 * s:.2f},{y + Y0 * s:.2f}'
    )
    chevrons = ' '.join(
        (
            _chevron(X0, 60.0, 0, s, x, y),
            _chevron(58.0, Y0, 90, s, x, y),
        )
    )
    tile = chamfer(x + 50 * s, y + 50 * s, 40 * s, 40 * s, 8 * s)
    caps = 'stroke-linecap="round" stroke-linejoin="round"'
    return (
        f'<path d="{belt}" fill="none" stroke="{DEEP}" stroke-width="{BELT_W * s:.2f}" {caps}/>'
        f'<path d="{belt}" fill="none" stroke="{BLUE}" stroke-width="{BELT_W * s:.2f}" {caps} '
        f'opacity=".26"/>'
        f'<path d="{belt}" fill="none" stroke="{BLUE}" '
        f'stroke-width="{BELT_W * 0.16 * s:.2f}" {caps}/>'
        f'<path d="{chevrons}" fill="none" stroke="{AMBER}" '
        f'stroke-width="{BELT_W * 0.19 * s:.2f}" {caps}/>'
        f'<path d="{tile}" fill="{AMBER}"/>'
        f'<path d="{tile}" fill="none" stroke="{DEEP}" stroke-width="{4 * s:.2f}"/>'
    )


def weighted(s, size, tracking, x, y, fill, weight):
    d, w = text_path(s, size, tracking, x, y)
    return (
        f'<path d="{d}" fill="{fill}" stroke="{fill}" stroke-width="{weight}" '
        f'stroke-linejoin="round"/>',
        w,
    )


def lockup(bg=None, pad=0.0, mark_size=100.0, gap=30.0):
    tx = pad + mark_size + gap
    eyebrow, ew = weighted('FACTORIO', 26.0, 0.22, tx, pad + 34, MUTED, 1.05)
    title, tw = weighted('BLUEPRINT EDITOR', 46.0, 0.02, tx, pad + 88, CREAM, 1.5)
    w = tx + max(ew, tw) + pad
    h = mark_size + 2 * pad
    back = f'<path d="{chamfer(0, 0, w, h, 14)}" fill="{bg}"/>' if bg else ''
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}">'
        f'{back}{mark(mark_size, pad, pad)}{eyebrow}{title}</svg>'
    )


def small_lockup():
    """Three stacked lines, because one line runs off a 140px panel.

    Keeps the 154x60 viewBox the file it replaces had, so the corner panel lays
    out exactly as before.
    """
    W, H = 154.0, 60.0
    m = 52.0
    tx = m + 11
    avail = W - tx - 1

    def fitted(s, size, tracking, y, fill, weight):
        _, w = text_path(s, size, tracking)
        d, _ = text_path(s, size * min(1.0, avail / w), tracking)
        return (
            f'<g transform="translate({tx:.2f},{y})">'
            f'<path d="{d}" fill="{fill}" stroke="{fill}" stroke-width="{weight}" '
            f'stroke-linejoin="round"/></g>'
        )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">'
        f'{mark(m, 0, (H - m) / 2)}'
        f'{fitted("FACTORIO", 12.0, 0.26, 18, MUTED, 0.7)}'
        f'{fitted("BLUEPRINT", 19.0, 0.02, 38, CREAM, 1.0)}'
        f'{fitted("EDITOR", 19.0, 0.02, 56, CREAM, 1.0)}</svg>'
    )


def main():
    targets = {
        ROOT / '.github/logo.svg': lockup(bg=BG, pad=26.0),
        ROOT / 'packages/website/public/logo.svg': lockup(),
        ROOT / 'packages/website/public/logo-small.svg': small_lockup(),
    }
    for path, svg in targets.items():
        path.write_text(svg)
        print(f'wrote {path.relative_to(ROOT)}')

    mark_only = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">{mark()}</svg>'
    favicon = ROOT / 'packages/website/public/favicon.png'
    if shutil.which('rsvg-convert') is None:
        print('rsvg-convert not found - favicon.png not regenerated', file=sys.stderr)
        return 1
    subprocess.run(
        ['rsvg-convert', '-w', '196', '-h', '196', '-o', str(favicon)],
        input=mark_only.encode(),
        check=True,
    )
    print(f'wrote {favicon.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
