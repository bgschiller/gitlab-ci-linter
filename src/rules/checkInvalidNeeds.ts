import type { LintIssue } from '../types.js'
import type { ProcessedConfig } from '../ProcessedConfig.js'

/**
 * Extracts job name from a needs entry (can be string or object with `job` property)
 */
function getNeedJobName(need: unknown): string | undefined {
  if (typeof need === 'string') return need
  if (need && typeof need === 'object' && 'job' in need) {
    return (need as { job: string }).job
  }
  return undefined
}

/**
 * Checks if a needs entry should be skipped from validation:
 * - `optional: true` means the job may not exist in the pipeline
 * - `project` references a job in another project (cross-project artifact download)
 * - `pipeline` references a job in a parent/child pipeline
 */
function shouldSkipNeedValidation(need: unknown): boolean {
  if (!need || typeof need !== 'object') return false
  const needObj = need as Record<string, unknown>
  return needObj['optional'] === true || 'project' in needObj || 'pipeline' in needObj
}

/**
 * Type predicate that checks if a value is a string
 */
const isString = (value: unknown): value is string => typeof value === 'string'

/**
 * Checks for invalid `needs` references - jobs that depend on non-existent jobs.
 *
 * GitLab will fail the pipeline if a job's `needs` field references a job that doesn't exist.
 * This rule detects such invalid references early.
 */
export function checkInvalidNeeds(config: ProcessedConfig): LintIssue[] {
  const jobs = config.getJobs()
  const jobNames = new Set(Object.keys(jobs))

  return Object.entries(jobs)
    .filter(([jobName]) => !jobName.startsWith('.'))
    .flatMap(([jobName, job]) => {
      const needs = Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : []

      const needsIssues = needs
        .filter(need => !shouldSkipNeedValidation(need))
        .map(getNeedJobName)
        .filter(isString)
        .filter(name => !jobNames.has(name))
        .map(needJobName => ({
          severity: 'error' as const,
          message: `Job '${jobName}' has 'needs: ${needJobName}' but job '${needJobName}' does not exist`,
          location: jobName,
        }))

      const depIssues = (job.dependencies ?? [])
        .filter(isString)
        .filter(dep => !jobNames.has(dep))
        .map(dep => ({
          severity: 'error' as const,
          message: `Job '${jobName}' has 'dependencies: ${dep}' but job '${dep}' does not exist`,
          location: jobName,
        }))

      return [...needsIssues, ...depIssues]
    })
}
