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

        // Try clipboard paste approach first, fall back to page.evaluate() injection
        const startTime = Date.now()
        let pasteWorked = false

        try {
            await page.evaluate(async (bpStr) => {
                await navigator.clipboard.writeText(bpStr)
            }, bpString)

            // Dispatch paste via keyboard shortcut (Ctrl+V)
            await page.keyboard.down('Control')
            await page.keyboard.press('v')
            await page.keyboard.up('Control')

            // Check if loading screen appeared within 3 seconds
            await page.waitForFunction(
                () => {
                    const el = document.getElementById('loadingScreen')
                    return el && el.classList.contains('active')
                },
                { timeout: 3_000 }
            )
            pasteWorked = true
        } catch {
            // Clipboard paste didn't work in headless - use direct function injection
            console.log('  Clipboard paste failed, using direct function injection')

            await page.evaluate(async (bpStr) => {
                // Access the app's internal modules via the editor instance on window
                // We need to trigger the same flow as the paste handler
                const loadingScreen = document.getElementById('loadingScreen')
                if (loadingScreen) loadingScreen.classList.add('active')

                // Dispatch a custom event that we'll catch, or directly manipulate
                // Create and dispatch a paste event with the blueprint string
                const clipboardData = new DataTransfer()
                clipboardData.setData('text/plain', bpStr)
                const pasteEvent = new ClipboardEvent('paste', {
                    clipboardData,
                    bubbles: true,
                    cancelable: true,
                })

                // Override clipboard.readText to return our string
                const origReadText = navigator.clipboard.readText
                navigator.clipboard.readText = async () => bpStr
                document.dispatchEvent(pasteEvent)
                // Restore after a tick
                setTimeout(() => {
                    navigator.clipboard.readText = origReadText
                }, 100)
            }, bpString)

            // Wait a moment for the paste handler to fire
            await page.waitForTimeout(500)

            // Check if loading started
            const loadingStarted = await page.evaluate(() => {
                const el = document.getElementById('loadingScreen')
                return el && el.classList.contains('active')
            })

            if (loadingStarted) {
                pasteWorked = true
            } else {
                console.log('  Direct paste dispatch also failed - blueprint may not have loaded')
            }
        }

        if (pasteWorked) {
            // Wait for loading to complete or error
            try {
                await page.waitForFunction(
                    () => {
                        const el = document.getElementById('loadingScreen')
                        return el && (!el.classList.contains('active') || el.classList.contains('error'))
                    },
                    { timeout: 90_000 }
                )
                loadTimeMs = Date.now() - startTime
                console.log(`  Loaded in ${loadTimeMs}ms`)
            } catch {
                loadTimeMs = Date.now() - startTime
                console.log(`  TIMEOUT after ${loadTimeMs}ms - loading screen still active`)
            }
        }

        // Wait for toasts and async warnings to appear
        await page.waitForTimeout(2000)

        // Collect toast messages from the DOM
        const toastTexts = await page.$$eval('.toasts-toast .toasts-text', els =>
            els.map(el => ({
                text: el.textContent || '',
                isWarning:
                    el.closest('.toasts-toast')?.classList.contains('toasts-warning') || false,
                isError:
                    el.closest('.toasts-toast')?.classList.contains('toasts-error') || false,
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
