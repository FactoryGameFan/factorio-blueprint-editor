import type { Locator, Page } from '@playwright/test'
import { PLACEHOLDER as IMPORT_PLACEHOLDER } from '../../packages/editor/src/UI/ImportDialog'
import { PLACEHOLDER as EXPORT_PLACEHOLDER } from '../../packages/editor/src/UI/ExportDialog'

/*
    ImportDialog's and ExportDialog's TextInput both render as a plain
    <textarea> appended to document.body, styled identically - TextInput's
    constructor sets `position`/`background`/`border`/`outline`/
    `transformOrigin`/`lineHeight` inline on every instance, so a
    `document.querySelectorAll('textarea')` lookup filtered on
    `el.style.cssText !== ''` matches all of them equally and is not a filter
    at all (#242 review). That only mattered once nothing prevented both
    dialogs being open at the same time - with two textareas in the DOM, a
    `.find()` over that non-filter silently picks whichever the browser
    happens to list first, and a spec meaning one dialog asserts against the
    other's field instead.

    Each dialog's placeholder is the one thing that tells them apart, so
    these key on it directly through Playwright's own locator rather than a
    page.evaluate + querySelectorAll dance - a real CSS attribute selector,
    not a hand-rolled substitute for one. Imported from the source files
    rather than repeated as string literals here, the same reason
    ImportDialog's own layout constants are imported rather than copied.
*/

export function importTextarea(page: Page): Locator {
    return page.locator(`textarea[placeholder="${IMPORT_PLACEHOLDER}"]`)
}

export function exportTextarea(page: Page): Locator {
    return page.locator(`textarea[placeholder="${EXPORT_PLACEHOLDER}"]`)
}
