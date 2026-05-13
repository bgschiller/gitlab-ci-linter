import { type Command } from 'commander'
import { addCommonOptions, readCommonOptions, type Severity } from '../cli/commonOptions'
import { getBool } from '../cli/opts'
import { buildLinter, resolveSource } from '../cli/source'
import type { LintIssue } from '../types'
import type { LintIssueWithSource } from '../child-pipeline'

const ANSI = {
  error: '\x1b[31m',
  warning: '\x1b[33m',
  info: '\x1b[36m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
} as const

const SEVERITY_ORDER: Record<Severity, number> = { error: 3, warning: 2, info: 1 }

export function registerLintCommand(program: Command): Command {
  return addCommonOptions(
    program
      .command('lint', { isDefault: true })
      .description('Check a GitLab CI file for common issues (default command)')
      .argument('[source...]', 'Path to .gitlab-ci.yml, or GitLab URL, or "<project> <ref>"')
      .option('--children', 'Also lint child pipelines reachable from the parent'),
  ).action(lintAction)
}

async function lintAction(source: string[], opts: Record<string, unknown>): Promise<void> {
  const common = readCommonOptions(opts)
  const linter = buildLinter(resolveSource(source), {
    rootDir: common.rootDir,
    gitlabHost: common.gitlabHost,
  })

  const allIssues = getBool(opts, 'children')
    ? await linter.lintWithChildren()
    : await linter.lint()
  const filteredIssues = filterIssuesBySeverity(allIssues, common.severity)

  if (common.quiet) process.exit(quietLintExitCode(filteredIssues))

  if (filteredIssues.length === 0) {
    console.log('No issues found')
    return
  }
  printLintIssues(filteredIssues, common.color)
  const errorCount = filteredIssues.filter(i => i.severity === 'error').length
  const warningCount = filteredIssues.filter(i => i.severity === 'warning').length
  if (errorCount > 0) process.exit(2)
  if (warningCount > 0) process.exit(1)
}

export function filterIssuesBySeverity(issues: LintIssue[], severityLevel: Severity): LintIssue[] {
  const min = SEVERITY_ORDER[severityLevel]
  return issues.filter(i => (SEVERITY_ORDER[i.severity as Severity] ?? 0) >= min)
}

export function quietLintExitCode(issues: LintIssue[]): 0 | 1 | 2 {
  if (issues.some(i => i.severity === 'error')) return 2
  if (issues.some(i => i.severity === 'warning')) return 1
  return 0
}

function printLintIssues(issues: LintIssue[], useColor: boolean): void {
  const errorIssues = issues.filter(i => i.severity === 'error')
  const warningIssues = issues.filter(i => i.severity === 'warning')
  const infoIssues = issues.filter(i => i.severity === 'info')

  printIssueSummary(
    issues.length,
    errorIssues.length,
    warningIssues.length,
    infoIssues.length,
    useColor,
  )

  const ordered = [...errorIssues, ...warningIssues, ...infoIssues]
  ordered.forEach((issue, index) => {
    console.log(formatIssue(issue, useColor))
    if (index < issues.length - 1) console.log('')
  })
}

function printIssueSummary(
  total: number,
  errorCount: number,
  warningCount: number,
  infoCount: number,
  useColor: boolean,
): void {
  if (!useColor) {
    console.log(
      `\nFound ${total} ${plural(total, 'issue')}: ${errorCount} ${plural(errorCount, 'error')}, ${warningCount} ${plural(warningCount, 'warning')}, ${infoCount} info\n`,
    )
    return
  }
  console.log(`\nFound ${total} ${plural(total, 'issue')}:`)
  if (errorCount > 0)
    console.log(`  ${ANSI.error}${errorCount} ${plural(errorCount, 'error')}${ANSI.reset}`)
  if (warningCount > 0)
    console.log(`  ${ANSI.warning}${warningCount} ${plural(warningCount, 'warning')}${ANSI.reset}`)
  if (infoCount > 0) console.log(`  ${ANSI.info}${infoCount} info${ANSI.reset}`)
  console.log('')
}

export function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`
}

export function formatIssue(issue: LintIssue | LintIssueWithSource, useColor: boolean): string {
  const sourcePrefix = formatSourcePrefix((issue as LintIssueWithSource).source, useColor)
  const locationLine = formatLocationLine(issue.location, useColor)

  if (!useColor) {
    return `${sourcePrefix}${issue.severity}: ${issue.message}${locationLine}`
  }
  const severityColor = ANSI[issue.severity as keyof typeof ANSI] ?? ANSI.info
  return `${sourcePrefix}${severityColor}${issue.severity}${ANSI.reset}: ${issue.message}${locationLine}`
}

export function formatSourcePrefix(source: string | undefined, useColor: boolean): string {
  if (!source || source === 'parent') return ''
  return useColor ? `${ANSI.dim}[child: ${source}]${ANSI.reset} ` : `[child: ${source}] `
}

export function formatLocationLine(location: string | undefined, useColor: boolean): string {
  if (!location) return ''
  return useColor ? `\n  ${ANSI.dim}at ${location}${ANSI.reset}` : `\n  at ${location}`
}
