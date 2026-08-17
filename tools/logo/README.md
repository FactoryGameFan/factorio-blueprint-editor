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

**Why the grid is 3x3.** The favicon is the smallest thing here and it decides the
mark. Rendered at 32 pixels, a 4x4 grid turns to mush and a 3x3 stays legible.
Every other size was comfortable either way, so the small one chose.

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

**Do not reintroduce upstream's artwork.** The project it grew out of asked forks
not to keep its logo, so people would not assume a shared maintainer. That is the
reason all of this exists - see
`docs/superpowers/specs/2026-08-05-hard-fork-design.md`.
