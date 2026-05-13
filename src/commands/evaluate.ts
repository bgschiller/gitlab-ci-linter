import { writeFileSync } from 'fs'
import { type Command } from 'commander'
import { addCommonOptions, readCommonOptions } from '../cli/commonOptions'
import { getBool, getString, getStringArray, getStringRecord } from '../cli/opts'
import { buildLinter, resolveSource } from '../cli/source'
import { collectVar, loadVarsFile, parseCommaList, reportVarsFileError } from '../cli/varsFile'
import { generatePipelineHtml } from '../visualization'
import type { ChildPipelineResult, EvaluationSummaryWithChildren } from '../child-pipeline'

const DEFAULT_HTML_PATH = 'pipeline.html'

export function registerEvaluateCommand(program: Command): Command {
  return addCommonOptions(
    program
      .command('evaluate')
      .description('Evaluate which jobs run given pipeline variables and a changeset')
      .argument('[source...]', 'Path to .gitlab-ci.yml, or GitLab URL, or "<project> <ref>"')
      .option('--var <key=value>', 'Pipeline variable (repeatable)', collectVar, {})
      .option('--vars-file <path>', 'Load variables and optional changes from a JSON/YAML file')
      .option(
        '--changes <list>',
        'Comma-separated changed paths (overrides vars-file)',
        parseCommaList,
      )
      .option('--json', 'Emit JSON output')
      .option(
        '--html [path]',
        'Emit HTML visualization (defaults to pipeline.html if no path given)',
      )
      .option('--show-skipped', 'Include skipped jobs in the output')
      .option('--no-children', 'Do not evaluate child pipelines'),
  ).action(evaluateAction)
}

async function evaluateAction(source: string[], opts: Record<string, unknown>): Promise<void> {
  const common = readCommonOptions(opts)
  const includeChildren = opts['children'] !== false
  const linter = buildLinter(resolveSource(source), {
    rootDir: common.rootDir,
    gitlabHost: common.gitlabHost,
    evaluateChildren: includeChildren,
  })

  const { variables, changes } = loadEvaluateContext(opts)
  const context = { variables, changes }
  const result = await linter.evaluate(context, includeChildren)
  const showSkipped = getBool(opts, 'showSkipped')

  const htmlOutput = pickHtmlOutput(opts['html'])
  if (htmlOutput) {
    writeHtmlOutput(htmlOutput, result, context, source[0], showSkipped)
    return
  }
  if (getBool(opts, 'json')) {
    writeJsonOutput(result, showSkipped)
    return
  }
  writeTextOutput(result, showSkipped, common.color)
}

/**
 * Commander represents `--html` (optional value) as `undefined` (flag
 * absent), `true` (flag without value), or a string (flag with value).
 * Collapse to the resolved path, or `undefined` if HTML output isn't
 * requested.
 */
export function pickHtmlOutput(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  if (raw === true) return DEFAULT_HTML_PATH
  return undefined
}

function loadEvaluateContext(opts: Record<string, unknown>): {
  variables: Record<string, string>
  changes: string[] | undefined
} {
  let variables: Record<string, string> = {}
  let changes = getStringArray(opts, 'changes')
  const varsFile = getString(opts, 'varsFile')

  if (varsFile) {
    const loaded = readVarsFileOrExit(varsFile)
    if (!changes && Array.isArray(loaded['changes'])) {
      changes = loaded['changes'] as string[]
    }
    variables = extractVariables(loaded)
  }

  return { variables: { ...variables, ...getStringRecord(opts, 'var') }, changes }
}

function readVarsFileOrExit(path: string): Record<string, unknown> {
  try {
    return loadVarsFile(path)
  } catch (error) {
    reportVarsFileError(path, error, 1)
  }
}

export function extractVariables(loaded: Record<string, unknown>): Record<string, string> {
  const nested = loaded['variables']
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...(nested as Record<string, string>) }
  }
  // Treat top-level keys as variables, but drop the three structural fields:
  // `changes` (file patterns), `description` (scenario label), and
  // `variables` (malformed — if it survived the if-branch above it's
  // either falsy or an array, neither of which is a usable map).
  const { changes: _c, description: _d, variables: _v, ...rest } = loaded
  return { ...(rest as Record<string, string>) }
}

