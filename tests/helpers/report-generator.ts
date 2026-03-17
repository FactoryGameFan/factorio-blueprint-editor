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
            bp.consoleWarnings.length > 0 ||
            bp.consoleErrors.length > 0 ||
            bp.jsErrors.length > 0
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
