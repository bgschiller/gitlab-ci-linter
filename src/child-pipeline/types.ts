import type { EvaluationSummary, JobEvaluationResult } from '../rule-evaluation/types'
import type { GitLabJob, LintIssue } from '../types'

/**
 * Options for child pipeline evaluation
 */
export interface ChildPipelineOptions {
  /** Whether to evaluate child pipelines triggered via local includes (default: true) */
  evaluateChildren?: boolean
  /** Maximum depth of child pipeline nesting (default: 2, matching GitLab's limit) */
  maxDepth?: number
}

/**
 * Information about a trigger job with local include
 */
export interface TriggerJobInfo {
  /** Name of the trigger job */
  jobName: string
  /** The trigger job configuration */
  job: GitLabJob
  /** Path to the local child pipeline config file */
  localPath: string
  /** Whether the trigger job will run given the current context */
  willRun: boolean
  /** Forward settings from the trigger job */
  forward?: {
    pipeline_variables?: boolean
    yaml_variables?: boolean
  }
  /** Variables defined on the trigger job */
  jobVariables?: Record<string, string>
  /** Variables from the matched rule (per-rule variables override job-level variables) */
  matchedRuleVariables?: Record<string, string>
}

/**
 * Result of evaluating a child pipeline
 */
export interface ChildPipelineResult {
  /** Path to the child pipeline config file */
  configPath: string
  /** Name of the trigger job that spawned this child pipeline */
  triggerJobName: string
  /** Evaluation results for the child pipeline */
  evaluation: EvaluationSummary
  /** Lint issues found in the child pipeline */
  lintIssues: LintIssueWithSource[]
  /** Nested child pipelines (grandchildren) */
  children?: ChildPipelineResult[]
  /** Depth level (1 = child, 2 = grandchild) */
  depth: number
  /** Error message if the child pipeline failed to load/process */
  error?: string
}

/**
 * Extended lint issue with source tracking for child pipelines
 */
export interface LintIssueWithSource extends LintIssue {
  /** Source of the issue: 'parent' or path to child config */
  source?: string
  /** Depth level where the issue was found (0 = parent, 1 = child, 2 = grandchild) */
  depth?: number
}

/**
 * Extended evaluation summary that includes child pipeline results
 */
export interface EvaluationSummaryWithChildren extends EvaluationSummary {
  /** Results from child pipelines */
  childPipelines?: ChildPipelineResult[]
}

/**
 * Extended job evaluation result for trigger jobs
 */
export interface TriggerJobEvaluationResult extends JobEvaluationResult {
  /** Child pipeline result if this is a trigger job with local include */
  childPipeline?: ChildPipelineResult
}
