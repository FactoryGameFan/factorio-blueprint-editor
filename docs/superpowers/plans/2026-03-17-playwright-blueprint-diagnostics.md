# Playwright Blueprint Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up Playwright tests that load each blueprint from `wormeyman-tests/` against the running dev server, capture all console warnings/errors, and generate structured reports to drive code fixes.

**Architecture:** Playwright navigates to `localhost:8080`, then uses `page.evaluate()` to inject the blueprint string directly into the app's loading functions - avoiding URL length limits and encoding issues with large base64 strings (up to 2.4MB). Console messages are captured during load, and results are written to JSON and markdown reports in `diagnostic-reports/`. The dev servers (Vite on 8080, static files on 8081) must be started manually before running tests.

**Tech Stack:** Playwright Test, TypeScript, Node.js `fs` for report generation

---

## File Structure

| File                                | Responsibility                                                     |
| ----------------------------------- | ------------------------------------------------------------------ |
| `playwright.config.ts`              | Playwright config - base URL, timeouts, no auto-server             |
| `tests/blueprint-loading.spec.ts`   | Main test file - iterates blueprint files, captures console output |
| `tests/helpers/report-generator.ts` | Generates JSON + markdown reports from collected diagnostics       |
| `tests/helpers/blueprint-files.ts`  | Discovers and reads blueprint `.txt` files from `wormeyman-tests/` |

---

### Task 1: Install Playwright and Create Config

**Files:**

- Create: `playwright.config.ts`
- Modify: `package.json` (devDependencies, scripts)
- Modify: `.gitignore`

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create playwright.config.ts**

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: './tests',
    timeout: 120_000,
    expect: {
        timeout: 60_000,
    },
    use: {
        baseURL: 'http://localhost:8080',
        headless: true,
    },
    retries: 0,
    workers: 1,
    reporter: [['list']],
})
```

Note: `workers: 1` because all tests share the same dev server and large blueprints need memory. `timeout: 120_000` because some blueprints are 2.4MB and take time to decode/render.

- [ ] **Step 3: Add test script to root package.json**

Add to the `"scripts"` section:

```json
"test": "npx playwright test",
"test:report": "npx playwright test --reporter=list"
```

- [ ] **Step 4: Add Playwright and diagnostic artifacts to .gitignore**

Append to `.gitignore`:

```
diagnostic-reports/
playwright-report/
```

Note: `test-results/` is Playwright's default artifact directory; our custom reports go to `diagnostic-reports/` to avoid conflicts.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts package.json .gitignore
git commit -m "chore: add Playwright config for blueprint diagnostics"
```

---

### Task 2: Create Blueprint File Discovery Helper

**Files:**

- Create: `tests/helpers/blueprint-files.ts`

- [ ] **Step 1: Create the helper**

Uses `process.cwd()` (Playwright runs from project root) instead of `__dirname` to avoid ESM compatibility issues.

```typescript
import * as fs from 'fs'
import * as path from 'path'

export interface BlueprintFile {
    /** Display name, e.g. "EARN/quick-start-v22-0-11" */
    name: string
    /** Absolute path to the .txt file */
    filePath: string
    /** Collection folder name, e.g. "EARN" */
    collection: string
}

const TESTS_DIR = path.resolve(process.cwd(), 'wormeyman-tests')

export function discoverBlueprintFiles(): BlueprintFile[] {
    const files: BlueprintFile[] = []

    if (!fs.existsSync(TESTS_DIR)) {
        return files
    }

    const collections = fs
        .readdirSync(TESTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())

    for (const collection of collections) {
        const collectionPath = path.join(TESTS_DIR, collection.name)
        const txtFiles = fs.readdirSync(collectionPath).filter(f => f.endsWith('.txt'))

        for (const txtFile of txtFiles) {
            const baseName = txtFile.replace(/\.txt$/, '')
            files.push({
                name: `${collection.name}/${baseName}`,
                filePath: path.join(collectionPath, txtFile),
                collection: collection.name,
            })
        }
    }

    return files
}

export function readBlueprintString(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8').trim()
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/helpers/blueprint-files.ts
git commit -m "feat: add blueprint file discovery helper"
```

---

### Task 3: Create Report Generator

**Files:**

- Create: `tests/helpers/report-generator.ts`

- [ ] **Step 1: Create the report generator**

Reports go to `diagnostic-reports/` (not `test-results/` which Playwright uses for its own artifacts).

