import { dirname } from 'path'
import { stringify } from 'yaml'
import { ConfigProcessor, type ConfigProcessorOptions } from './processors/ConfigProcessor'
import { RemoteConfigProcessor } from './processors/RemoteConfigProcessor'
import { Linter, type LinterOptions } from './linter'
import { type EvaluationContext, RuleEvaluator } from './rule-evaluation'
import {
  type ScenarioGenerationOptions,
  type ScenarioGenerationResult,
  TestScenarioGenerator,
} from './scenario-generator'
import { type TestResult, TestRunner, type TestScenario } from './test-runner'
import type { LintIssue } from './types'
import type { GitLabRemoteSource } from './GitLabRemoteSource'
import {
  ChildPipelineEvaluator,
  type ChildPipelineOptions,
  type EvaluationSummaryWithChildren,
  type LintIssueWithSource,
} from './child-pipeline'

export interface GitLabCILinterOptions
  extends LinterOptions,
    ConfigProcessorOptions,
    ChildPipelineOptions {}

/**
 * Main GitLab CI Linter class that provides a unified interface
 * for processing and linting GitLab CI configurations.
 *
 * This is a thin wrapper around ConfigProcessor and Linter classes
 * that maintains backward compatibility with the original API.
 */
export class GitLabCILinter {
  private processor: ConfigProcessor | RemoteConfigProcessor
  private linter: Linter
  private options: GitLabCILinterOptions
  private baseDir: string | null = null

  constructor(content: string, filePath: string, options?: GitLabCILinterOptions)
  constructor(remoteSource: GitLabRemoteSource, options?: GitLabCILinterOptions)
  constructor(
    contentOrRemoteSource: string | GitLabRemoteSource,
    filePathOrOptions?: string | GitLabCILinterOptions,
    options?: GitLabCILinterOptions,
  ) {
    if (typeof contentOrRemoteSource === 'string') {
      // Traditional local file usage
      const filePath = filePathOrOptions as string
      this.processor = new ConfigProcessor(contentOrRemoteSource, filePath, {
        rootDir: options?.rootDir,
        gitlabHost: options?.gitlabHost,
      })
      this.linter = new Linter(options)
      this.options = options || {}
      // Store base directory for child pipeline resolution
      this.baseDir = options?.rootDir || dirname(filePath)
    } else {
      // Remote GitLab source usage
      const remoteOptions = filePathOrOptions as GitLabCILinterOptions | undefined
      this.processor = new RemoteConfigProcessor(contentOrRemoteSource, remoteOptions?.gitlabHost)
      this.linter = new Linter(remoteOptions)
      this.options = remoteOptions || {}
    }
  }

  /**
   * Create a GitLabCILinter from a remote GitLab source
   */
  static fromRemoteSource(
    remoteSource: GitLabRemoteSource,
    options?: LinterOptions,
  ): GitLabCILinter {
    return new GitLabCILinter(remoteSource, options)
  }

  /**
   * Process the GitLab CI configuration and run all lint rules.
   * To also lint child pipelines, use lintWithChildren() instead.
   *
   * @returns Promise resolving to array of lint issues
   */
  async lint(): Promise<LintIssue[]> {
    const processedConfig = await this.processor.process()
    return this.linter.lint(processedConfig)
  }

  /**
   * Process the GitLab CI configuration and run all lint rules,
   * including child pipelines triggered via `trigger.include.local`.
   *
   * @param context - Optional evaluation context for determining which child pipelines will run
   * @returns Promise resolving to array of lint issues with source tracking
   */
  async lintWithChildren(context?: EvaluationContext): Promise<LintIssueWithSource[]> {
    const processedConfig = await this.processor.process()

    if (!this.baseDir) {
      // No base directory (remote source), fall back to regular linting
      return this.linter.lint(processedConfig).map(issue => ({
        ...issue,
        source: 'parent',
        depth: 0,
      }))
    }

    const childEvaluator = new ChildPipelineEvaluator(
      this.baseDir,
      {
        evaluateChildren: this.options.evaluateChildren ?? true,
        maxDepth: this.options.maxDepth,
      },
      this.options,
    )

    return childEvaluator.lintWithChildren(processedConfig, context)
  }

