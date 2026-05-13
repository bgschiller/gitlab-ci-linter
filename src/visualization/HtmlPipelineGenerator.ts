import { stringify } from 'yaml'
import type {
  EvaluationContext,
  EvaluationSummary,
  JobEvaluationResult,
} from '../rule-evaluation/types'
import { pipelineClientScript } from './templates/clientScript'
import { pipelineStyles } from './templates/styles'

export interface HtmlGeneratorOptions {
  title?: string
  showSkipped?: boolean
  /** The evaluation context (variables, changes) used to generate this pipeline */
  context?: EvaluationContext
}

/**
 * Extract job names from the needs field, which can be:
 * - Array of strings: ['job1', 'job2']
 * - Array of objects: [{job: 'job1'}, {job: 'job2', artifacts: true}]
 */
function extractNeeds(needs: unknown): string[] {
  if (!needs || !Array.isArray(needs)) return []

  return needs
    .map(need => {
      if (typeof need === 'string') return need
      if (typeof need === 'object' && need !== null && 'job' in need) {
        return (need as { job: string }).job
      }
      return null
    })
    .filter((name): name is string => name !== null)
}

/**
 * Build a map of job dependencies: jobName -> jobs that depend on it
 */
function buildDependencyMap(jobs: JobEvaluationResult[]): Map<string, string[]> {
  const dependencyMap = new Map<string, string[]>()

  for (const job of jobs) {
    const needs = extractNeeds(job.jobConfig?.needs)
    for (const needJob of needs) {
      const dependents = dependencyMap.get(needJob) || []
      dependents.push(job.name)
      dependencyMap.set(needJob, dependents)
    }
  }

  return dependencyMap
}