```typescript
import * as fs from 'fs'
import * as path from 'path'

export interface BlueprintDiagnostic {
    name: string
    collection: string
    filePath: string
    consoleWarnings: string[]
    consoleErrors: string[]
    jsErrors: string[]
    loadTimeMs: number | null
    success: boolean
}

export interface DiagnosticReport {
    timestamp: string
    totalBlueprints: number
    totalWarnings: number
    totalErrors: number
    blueprints: BlueprintDiagnostic[]
}

const RESULTS_DIR = path.resolve(process.cwd(), 'diagnostic-reports')

export function generateReport(diagnostics: BlueprintDiagnostic[]): void {
    fs.mkdirSync(RESULTS_DIR, { recursive: true })

    const report: DiagnosticReport = {
        timestamp: new Date().toISOString(),
        totalBlueprints: diagnostics.length,
        totalWarnings: diagnostics.reduce((sum, d) => sum + d.consoleWarnings.length, 0),
        totalErrors: diagnostics.reduce(
            (sum, d) => sum + d.consoleErrors.length + d.jsErrors.length,
            0
        ),
        blueprints: diagnostics,
    }

    // Write JSON report
    const jsonPath = path.join(RESULTS_DIR, 'blueprint-diagnostics.json')
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))

    // Write markdown report
    const mdPath = path.join(RESULTS_DIR, 'blueprint-diagnostics.md')
    fs.writeFileSync(mdPath, generateMarkdown(report))

    console.log(`\nReports written to:`)
    console.log(`  JSON: ${jsonPath}`)
    console.log(`  Markdown: ${mdPath}`)
}

function generateMarkdown(report: DiagnosticReport): string {
    const lines: string[] = [
        '# Blueprint Diagnostics Report',
        '',
        `**Date:** ${report.timestamp}`,
        `**Blueprints tested:** ${report.totalBlueprints}`,
        `**Total warnings:** ${report.totalWarnings}`,
        `**Total errors:** ${report.totalErrors}`,
        '',
    ]

    // Summary table
    lines.push('## Summary', '', '| Blueprint | Warnings | Errors | Status |', '|---|---|---|---|')
    for (const bp of report.blueprints) {
        const errorCount = bp.consoleErrors.length + bp.jsErrors.length
        const status = bp.success
            ? errorCount > 0
                ? 'Loaded with errors'
                : bp.consoleWarnings.length > 0
                  ? 'Loaded with warnings'
                  : 'Clean'
            : 'FAILED'
        lines.push(`| ${bp.name} | ${bp.consoleWarnings.length} | ${errorCount} | ${status} |`)
    }
    lines.push('')

    // Detailed per-blueprint sections
    for (const bp of report.blueprints) {
        const hasIssues =
            bp.consoleWarnings.length > 0 || bp.consoleErrors.length > 0 || bp.jsErrors.length > 0
        if (!hasIssues) continue

        lines.push(`## ${bp.name}`, '')
        if (bp.loadTimeMs !== null) {
            lines.push(`Load time: ${bp.loadTimeMs}ms`, '')
        }

        if (bp.consoleWarnings.length > 0) {
            lines.push('### Warnings', '')
            for (const w of bp.consoleWarnings) {
                lines.push(`- ${w}`)
            }
            lines.push('')
        }

        if (bp.consoleErrors.length > 0) {
            lines.push('### Console Errors', '')
            for (const e of bp.consoleErrors) {
                lines.push(`- ${e}`)
            }
            lines.push('')
        }

        if (bp.jsErrors.length > 0) {
            lines.push('### JavaScript Errors', '')
            for (const e of bp.jsErrors) {
                lines.push(`- ${e}`)
            }
            lines.push('')
        }
    }

    // Aggregate warning types
    const warningCounts = new Map<string, number>()
    for (const bp of report.blueprints) {
        for (const w of bp.consoleWarnings) {
            const normalized = w
                .replace(/Skipped \d+ unknown entit(y|ies): .*/, 'Skipped unknown entities')
                .replace(/Blueprint validation warnings.*/, 'Blueprint validation warnings')
            warningCounts.set(normalized, (warningCounts.get(normalized) || 0) + 1)
        }
    }

    if (warningCounts.size > 0) {
        lines.push('## Warning Frequency', '', '| Warning Pattern | Count |', '|---|---|')
        const sorted = [...warningCounts.entries()].sort((a, b) => b[1] - a[1])
        for (const [pattern, count] of sorted) {
            lines.push(`| ${pattern} | ${count} |`)
        }
        lines.push('')
    }

    return lines.join('\n')
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/helpers/report-generator.ts
git commit -m "feat: add diagnostic report generator (JSON + markdown)"
```

---

### Task 4: Create Main Blueprint Loading Test

**Files:**

- Create: `tests/blueprint-loading.spec.ts`

The critical design choice: instead of passing blueprint strings via URL `?source=` param (which breaks due to URL length limits, base64 `=` padding issues, and the app's naive `split('=')[1]` parsing), we:

1. Navigate to the bare page and wait for the editor to initialize
2. Use `page.evaluate()` to call the app's `getBlueprintOrBookFromSource()` directly

However, `getBlueprintOrBookFromSource` and `loadBp` are not exported to `window`. So we use a simpler approach: simulate a clipboard paste by writing to clipboard and dispatching a paste event on the focused canvas.

- [ ] **Step 1: Create the test file**

```typescript
import { test } from '@playwright/test'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'
import { BlueprintDiagnostic, generateReport } from './helpers/report-generator'