function writeHtmlOutput(
  path: string,
  result: any,
  context: { variables: Record<string, string>; changes?: string[] },
  sourceLabel: string | undefined,
  showSkipped: boolean,
): void {
  const html = generatePipelineHtml(result, {
    title: `Pipeline: ${sourceLabel ?? 'GitLab CI'}`,
    showSkipped,
    context,
  })
  writeFileSync(path, html)
  console.log(`HTML visualization written to: ${path}`)
  console.log(`  ${result.jobs.length} jobs will run, ${result.skipped.length} skipped`)
}

export function writeJsonOutput(result: any, showSkipped: boolean): void {
  const resultWithChildren = result as EvaluationSummaryWithChildren
  const output = {
    jobs: result.jobs.map(toJsonJob),
    ...(showSkipped && { skipped: result.skipped.map(toJsonSkipped) }),
    ...(resultWithChildren.childPipelines && {
      childPipelines: resultWithChildren.childPipelines.map(c => toJsonChild(c, showSkipped)),
    }),
    summary: {
      totalJobs: result.totalJobs,
      willRun: result.jobs.length,
      skipped: result.skipped.length,
      ...(resultWithChildren.childPipelines && {
        childPipelinesCount: resultWithChildren.childPipelines.length,
      }),
    },
  }
  console.log(JSON.stringify(output, null, 2))
}

function toJsonJob(j: any): any {
  return {
    name: j.name,
    stage: j.stage,
    when: j.when,
    ...(j.matchedRule && { matchedRule: j.matchedRule }),
  }
}

function toJsonSkipped(j: any): any {
  return { name: j.name, stage: j.stage, reason: j.reason }
}

function toJsonChild(child: ChildPipelineResult, showSkipped: boolean): any {
  return {
    configPath: child.configPath,
    triggerJobName: child.triggerJobName,
    depth: child.depth,
    ...(child.error && { error: child.error }),
    jobs: child.evaluation.jobs.map(toJsonJob),
    ...(showSkipped && { skipped: child.evaluation.skipped.map(toJsonSkipped) }),
    summary: {
      totalJobs: child.evaluation.totalJobs,
      willRun: child.evaluation.jobs.length,
      skipped: child.evaluation.skipped.length,
    },
    ...(child.children && { childPipelines: child.children.map(c => toJsonChild(c, showSkipped)) }),
  }
}

export function writeTextOutput(result: any, showSkipped: boolean, useColor: boolean): void {
  const resultWithChildren = result as EvaluationSummaryWithChildren
  const childCounts = resultWithChildren.childPipelines
    ? countChildJobs(resultWithChildren.childPipelines)
    : { willRun: 0, total: 0 }

  if (result.jobs.length === 0 && childCounts.willRun === 0) {
    console.log('No jobs will run')
  } else {
    printRunHeader(result, resultWithChildren, childCounts)
    printJobsByStage(result.jobs, resultWithChildren.childPipelines, useColor)
  }

  if (showSkipped && result.skipped.length > 0) {
    printSkippedJobs(result.skipped)
  }
}

function printRunHeader(
  result: any,
  withChildren: EvaluationSummaryWithChildren,
  childCounts: { willRun: number; total: number },
): void {
  const children = withChildren.childPipelines
  if (children && children.length > 0) {
    const totalWillRun = result.jobs.length + childCounts.willRun
    const totalJobs = result.totalJobs + childCounts.total
    console.log(
      `Jobs that will run (${totalWillRun}/${totalJobs} including ${children.length} child pipeline(s)):\n`,
    )
  } else {
    console.log(`Jobs that will run (${result.jobs.length}/${result.totalJobs}):\n`)
  }
}

function printJobsByStage(
  jobs: any[],
  children: ChildPipelineResult[] | undefined,
  useColor: boolean,
): void {
  const byStage = groupByStage(jobs)
  const triggersWithChildren = new Set(children?.map(c => c.triggerJobName) ?? [])

  for (const [stage, stageJobs] of byStage) {
    console.log(`  ${stage}:`)
    for (const job of stageJobs) {
      const whenSuffix = job.when !== 'on_success' ? ` (${job.when})` : ''
      console.log(`    - ${job.name}${whenSuffix}`)
      printChildPipelineFor(job.name, triggersWithChildren, children, useColor)
    }
  }
}