export function generatePipelineHtml(
  result: EvaluationSummary,
  options: HtmlGeneratorOptions = {},
): string {
  const { title = 'GitLab CI Pipeline Visualization', showSkipped = true, context } = options

  // Group jobs by stage
  const runningByStage = groupByStage(result.jobs)
  const skippedByStage = groupByStage(result.skipped)

  // Build dependency map for arrows
  const allJobs = [...result.jobs, ...result.skipped]
  const dependencyMap = buildDependencyMap(allJobs)

  // Generate dependency data as JSON for JavaScript
  const dependencyData: Record<string, string[]> = {}
  for (const [source, targets] of dependencyMap) {
    dependencyData[source] = targets
  }

  // Also create reverse map: job -> what it needs
  const needsData: Record<string, string[]> = {}
  for (const job of allJobs) {
    const needs = extractNeeds(job.jobConfig?.needs)
    if (needs.length > 0) {
      needsData[job.name] = needs
    }
  }

  // Get all unique stages in order
  const allStages = new Set<string>()
  for (const job of allJobs) {
    allStages.add(job.stage)
  }
  const stages = Array.from(allStages)

  // Collect all job names to detect missing dependencies
  const allJobNames = new Set(allJobs.map(job => job.name))

  const stagesHtml = stages
    .map(stage => {
      const runningJobs = runningByStage.get(stage) || []
      const skippedJobs = skippedByStage.get(stage) || []

      const runningJobsHtml = runningJobs
        .map(job => generateJobHtml(job, 'running', allJobNames))
        .join('\n')

      const skippedJobsHtml =
        showSkipped && skippedJobs.length > 0
          ? skippedJobs.map(job => generateJobHtml(job, 'skipped', allJobNames)).join('\n')
          : ''

      return `
      <div class="stage">
        <div class="stage-header">${escapeHtml(stage)}</div>
        <div class="stage-jobs">
          ${runningJobsHtml}
          ${skippedJobsHtml}
        </div>
      </div>`
    })
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${pipelineStyles}
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="summary">
      <span class="summary-item summary-running">${result.jobs.length} jobs will run</span>
      <span class="summary-item summary-skipped">${result.skipped.length} skipped</span>
      <span class="summary-item summary-total">${result.totalJobs} total</span>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><span class="legend-dot success"></span> Will run (on_success)</div>
    <div class="legend-item"><span class="legend-dot manual"></span> Manual trigger</div>
    <div class="legend-item"><span class="legend-dot always"></span> Always runs</div>
    <div class="legend-item"><span class="legend-dot skipped"></span> Skipped</div>
  </div>

  ${generateConfigSection(context)}

  <div class="controls">
    <label>
      <input type="checkbox" id="toggleSkipped" ${showSkipped ? 'checked' : ''}>
      Show skipped jobs
    </label>
    <label>
      <input type="checkbox" id="expandAll">
      Expand all
    </label>
    <label>
      <input type="checkbox" id="toggleNeeds">
      Show dependencies
    </label>
    <label>
      <input type="checkbox" id="toggleArrows">
      Show dependency arrows
    </label>
  </div>

  <div class="pipeline-wrapper">
    <div class="arrows-container" id="arrowsContainer" style="display: none;">
      <svg id="arrowsSvg">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="arrow-marker" />
          </marker>
        </defs>
      </svg>
    </div>
    <div class="pipeline">
      ${stagesHtml}
    </div>
  </div>

  <script>
${injectDataIntoScript(pipelineClientScript, needsData, dependencyData)}
  </script>
</body>
</html>`
}

/**
 * Inject dynamic data into the client-side JavaScript template.
 */
function injectDataIntoScript(
  template: string,
  needsData: Record<string, string[]>,
  dependencyData: Record<string, string[]>,
): string {
  return template
    .replace('__NEEDS_DATA__', JSON.stringify(needsData))
    .replace('__DEPENDENCY_DATA__', JSON.stringify(dependencyData))
}

function groupByStage(jobs: JobEvaluationResult[]): Map<string, JobEvaluationResult[]> {
  const byStage = new Map<string, JobEvaluationResult[]>()
  for (const job of jobs) {
    const stageJobs = byStage.get(job.stage) || []
    stageJobs.push(job)
    byStage.set(job.stage, stageJobs)
  }
  return byStage
}

function generateJobHtml(
  job: JobEvaluationResult,
  status: 'running' | 'skipped',
  allJobNames: Set<string>,
): string {
  const whenClass = job.when === 'manual' ? 'manual' : job.when === 'always' ? 'always' : ''
  const whenLabel = job.when !== 'on_success' ? job.when : ''

  // Extract needs for display
  const needs = extractNeeds(job.jobConfig?.needs)
  const needsBadges =
    needs.length > 0
      ? `<div class="job-needs">${needs
          .map(n => {
            const isMissing = !allJobNames.has(n)
            const missingClass = isMissing ? ' missing' : ''
            const prefix = isMissing ? '⚠ ' : '← '
            return `<span class="needs-badge${missingClass}">${prefix}${escapeHtml(n)}</span>`
          })
          .join('')}</div>`
      : ''

  // Generate YAML from job config
  let yamlConfig = ''
  if (job.jobConfig) {
    try {
      yamlConfig = stringify({ [job.name]: job.jobConfig }, { lineWidth: 0 })
    } catch {
      yamlConfig = JSON.stringify(job.jobConfig, null, 2)
    }
  }

  const reasonHtml =
    status === 'skipped' && job.reason
      ? `<p class="reason">Skip reason: ${escapeHtml(job.reason)}</p>`
      : ''

  return `
    <div class="job ${status} ${whenClass}" data-job-name="${escapeHtml(job.name)}">
      <div class="job-header">
        <div class="job-name">${escapeHtml(job.name)}</div>
        <span class="job-expand-icon">▼</span>
      </div>
      ${whenLabel ? `<div class="job-when">${escapeHtml(whenLabel)}</div>` : ''}
      ${needsBadges}
      <div class="job-details">
        ${reasonHtml}
        <div class="job-details-header">
          <h4>Job Configuration (YAML)</h4>
        </div>
        <pre>${escapeHtml(yamlConfig)}</pre>
      </div>
    </div>`
}

function generateConfigSection(context: EvaluationContext | undefined): string {
  if (!context) {
    return ''
  }

  // Format variables as YAML for display
  const variablesYaml = stringify(context.variables, { lineWidth: 0 })

  // Generate changes list if present
  const changesHtml =
    context.changes && context.changes.length > 0
      ? `
      <div class="config-group">
        <h4>Changed Files (${context.changes.length})</h4>
        <div class="changes-list">
          ${context.changes.map(f => `<span class="change-item">${escapeHtml(f)}</span>`).join('')}
        </div>
      </div>`
      : ''

  // Generate exists list if present
  const existsHtml =
    context.exists && context.exists.length > 0
      ? `
      <div class="config-group">
        <h4>Existing Files (${context.exists.length})</h4>
        <div class="changes-list">
          ${context.exists.map(f => `<span class="change-item">${escapeHtml(f)}</span>`).join('')}
        </div>
      </div>`
      : ''

  return `
  <div class="config-section" id="configSection">
    <div class="config-header" onclick="document.getElementById('configSection').classList.toggle('expanded')">
      <h3>📋 Evaluation Configuration</h3>
      <span class="config-toggle">▼</span>
    </div>
    <div class="config-content">
      <div class="config-group">
        <h4>Variables</h4>
        <pre>${escapeHtml(variablesYaml)}</pre>
      </div>
      ${changesHtml}
      ${existsHtml}
    </div>
  </div>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