const blueprintFiles = discoverBlueprintFiles()
const allDiagnostics: BlueprintDiagnostic[] = []

for (const bp of blueprintFiles) {
    test(`load blueprint: ${bp.name}`, async ({ page, context }) => {
        const warnings: string[] = []
        const errors: string[] = []
        const jsErrors: string[] = []
        let loadTimeMs: number | null = null

        // Grant clipboard permissions for paste simulation
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])

        // Listen for console messages
        page.on('console', msg => {
            const text = msg.text()
            if (msg.type() === 'warning') {
                warnings.push(text)
                console.log(`  WARN: ${text}`)
            } else if (msg.type() === 'error') {
                errors.push(text)
                console.log(`  ERROR: ${text}`)
            }
        })

        // Listen for uncaught JS errors
        page.on('pageerror', error => {
            jsErrors.push(error.message)
            console.log(`  JS ERROR: ${error.message}`)
        })

        // Read the blueprint string from file
        const bpString = readBlueprintString(bp.filePath)
        console.log(`\nLoading: ${bp.name} (${(bpString.length / 1024).toFixed(0)} KB)`)

        // Navigate to the bare editor page
        await page.goto('/', { waitUntil: 'domcontentloaded' })

        // Wait for the editor to fully initialize (loading screen goes away on empty blueprint)
        await page.waitForFunction(
            () => {
                const el = document.getElementById('loadingScreen')
                return el && !el.classList.contains('active')
            },
            { timeout: 30_000 }
        )

        // Focus the canvas (required for paste handler)
        await page.click('#editor')

        // Write blueprint string to clipboard and trigger paste
        const startTime = Date.now()
        await page.evaluate(async bpStr => {
            await navigator.clipboard.writeText(bpStr)
        }, bpString)

        // Dispatch paste via keyboard shortcut (Ctrl+V)
        await page.keyboard.down('Control')
        await page.keyboard.press('v')
        await page.keyboard.up('Control')

        // Wait for loading screen to appear then disappear (or detect error state)
        try {
            // First wait for loading to start
            await page
                .waitForFunction(
                    () => {
                        const el = document.getElementById('loadingScreen')
                        return el && el.classList.contains('active')
                    },
                    { timeout: 5_000 }
                )
                .catch(() => {
                    // Loading may have already started and finished for small blueprints
                })

            // Then wait for loading to complete or error
            await page.waitForFunction(
                () => {
                    const el = document.getElementById('loadingScreen')
                    return (
                        el && (!el.classList.contains('active') || el.classList.contains('error'))
                    )
                },
                { timeout: 90_000 }
            )
            loadTimeMs = Date.now() - startTime
            console.log(`  Loaded in ${loadTimeMs}ms`)
        } catch {
            loadTimeMs = Date.now() - startTime
            console.log(`  TIMEOUT after ${loadTimeMs}ms - loading screen still active`)
        }

        // Wait for toasts and async warnings to appear
        await page.waitForTimeout(2000)

        // Collect toast messages from the DOM
        const toastTexts = await page.$$eval('.toasts-toast .toasts-text', els =>
            els.map(el => ({
                text: el.textContent || '',
                isWarning:
                    el.closest('.toasts-toast')?.classList.contains('toasts-warning') || false,
                isError: el.closest('.toasts-toast')?.classList.contains('toasts-error') || false,
            }))
        )

        for (const toast of toastTexts) {
            if (toast.isError && !errors.includes(toast.text)) {
                errors.push(`[toast] ${toast.text}`)
            }
            if (toast.isWarning && !warnings.includes(toast.text)) {
                warnings.push(`[toast] ${toast.text}`)
            }
        }

        const diagnostic: BlueprintDiagnostic = {
            name: bp.name,
            collection: bp.collection,
            filePath: bp.filePath,
            consoleWarnings: warnings,
            consoleErrors: errors,
            jsErrors: jsErrors,
            loadTimeMs,
            success: jsErrors.length === 0,
        }

        allDiagnostics.push(diagnostic)

        // Log summary for this blueprint
        const total = warnings.length + errors.length + jsErrors.length
        if (total > 0) {
            console.log(
                `  Issues: ${warnings.length} warnings, ${errors.length} errors, ${jsErrors.length} JS errors`
            )
        } else {
            console.log(`  Clean - no issues`)
        }
    })
}

