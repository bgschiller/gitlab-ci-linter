import type { EvaluationContext, EvaluationSummary } from '../rule-evaluation'

/**
 * Expected job status for assertions.
 * - `automatic` - Job runs automatically (willRun: true AND when is on_success/always/on_failure/delayed)
 * - `manual` - Job requires manual trigger (willRun: true AND when: 'manual')
 * - `skipped` - Job won't run (willRun: false)
 */
export type ExpectedJobStatus = 'automatic' | 'manual' | 'skipped'

/**
 * Map of job names to their expected status
 */
export type JobAssertions = Record<string, ExpectedJobStatus>

/**
 * Count assertions for different job categories
 */
export interface CountAssertions {
  /** Number of jobs that run automatically */
  automatic?: number
  /** Number of jobs that require manual trigger */
  manual?: number
  /** Number of jobs that are skipped */
  skipped?: number
  /** Total number of jobs */
  total?: number
}

/**
 * Assertions for a child pipeline, keyed by trigger job name.
 * Supports nested child pipelines (grandchildren).
 */
export interface ChildPipelineAssertions {
  /** Assertions about specific job statuses in the child pipeline */
  jobs?: JobAssertions
  /** Assertions about job counts in the child pipeline */
  counts?: CountAssertions
  /** Assertions for nested child pipelines (grandchildren), keyed by trigger job name */
  childPipelines?: Record<string, ChildPipelineAssertions>
}

/**
 * Container for all assertions in a test scenario
 */
export interface TestAssertions {
  /** Assertions about specific job statuses */
  jobs?: JobAssertions
  /** Assertions about job counts */
  counts?: CountAssertions
  /** Assertions for child pipelines, keyed by trigger job name */
  childPipelines?: Record<string, ChildPipelineAssertions>
}

/**
 * A test scenario that extends the variable file format with assertions.
 * Can be loaded from a JSON file.
 */
export interface TestScenario {
  /** Optional description of the test scenario */
  description?: string
  /** Environment variables for evaluation */
  variables: Record<string, string>
  /** List of changed files for evaluation */
  changes?: string[]
  /** Assertions to verify after evaluation */
  assertions: TestAssertions
}

/**
 * Result of a single assertion check
 */
export interface AssertionResult {
  /** Whether the assertion passed */
  passed: boolean
  /** Type of assertion (job status or count) */
  type: 'job' | 'count'
  /** Name of the job or count type being checked */
  name: string
  /** Expected value */
  expected: string | number
  /** Actual value */
  actual: string | number
  /** Human-readable message describing the result */
  message: string
}

/**
 * Overall result of running a test scenario
 */
export interface TestResult {
  /** Whether all assertions passed */
  passed: boolean
  /** Description from the test scenario */
  description?: string
  /** Individual assertion results */
  assertions: AssertionResult[]
  /** Summary of passed/failed assertions */
  summary: {
    total: number
    passed: number
    failed: number
  }
  /** The evaluation summary from the linter */
  evaluation: EvaluationSummary
  /** The evaluation context used */
  context: EvaluationContext
}

/**
 * Aggregated result of running multiple test scenarios.
 * Used when testing a directory of scenario files.
 */
export interface AggregateTestResult {
  /** Whether all scenarios passed */
  passed: boolean
  /** Individual test results per scenario */
  results: TestResult[]
  /** Aggregate summary across all scenarios */
  summary: {
    totalScenarios: number
    passedScenarios: number
    failedScenarios: number
    totalAssertions: number
    passedAssertions: number
    failedAssertions: number
  }
}
