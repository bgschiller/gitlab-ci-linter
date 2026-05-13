import type { GitLabJob, GitLabRule, GitLabWhen } from '../types'

/**
 * Context for evaluating GitLab CI job rules.
 * Represents the environment in which the pipeline runs.
 */
export interface EvaluationContext {
  /** Environment variables available during pipeline execution */
  variables: Record<string, string | null>
  /** List of files that changed (for evaluating `changes` conditions) */
  changes?: string[]
  /** List of files that exist (for evaluating `exists` conditions) */
  exists?: string[]
}

/**
 * Result of evaluating a single job's rules
 */
export interface JobEvaluationResult {
  /** Job name */
  name: string
  /** Whether the job will run given the context */
  willRun: boolean
  /** Stage the job belongs to */
  stage: string
  /** When the job will run (on_success, manual, etc.) */
  when: GitLabWhen
  /** The rule that matched (if any) */
  matchedRule?: GitLabRule
  /** Reason why the job won't run (if willRun is false) */
  reason?: string
  /** Full job configuration (flattened) */
  jobConfig?: GitLabJob
}

/**
 * Summary of evaluation results
 */
export interface EvaluationSummary {
  /** Jobs that will run */
  jobs: JobEvaluationResult[]
  /** Jobs that will be skipped */
  skipped: JobEvaluationResult[]
  /** Total number of jobs evaluated */
  totalJobs: number
}