// After all tests, generate the report
test.afterAll(async () => {
    if (allDiagnostics.length > 0) {
        generateReport(allDiagnostics)
    }
})
```

- [ ] **Step 2: Verify tests discover blueprint files**

Run with `--list` to confirm test discovery:

```bash
npx playwright test --list
```

Expected: Should list 10 tests (4 from EARN, 6 from AVADII - NILAUS dir is empty).

- [ ] **Step 3: Commit**

```bash
git add tests/blueprint-loading.spec.ts
git commit -m "feat: add Playwright blueprint loading tests with diagnostic capture"
```

---

### Task 5: Run Tests and Verify Report Generation

**Prerequisites:** Dev servers running manually:

- Terminal 1: `cd packages/website && npm run start` (Vite on port 8080)
- Terminal 2: `npx serve packages/exporter/data/output -l 8081 --cors` (sprite data)

- [ ] **Step 1: Run the tests**

```bash
npx playwright test
```

Expected: All 10 blueprint files are loaded. Tests may show warnings/errors in console output. A `diagnostic-reports/` directory is created with `blueprint-diagnostics.json` and `blueprint-diagnostics.md`.

- [ ] **Step 2: Review the markdown report**

```bash
cat diagnostic-reports/blueprint-diagnostics.md
```

Verify:

- Summary table lists all 10 blueprints
- Warning/error details are captured per blueprint
- Warning frequency table shows aggregated patterns

- [ ] **Step 3: Review the JSON report**

```bash
cat diagnostic-reports/blueprint-diagnostics.json | head -50
```

Verify JSON structure matches the `DiagnosticReport` interface.

- [ ] **Step 4: Iterate on test issues if needed**

If tests fail due to timing, clipboard, or selector issues - debug and fix. Common issues:

- Clipboard permissions not granted: check `context.grantPermissions` call
- Canvas not focused: ensure `page.click('#editor')` works
- Paste not detected: the app's paste handler checks `document.activeElement !== CANVAS`

---

### Task 6: Fix Warnings and Errors (Iterative)

This task is iterative - repeat for each category of issue found in the report.

**Files:**

- Modify: `packages/editor/src/core/spriteDataBuilder.ts` (missing entity types)
- Modify: `packages/editor/src/core/bpString.ts` (validation issues)
- Modify: `packages/editor/src/core/blueprintSchema.json` (schema gaps)
- Other files as indicated by specific errors

- [ ] **Step 1: Categorize issues from the report**

Read `diagnostic-reports/blueprint-diagnostics.md` and group issues by type:

1. **Unknown entities stripped** - entities that need `draw_*` functions in `spriteDataBuilder.ts`
2. **Validation warnings** - schema gaps in `blueprintSchema.json`
3. **JS errors** - code crashes that need fixing
4. **Console errors** - rendering or data issues

- [ ] **Step 2: For each category, fix the underlying code**

For unknown entities:

- Check if the entity exists in `data.json` (FD.entities)
- If it exists but has no rendering: add a `draw_*` function in `spriteDataBuilder.ts`
- If it doesn't exist in data.json: this is an exporter issue, note it

For validation warnings:

- Update `blueprintSchema.json` to accept new Space Age values
- Add missing signal types, entity types, etc.

For JS errors:

- Debug the crash, add defensive handling or proper support

- [ ] **Step 3: Re-run tests after each fix**

```bash
npx playwright test
```

Compare the new report with the previous one - verify the fix reduced warnings/errors.

- [ ] **Step 4: Commit each fix individually**

```bash
git add <changed-files>
git commit -m "fix: <description of what was fixed>"
```
