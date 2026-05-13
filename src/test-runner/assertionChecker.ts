import type { EvaluationSummary, JobEvaluationResult } from '../rule-evaluation'
import type { ChildPipelineResult } from '../child-pipeline'
import type {
  AssertionResult,
  ChildPipelineAssertions,
  CountAssertions,
  ExpectedJobStatus,
  TestAssertions,
} from './types'

/**
 * Determine the status of a job based on its evaluation result.
 * - `automatic` - Job runs automatically (willRun: true AND when is on_success/always/on_failure/delayed)
 * - `manual` - Job requires manual trigger (willRun: true AND when: 'manual')
 * - `skipped` - Job won't run (willRun: false)
 */
export function determineJobStatus(job: JobEvaluationResult): ExpectedJobStatus {
  if (!job.willRun) {
    return 'skipped'
  }

  if (job.when === 'manual') {
    return 'manual'
  }

  return 'automatic'
}

/**
 * Check a single job assertion against the evaluation summary.
 */
export function checkJobAssertion(
  jobName: string,
  expected: ExpectedJobStatus,
  summary: EvaluationSummary,
): AssertionResult {
  // Find the job in both running and skipped lists
  const runningJob = summary.jobs.find(j => j.name === jobName)
  const skippedJob = summary.skipped.find(j => j.name === jobName)
  const job = runningJob || skippedJob

  if (!job) {
    return {
      passed: false,
      type: 'job',
      name: jobName,
      expected,
      actual: 'not found',
      message: `Job '${jobName}' not found in evaluation results`,
    }
  }

  const actual = determineJobStatus(job)
  const passed = actual === expected

  return {
    passed,
    type: 'job',
    name: jobName,
    expected,
    actual,
    message: passed
      ? `Job '${jobName}' has expected status '${expected}'`
      : `Job '${jobName}' expected '${expected}' but was '${actual}'`,
  }
}

/**
 * Count jobs by status from the evaluation summary.
 */
export function countJobsByStatus(summary: EvaluationSummary): {
  automatic: number
  manual: number
  skipped: number
  total: number
} {
  let automatic = 0
  let manual = 0

  for (const job of summary.jobs) {
    const status = determineJobStatus(job)
    if (status === 'automatic') {
      automatic++
    } else if (status === 'manual') {
      manual++
    }
  }

  return {
    automatic,
    manual,
    skipped: summary.skipped.length,
    total: summary.totalJobs,
  }
}

/**
 * Check a single count assertion against the evaluation summary.
 */
export function checkCountAssertion(
  countType: keyof CountAssertions,
  expected: number,
  summary: EvaluationSummary,
): AssertionResult {
  const counts = countJobsByStatus(summary)
  const actual = counts[countType]
  const passed = actual === expected

  return {
    passed,
    type: 'count',
    name: countType,
    expected,
    actual,
    message: passed
      ? `Count '${countType}' is ${expected} as expected`
      : `Count '${countType}' expected ${expected} but was ${actual}`,
  }
}

/**
 * Check all assertions against the evaluation summary.
 */
export function checkAllAssertions(
  assertions: TestAssertions,
  summary: EvaluationSummary,
): AssertionResult[] {
  const results: AssertionResult[] = []

  // Check job assertions
  if (assertions.jobs) {
    for (const [jobName, expected] of Object.entries(assertions.jobs)) {
      results.push(checkJobAssertion(jobName, expected as ExpectedJobStatus, summary))
    }
  }

  // Check count assertions
  if (assertions.counts) {
    for (const [countType, expected] of Object.entries(assertions.counts)) {
      if (expected !== undefined) {
        results.push(
          checkCountAssertion(countType as keyof CountAssertions, expected as number, summary),
        )
      }
    }
  }

  return results
}

/**
 * Check child pipeline assertions against the evaluation results.
 * Recursively handles grandchild pipelines.
 *
 * @param childAssertions - Map of trigger job names to child pipeline assertions
 * @param childPipelines - Array of child pipeline results from evaluation
 * @param prefix - Prefix for assertion names (for nested pipelines)
 * @returns Array of assertion results
 */
export function checkChildPipelineAssertions(
  childAssertions: Record<string, ChildPipelineAssertions>,
  childPipelines: ChildPipelineResult[],
  prefix = '',
): AssertionResult[] {
  const results: AssertionResult[] = []

  for (const [triggerJobName, assertions] of Object.entries(childAssertions)) {
    const child = childPipelines.find(c => c.triggerJobName === triggerJobName)
    const assertionPrefix = prefix ? `${prefix} > ${triggerJobName}` : triggerJobName

    if (!child) {
      // Child pipeline not found - fail all assertions
      if (assertions.jobs) {
        for (const [jobName, expected] of Object.entries(assertions.jobs)) {
          results.push({
            passed: false,
            type: 'job',
            name: `${assertionPrefix}:${jobName}`,
            expected,
            actual: 'pipeline not found',
            message: `Child pipeline for '${triggerJobName}' was not evaluated`,
          })
        }
      }
      if (assertions.counts) {
        for (const [countType, expected] of Object.entries(assertions.counts)) {
          if (expected !== undefined) {
            results.push({
              passed: false,
              type: 'count',
              name: `${assertionPrefix}:${countType}`,
              expected,
              actual: 'pipeline not found',
              message: `Child pipeline for '${triggerJobName}' was not evaluated`,
            })
          }
        }
      }
      continue
    }

    // Check if child pipeline had an error
    if (child.error) {
      if (assertions.jobs) {
        for (const [jobName, expected] of Object.entries(assertions.jobs)) {
          results.push({
            passed: false,
            type: 'job',
            name: `${assertionPrefix}:${jobName}`,
            expected,
            actual: 'pipeline error',
            message: `Child pipeline for '${triggerJobName}' failed to evaluate: ${child.error}`,
          })
        }
      }
      if (assertions.counts) {
        for (const [countType, expected] of Object.entries(assertions.counts)) {
          if (expected !== undefined) {
            results.push({
              passed: false,
              type: 'count',
              name: `${assertionPrefix}:${countType}`,
              expected,
              actual: 'pipeline error',
              message: `Child pipeline for '${triggerJobName}' failed to evaluate: ${child.error}`,
            })
          }
        }
      }
      continue
    }

    // Check job assertions for this child
    if (assertions.jobs) {
      for (const [jobName, expected] of Object.entries(assertions.jobs)) {
        const result = checkJobAssertion(jobName, expected as ExpectedJobStatus, child.evaluation)
        results.push({
          ...result,
          name: `${assertionPrefix}:${result.name}`,
        })
      }
    }

    // Check count assertions for this child
    if (assertions.counts) {
      for (const [countType, expected] of Object.entries(assertions.counts)) {
        if (expected !== undefined) {
          const result = checkCountAssertion(
            countType as keyof CountAssertions,
            expected as number,
            child.evaluation,
          )
          results.push({
            ...result,
            name: `${assertionPrefix}:${result.name}`,
          })
        }
      }
    }

    // Recursively check grandchild assertions
    if (assertions.childPipelines && child.children) {
      results.push(
        ...checkChildPipelineAssertions(assertions.childPipelines, child.children, assertionPrefix),
      )
    }
  }

  return results
}