function printChildPipelineFor(
  jobName: string,
  triggers: Set<string>,
  children: ChildPipelineResult[] | undefined,
  useColor: boolean,
): void {
  if (!children || !triggers.has(jobName)) return
  const child = children.find(c => c.triggerJobName === jobName)
  if (!child) return
  for (const line of formatChildPipelinesText([child], useColor)) console.log(line)
}

function printSkippedJobs(skipped: any[]): void {
  console.log(`\nSkipped jobs (${skipped.length}):\n`)
  for (const job of skipped) {
    console.log(`  - ${job.name}: ${job.reason || 'no reason'}`)
  }
}

export function groupByStage<T extends { stage: string }>(jobs: T[]): Map<string, T[]> {
  const byStage = new Map<string, T[]>()
  for (const job of jobs) {
    const stageJobs = byStage.get(job.stage) ?? []
    stageJobs.push(job)
    byStage.set(job.stage, stageJobs)
  }
  return byStage
}

export function formatChildPipelinesText(
  children: ChildPipelineResult[],
  useColor: boolean,
  indent = '        ',
): string[] {
  const lines: string[] = []
  for (const child of children) {
    lines.push(...formatChildEntry(child, useColor, indent))
  }
  return lines
}

function formatChildEntry(child: ChildPipelineResult, useColor: boolean, indent: string): string[] {
  const colors = childColors(useColor)
  const lines: string[] = [`${indent}${colors.cyan}└─ Child: ${child.configPath}${colors.reset}`]
  if (child.error) {
    lines.push(`${indent}   ${colors.dim}(error: ${child.error})${colors.reset}`)
    return lines
  }
  lines.push(...formatChildStages(child.evaluation.jobs, indent, colors))
  if (child.children && child.children.length > 0) {
    lines.push(...formatChildPipelinesText(child.children, useColor, indent + '      '))
  }
  return lines
}

function formatChildStages(
  jobs: ChildPipelineResult['evaluation']['jobs'],
  indent: string,
  colors: ReturnType<typeof childColors>,
): string[] {
  const lines: string[] = []
  const byStage = groupByStage(jobs)
  let stageIndex = 0
  const stageCount = byStage.size
  for (const [stage, stageJobs] of byStage) {
    const isLastStage = stageIndex === stageCount - 1
    const stagePrefix = isLastStage ? '└─' : '├─'
    lines.push(`${indent}   ${stagePrefix} ${stage}:`)
    stageJobs.forEach((job, i) => {
      lines.push(formatChildJobLine(job, i, stageJobs.length, isLastStage, indent, colors))
    })
    stageIndex++
  }
  return lines
}

function formatChildJobLine(
  job: ChildPipelineResult['evaluation']['jobs'][number],
  index: number,
  total: number,
  isLastStage: boolean,
  indent: string,
  colors: ReturnType<typeof childColors>,
): string {
  const isLastJob = index === total - 1
  const jobPrefix = isLastStage ? '   ' : '│  '
  const jobMarker = isLastJob ? '└─' : '├─'
  const whenSuffix = job.when !== 'on_success' ? ` ${colors.dim}(${job.when})${colors.reset}` : ''
  return `${indent}   ${jobPrefix} ${jobMarker} ${job.name}${whenSuffix}`
}

function childColors(useColor: boolean): { dim: string; cyan: string; reset: string } {
  return {
    dim: useColor ? '\x1b[2m' : '',
    cyan: useColor ? '\x1b[36m' : '',
    reset: useColor ? '\x1b[0m' : '',
  }
}

export function countChildJobs(children: ChildPipelineResult[]): {
  willRun: number
  total: number
} {
  let willRun = 0
  let total = 0
  for (const child of children) {
    willRun += child.evaluation.jobs.length
    total += child.evaluation.totalJobs
    if (child.children) {
      const nested = countChildJobs(child.children)
      willRun += nested.willRun
      total += nested.total
    }
  }
  return { willRun, total }
}
