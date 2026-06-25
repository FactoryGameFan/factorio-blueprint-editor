import { test } from '@playwright/test'
import { discoverBlueprintFiles, readBlueprintString } from './helpers/blueprint-files'
import { BlueprintDiagnostic, generateReport } from './helpers/report-generator'

// Warnings from headless Chromium's Canvas2D fallback - not blueprint issues
const IGNORED_WARNINGS = [
    'No available adapters.',
    'CanvasRenderer: filter "_AlphaFilter" is not supported in Canvas2D and will be skipped.',
]

const blueprintFiles = discoverBlueprintFiles()
const allDiagnostics: BlueprintDiagnostic[] = []

for (const bp of blueprintFiles) {
    test(`load blueprint: ${bp.name}`, async ({ page }) => {
        const warnings: string[] = []
        const errors: string[] = []
        const jsErrors: string[] = []
        let loadTimeMs: number | null

        // Listen for console messages (filtering headless renderer noise)
        page.on('console', async msg => {
            const text = msg.text()
            if (msg.type() === 'warning') {
                if (IGNORED_WARNINGS.some(iw => text.includes(iw))) return
                // Try to serialize object args for better reporting
                let fullText = text
                if (text.includes('[Object]') || text.includes('[Array]')) {
                    try {
                        const args = await Promise.all(
                            msg.args().map(a => a.jsonValue().catch(() => a.toString()))
                        )
                        fullText = args
                            .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
                            .join(' ')
                    } catch {
                        // Keep original text
                    }
                }
                warnings.push(fullText)
                console.log(`  WARN: ${fullText.split('\n')[0]}`)
            } else if (msg.type() === 'error') {
                errors.push(text)
                console.log(`  ERROR: ${text}`)
            }
        })

        // Listen for uncaught JS errors (filtering headless Canvas2D noise)
        page.on('pageerror', error => {
            if (error.message.includes("Failed to execute 'drawImage'")) return
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

        // Use the exposed test API to load the blueprint directly
        const startTime = Date.now()

        try {
            await page.evaluate(async bpStr => {
                const fbe = (window as any).__fbe_test
                fbe.loadingScreen.show()
                const bpOrBook = await fbe.getBlueprintOrBookFromSource(bpStr)
                await fbe.loadBp(bpOrBook)
            }, bpString)

            loadTimeMs = Date.now() - startTime
            console.log(`  Loaded in ${loadTimeMs}ms`)
        } catch (err: any) {
            loadTimeMs = Date.now() - startTime
            const msg = err.message?.split('\n')[0] || String(err)
            jsErrors.push(msg)
            console.log(`  LOAD ERROR (${loadTimeMs}ms): ${msg}`)
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
