import type { ChildPipelineOptions } from '../child-pipeline'
import type { LinterOptions } from '../linter'
import type { ProcessedConfig } from '../ProcessedConfig'
import type { EvaluationContext } from '../rule-evaluation/types'
import type { ExpectedJobStatus, TestScenario } from '../test-runner/types'

/**
 * Callback that re-processes the CI config under a specific evaluation
 * context, so includes with `rules:` can be evaluated per scenario. When
 * provided to {@link ScenarioGenerationOptions.reprocessForScenario}, each
 * generated scenario is evaluated against its own per-scenario flattened
 * config.
 */
export type ReprocessForScenario = (ctx: EvaluationContext) => Promise<ProcessedConfig>

/**
 * Options for scenario generation
 */
export interface ScenarioGenerationOptions {
  /** Maximum number of scenarios to generate (default: unlimited, use --max-scenarios to cap) */
  maxScenarios?: number
  /** Focus on specific jobs (comma-separated list) */
  targetJobs?: string[]
  /** Include assertions in output (default: true) */
  includeAssertions?: boolean
  /** Generate minimal set covering unique outcomes (default: false) */
  minimizeCoverage?: boolean
  /** Include child pipeline assertions in generated scenarios (default: false) */
  includeChildren?: boolean
  /** Base directory for resolving child pipelines (required if includeChildren is true) */
  baseDir?: string
  /** Child pipeline evaluation options */
  childOptions?: ChildPipelineOptions & LinterOptions
  /** Pin variables to specific values, constraining generated scenarios to only include these values */
  pinnedVariables?: Record<string, string>
  /**
   * Re-process the CI config per scenario, so includes with `rules:` are
   * evaluated against each scenario's variables. When omitted, all scenarios
   * share the same flattened config (legacy behavior — includes load
   * unconditionally regardless of `rules`).
   */
  reprocessForScenario?: ReprocessForScenario
  /**
   * Override the synthetic file path suffix used for generic-glob `changes:`
   * patterns. Default is `src/index.ts` (TypeScript-flavoured, the linter's
   * original bias). Non-TypeScript repos can override e.g.
   * `src/main/java/Sample.java` for Gradle projects, or any other repo-
   * appropriate suffix. Extension-specific cases (.tf/.yml/.json/.md)
   * always take precedence and ignore this option.
   */
  changesSampleSuffix?: string
}

/**
 * Metadata about the scenario generation process
 */
export interface ScenarioGenerationMetadata {
  /** Total number of jobs analyzed */
  totalJobsAnalyzed: number
  /** Variables found in job rules */
  variablesFound: string[]
  /** Changes patterns found in job rules */
  changesFound?: string[]
  /** Number of unique outcome combinations */
  uniqueOutcomes: number
  /** Jobs that were targeted (all jobs if not filtered) */
  targetedJobs: string[]
  /** Total scenarios before maxScenarios limit was applied (only set when truncated) */
  totalBeforeLimit?: number
}

/**
 * Result of scenario generation
 */
export interface ScenarioGenerationResult {
  /** Generated test scenarios */
  scenarios: TestScenario[]
  /** Metadata about the generation process */
  metadata: ScenarioGenerationMetadata
}

/**
 * Internal representation of job outcome in a scenario
 */
export interface JobOutcome {
  jobName: string
  status: ExpectedJobStatus
  when?: string
}

/**
 * Internal scenario representation before converting to TestScenario
 */
export interface GeneratedScenario {
  description: string
  variables: Record<string, string | null>
  tags: string[]
  outcomes?: JobOutcome[]
}