  /**
   * Process the GitLab CI configuration and return flattened YAML
   * @param jobName - Optional job name to flatten only that specific job
   * @returns Promise resolving to flattened YAML string
   */
  async flatten(jobName?: string): Promise<string> {
    const processedConfig = await this.processor.process()

    // Create a clean copy of the config for flattening
    const config = processedConfig.config
    const flattened = { ...config }

    // Remove processing artifacts that shouldn't appear in flattened output
    delete flattened.include

    // Remove template jobs (starting with .) from flattened output
    Object.keys(flattened).forEach(key => {
      if (key.startsWith('.') && typeof flattened[key] === 'object' && flattened[key] !== null) {
        // Remove all template jobs from flattened output
        delete flattened[key]
      }
    })

    // Clean up extends references from all jobs since they've been resolved
    Object.keys(flattened).forEach(key => {
      if (typeof flattened[key] === 'object' && flattened[key] !== null) {
        delete flattened[key].extends
      }
    })

    // If a specific job name is requested, filter to only that job
    if (jobName) {
      // Get list of available job names (non-keyword keys that are objects)
      const gitlabKeywords = [
        'stages',
        'variables',
        'default',
        'workflow',
        'image',
        'services',
        'cache',
        'before_script',
        'after_script',
      ]
      const availableJobs = Object.keys(flattened).filter(
        key =>
          !gitlabKeywords.includes(key) &&
          typeof flattened[key] === 'object' &&
          flattened[key] !== null,
      )

      if (!availableJobs.includes(jobName)) {
        const availableJobsStr = availableJobs.length > 0 ? availableJobs.join(', ') : '(none)'
        throw new Error(`Job '${jobName}' not found. Available jobs: ${availableJobsStr}`)
      }

      // Return only the requested job
      return stringify(
        { [jobName]: flattened[jobName] },
        {
          indent: 2,
          lineWidth: 0,
          minContentWidth: 0,
        },
      )
    }

    return stringify(flattened, {
      indent: 2,
      lineWidth: 0, // Disable line wrapping
      minContentWidth: 0,
    })
  }

  /**
   * Get list of available lint rules
   * @returns Array of rule names
   */
  getAvailableRules(): string[] {
    return this.linter.getAvailableRules()
  }

  /**
   * Evaluate job rules against a given context to determine which jobs will run.
   * When includeChildren is true (default), also evaluates child pipelines
   * triggered via `trigger.include.local`.
   *
   * @param context - Environment variables, changed files, and existing files
   * @param includeChildren - Whether to evaluate child pipelines (default: true for local files)
   * @returns Promise resolving to evaluation summary with jobs that will run/be skipped
   */
  async evaluate(
    context: EvaluationContext,
    includeChildren?: boolean,
  ): Promise<EvaluationSummaryWithChildren> {
    // Pass the same context to processing so includes with `rules:` are
    // evaluated against the caller's variables/changes — otherwise the
    // returned job set silently over-includes jobs from non-matching
    // conditional includes.
    const processedConfig = await this.processor.process(context)

    // Determine if we should evaluate children
    // Default to true for local files, false for remote
    const shouldEvaluateChildren =
      includeChildren ?? this.options.evaluateChildren ?? this.baseDir !== null

    if (shouldEvaluateChildren && this.baseDir) {
      const childEvaluator = new ChildPipelineEvaluator(
        this.baseDir,
        {
          evaluateChildren: true,
          maxDepth: this.options.maxDepth,
        },
        this.options,
      )

      return childEvaluator.evaluateWithChildren(processedConfig, context)
    }

    // Fallback to regular evaluation without children
    return RuleEvaluator.evaluateAllJobs(processedConfig, context)
  }

  /**
   * Run a test scenario against the configuration and check assertions.
   * When includeChildren is true (default for local files), also evaluates
   * child pipelines for accurate job counts.
   *
   * @param scenario - Test scenario with variables, changes, and assertions
   * @param includeChildren - Whether to include child pipelines in evaluation
   * @returns Promise resolving to test result with assertion outcomes
   */
  async test(scenario: TestScenario, includeChildren?: boolean): Promise<TestResult> {
    // Process with this scenario's variables so include-rule evaluation can
    // skip includes whose `rules:` don't match the scenario's context.
    const scenarioContext: EvaluationContext = {
      variables: scenario.variables,
      changes: scenario.changes,
    }
    const processedConfig = await this.processor.process(scenarioContext)

    // Determine if we should evaluate children
    const shouldEvaluateChildren =
      includeChildren ?? this.options.evaluateChildren ?? this.baseDir !== null

    if (shouldEvaluateChildren && this.baseDir) {
      return TestRunner.runTestWithChildren(scenario, processedConfig, this.baseDir, this.options)
    }

    return TestRunner.runTest(scenario, processedConfig)
  }

  /**
   * Generate test scenarios from the configuration.
   * When includeChildren is true and baseDir is available, child pipeline
   * assertions will be generated using the new format.
   *
   * @param options - Scenario generation options
   * @returns Promise resolving to generated scenarios with metadata
   */
  async generateScenarios(options?: ScenarioGenerationOptions): Promise<ScenarioGenerationResult> {
    const initialConfig = await this.processor.process()

    // Re-process the config per scenario so includes with `rules:` are
    // evaluated against each scenario's variables. The remote-content cache in
    // IncludeResolver is per-process and persists across these calls, so we
    // don't refetch component templates per scenario — only local includes
    // get re-walked.
    const reprocessForScenario = (ctx: EvaluationContext) => this.processor.process(ctx)

    if (options?.includeChildren && this.baseDir) {
      return TestScenarioGenerator.generateWithChildren(initialConfig, {
        ...options,
        baseDir: this.baseDir,
        childOptions: this.options,
        reprocessForScenario,
      })
    }

    return TestScenarioGenerator.generateWithChildren(initialConfig, {
      ...options,
      reprocessForScenario,
    })
  }
}
