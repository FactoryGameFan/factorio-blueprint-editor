# Logo

`generate-logo.py` writes the four identity assets. They are **generated, not
hand-edited** - regenerate and commit the output instead of touching an SVG,
because the wordmark is machine-outlined from a font and its path data is not
something anyone can sensibly edit by hand.

```fish
python3 -m venv /tmp/logo-venv
/tmp/logo-venv/bin/pip install fonttools
brew install librsvg  # for rsvg-convert, which rasterizes the favicon
/tmp/logo-venv/bin/python tools/logo/generate-logo.py
```

## What it makes and where each one is seen

| File                                     | Where                                              |
| ---------------------------------------- | -------------------------------------------------- |
| `.github/logo.svg`                       | The README, at the top                             |
| `packages/website/public/logo.svg`       | The loading screen, drawn at 50% of viewport width |
| `packages/website/public/logo-small.svg` | The corner panel, a 140x80 box                     |
| `packages/website/public/favicon.png`    | The browser tab, 196x196                           |

## Things worth knowing before changing it

**Why the type is outlined.** An SVG loaded through an `<img>` tag cannot reach
the page's fonts, so a `font-family` reference would render in whatever the
browser picked. The paths come from
`packages/website/public/fonts/titillium-web-v8-latin/400.woff`, the font the site
already serves, under the SIL Open Font License. Only the 400 weight is in the
repo, so the bolder weight is faked with a stroke in the fill colour.

**Why the mark is a belt and not a grid.** The first version was a chamfered plate
holding a 3x3 grid with one placed tile, and it was legible at every size and
said nothing: at 32 pixels the grid lines collapse and what is left is a blue
rounded square with an orange dot, which describes half the icons in a tab strip.
The belt is asymmetric, so it has a silhouette you can find, and it is specific,
so a Factorio player reads it without being told.

**Why two chevrons and not three.** The favicon is the smallest thing here and it
decides the mark. Three chevrons stay distinct down to 32 pixels and merge into a
dash at 16, which is a size browsers still ask for; two survive both. Every
larger size was comfortable either way, so the small one chose. That is the same
rule the old 3x3 grid was picked under, applied to a different detail.

**Why the belt stops short of the box.** An SVG stroke is centred on its path, so
a run ending at 88 with a 28-unit stroke reaches 102 and is clipped by the
`0 0 100 100` viewBox the favicon renders through. The ends sit at 84 and the
corner at 20, which keeps the whole mark inside 6..98. Nothing draws a guard box,
so this kind of clipping does not announce itself - it looks like a design
choice. If you change `BELT_W`, re-check both ends.

**Why the README copy has a background and the others do not.** GitHub renders the
README on white in light mode, and the wordmark is cream. The `.github/logo.svg`
copy therefore carries its own `#303030` plate. The site's own copies sit on a
`#303030` page already, so they stay transparent.

**Why `logo-small.svg` keeps a 154x60 viewBox.** That is the shape of the file it
replaced. The corner panel has no CSS sizing the image, so the aspect ratio is
what lays it out, and keeping it means the panel does not move.

**Nothing under `tests/` reads any of these.** A missing or broken asset is green
across the whole suite and only shows on screen. Look at the loading screen, the
corner panel and the browser tab after regenerating.

**A fifth file changes with the mark, and this script does not write it.**
`.github/preview.png` is a screenshot of the running editor, and the corner panel
is in the frame, so every mark change leaves it showing the previous one. The
README then puts the new logo directly above a screenshot of the old one, which
is the exact inconsistency the identity work existed to remove. Reshoot it: start
the dev servers, load a large blueprint, remove `.toasts-container`, and capture
at 1738x1243, which is what the committed file is. `test-blueprints/JEPAKAZOL/gleba-base-mall-all.txt`
is the one in it today.

**Do not reintroduce upstream's artwork.** The project it grew out of asked forks
not to keep its logo, so people would not assume a shared maintainer (upstream
issue #276). That is the reason all of this exists - the identity work landed in
PR #237, and the hard-fork design discussion is PR #192.
