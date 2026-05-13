import { stringify } from 'yaml'
import type { ProcessedConfig } from '../ProcessedConfig'
import { ConditionParser } from '../condition-analysis/ConditionParser'
import { ScenarioGenerator } from '../condition-analysis/ScenarioGenerator'
import {
  type ParsedCondition,
  PIPELINE_CONTEXT_TEMPLATES,
  type VariableScenario,
} from '../condition-analysis/types'
import { RuleEvaluator } from '../rule-evaluation/RuleEvaluator'
import { extractChangesPatterns } from '../rule-evaluation/modernRuleEvaluator'
import type { EvaluationContext, JobEvaluationResult } from '../rule-evaluation/types'
import type {
  ChildPipelineAssertions,
  ExpectedJobStatus,
  TestAssertions,
  TestScenario,
} from '../test-runner/types'
import type { GitLabJob, GitLabRule } from '../types'
import type {
  ReprocessForScenario,
  ScenarioGenerationOptions,
  ScenarioGenerationResult,
} from './types'
import { ChildPipelineEvaluator, type ChildPipelineResult } from '../child-pipeline'

/**
 * Generates test scenarios from GitLab CI configurations.
 * Analyzes job rules to create comprehensive test coverage.
 */
export class TestScenarioGenerator {
  /**
   * Generate test scenarios for a processed GitLab CI configuration.
   * @param config - The processed configuration
   * @param options - Generation options
   * @returns Generated scenarios with metadata
   */
  static generate(
    config: ProcessedConfig,
    options: ScenarioGenerationOptions = {},
  ): ScenarioGenerationResult {
    const {
      maxScenarios = Infinity,
      targetJobs,
      includeAssertions = true,
      minimizeCoverage = false,
      pinnedVariables,
      changesSampleSuffix,
    } = options

    // Get all jobs or filter to target jobs
    const allJobs = config.getJobs()
    const jobsToAnalyze = this.filterJobs(allJobs, targetJobs)
    const jobNames = Object.keys(jobsToAnalyze)

    // Extract all conditions from job rules
    const conditions = this.extractConditionsFromJobs(jobsToAnalyze)

    // Generate variable scenarios using existing ScenarioGenerator
    let variableScenarios: VariableScenario[]
    if (conditions.length > 0) {
      variableScenarios = ScenarioGenerator.generateScenariosForConditions(conditions)
    } else {
      // No conditions found, generate basic scenarios
      variableScenarios = this.generateDefaultScenarios()
    }

    // Apply pinned variables: filter to matching scenarios and override values
    if (pinnedVariables && Object.keys(pinnedVariables).length > 0) {
      variableScenarios = this.applyPinnedVariables(variableScenarios, pinnedVariables)
    }

    // Extract changes patterns and merge with variable scenarios
    const changesPatterns = this.extractChangesFromJobs(jobsToAnalyze)
    if (changesPatterns.length > 0) {
      variableScenarios = this.mergeChangesWithVariableScenarios(
        variableScenarios,
        changesPatterns,
        jobsToAnalyze,
        changesSampleSuffix,
      )
    }

    // Limit scenarios if needed
    const totalBeforeLimit = variableScenarios.length
    let limitedScenarios = variableScenarios.slice(0, maxScenarios)
    const wasCapped = limitedScenarios.length === maxScenarios && totalBeforeLimit > maxScenarios

    // If minimize coverage is enabled, reduce to unique outcomes
    if (minimizeCoverage && limitedScenarios.length > 0) {
      limitedScenarios = this.minimizeToUniqueOutcomes(limitedScenarios, config, jobNames)
    }

    // Convert to TestScenarios with assertions
    const testScenarios = limitedScenarios.map(scenario =>
      this.convertToTestScenario(scenario, config, jobNames, includeAssertions),
    )

    // Collect all variables found
    const variablesFound = this.collectVariables(conditions)

    // Count unique outcomes
    const uniqueOutcomes = this.countUniqueOutcomes(testScenarios)

    return {
      scenarios: testScenarios,
      metadata: {
        totalJobsAnalyzed: jobNames.length,
        variablesFound,
        ...(changesPatterns.length > 0 && { changesFound: changesPatterns }),
        uniqueOutcomes,
        targetedJobs: jobNames,
        ...(wasCapped && { totalBeforeLimit }),
      },
    }
  }

  /**
   * Generate test scenarios with child pipeline support (async version).
   * This evaluates child pipelines and generates assertions for them.
   *
   * @param config - The processed configuration
   * @param options - Generation options including child pipeline settings
   * @returns Generated scenarios with child pipeline assertions
   */
  static async generateWithChildren(
    config: ProcessedConfig,
    options: ScenarioGenerationOptions = {},
  ): Promise<ScenarioGenerationResult> {
    const {
      maxScenarios = Infinity,
      targetJobs,
      includeAssertions = true,
      minimizeCoverage = false,
      includeChildren = false,
      baseDir,
      childOptions = {},
      pinnedVariables,
      reprocessForScenario,
      changesSampleSuffix,
    } = options

    // If neither child pipelines nor per-scenario reprocessing is requested,
    // delegate to the sync version (no async work needed).
    if ((!includeChildren || !baseDir) && !reprocessForScenario) {
      return this.generate(config, options)
    }

    const allJobs = config.getJobs()
    const jobsToAnalyze = this.filterJobs(allJobs, targetJobs)
    const jobNames = Object.keys(jobsToAnalyze)

    // Phase 1: build the initial variable-scenario list from parent job rules.
    const conditions = this.extractConditionsFromJobs(jobsToAnalyze)
    const changesPatterns = this.extractChangesFromJobs(jobsToAnalyze)
    const buildOpts = { pinnedVariables, maxScenarios, minimizeCoverage, changesSampleSuffix }
    let { variableScenarios, limitedScenarios } = this.buildVariableScenarioList(
      conditions,
      changesPatterns,
      jobsToAnalyze,
      config,
      jobNames,
      buildOpts,
    )

    // Phase 2: child-pipeline conditions/changes can expand the scenario set.
    const useChildren = includeChildren && !!baseDir
    const childEvaluator = useChildren
      ? new ChildPipelineEvaluator(
          baseDir,
          { evaluateChildren: true, maxDepth: childOptions.maxDepth },
          childOptions,
        )
      : null
    const {
      conditions: childConditions,
      patterns: childChangesPatterns,
      childJobs,
    } = childEvaluator
      ? await this.extractFromChildPipelines(allJobs, childEvaluator)
      : { conditions: [] as ParsedCondition[], patterns: [] as string[], childJobs: {} }

    if (childConditions.length > 0) {
      ;({ variableScenarios, limitedScenarios } = this.regenerateWithChildConditions({
        conditions,
        childConditions,
        changesPatterns,
        jobsToAnalyze,
        config,
        jobNames,
        ...buildOpts,
      }))
    }
    if (childChangesPatterns.length > 0) {
      ;({ variableScenarios, limitedScenarios } = this.appendChildChangesScenarios({
        variableScenarios,
        childChangesPatterns,
        childJobs,
        config,
        jobNames,
        ...buildOpts,
      }))
    }

    const totalBeforeLimit = variableScenarios.length
    const wasCapped = limitedScenarios.length === maxScenarios && totalBeforeLimit > maxScenarios

    // Phase 3: convert each variable-scenario to a TestScenario with assertions.
    const testScenarios = await this.convertScenariosToTests({
      limitedScenarios,
      config,
      jobNames,
      includeAssertions,
      childEvaluator,
      reprocessForScenario,
    })

    // Collect all variables found (parent + child)
    const allConditions =
      childConditions.length > 0 ? [...conditions, ...childConditions] : conditions
    const variablesFound = this.collectVariables(allConditions)

    // Count unique outcomes
    const uniqueOutcomes = this.countUniqueOutcomes(testScenarios)

    return {
      scenarios: testScenarios,
      metadata: {
        totalJobsAnalyzed: jobNames.length,
        variablesFound,
        ...((changesPatterns.length > 0 || childChangesPatterns.length > 0) && {
          changesFound: [...new Set([...changesPatterns, ...childChangesPatterns])].sort(),
        }),
        uniqueOutcomes,
        targetedJobs: jobNames,
        ...(wasCapped && { totalBeforeLimit }),
      },
    }
  }

  /**
   * Phase-1 helper: build the initial variable-scenario list from a set of
   * conditions (job rules), apply pinned-variable filtering, merge any
   * changes-based scenarios, limit to {@link ScenarioGenerationOptions.maxScenarios},
   * and (optionally) reduce to unique outcomes. Used by {@link generateWithChildren}
   * for the parent pass, and re-invoked by {@link regenerateWithChildConditions}
   * when child-pipeline conditions widen the variable space.
   */
  private static buildVariableScenarioList(
    conditions: ParsedCondition[],
    changesPatterns: string[],
    jobsToAnalyze: Record<string, GitLabJob>,
    config: ProcessedConfig,
    jobNames: string[],
    opts: {
      pinnedVariables?: Record<string, string>
      maxScenarios: number
      minimizeCoverage: boolean
      changesSampleSuffix?: string
    },
  ): { variableScenarios: VariableScenario[]; limitedScenarios: VariableScenario[] } {
    let variableScenarios: VariableScenario[] =
      conditions.length > 0
        ? ScenarioGenerator.generateScenariosForConditions(conditions)
        : this.generateDefaultScenarios()

    if (opts.pinnedVariables && Object.keys(opts.pinnedVariables).length > 0) {
      variableScenarios = this.applyPinnedVariables(variableScenarios, opts.pinnedVariables)
    }

    if (changesPatterns.length > 0) {
      variableScenarios = this.mergeChangesWithVariableScenarios(
        variableScenarios,
        changesPatterns,
        jobsToAnalyze,
        opts.changesSampleSuffix,
      )
    }

    let limitedScenarios = variableScenarios.slice(0, opts.maxScenarios)
    if (opts.minimizeCoverage && limitedScenarios.length > 0) {
      limitedScenarios = this.minimizeToUniqueOutcomes(limitedScenarios, config, jobNames)
    }
    return { variableScenarios, limitedScenarios }
  }

  /**
   * Phase-2a helper: when child pipelines contribute additional rule
   * conditions, merge them with the parent conditions and rebuild the
   * scenario list from scratch. Returns the regenerated full and limited
   * scenario arrays.
   */
  private static regenerateWithChildConditions(args: {
    conditions: ParsedCondition[]
    childConditions: ParsedCondition[]
    changesPatterns: string[]
    jobsToAnalyze: Record<string, GitLabJob>
    config: ProcessedConfig
    jobNames: string[]
    pinnedVariables?: Record<string, string>
    maxScenarios: number
    minimizeCoverage: boolean
    changesSampleSuffix?: string
  }): { variableScenarios: VariableScenario[]; limitedScenarios: VariableScenario[] } {
    const mergedConditions = [...args.conditions, ...args.childConditions]
    return this.buildVariableScenarioList(
      mergedConditions,
      args.changesPatterns,
      args.jobsToAnalyze,
      args.config,
      args.jobNames,
      {
        pinnedVariables: args.pinnedVariables,
        maxScenarios: args.maxScenarios,
        minimizeCoverage: args.minimizeCoverage,
        changesSampleSuffix: args.changesSampleSuffix,
      },
    )
  }

  /**
   * Phase-2b helper: child pipelines may declare changes-based rules that
   * spawn additional scenarios. Append them to the existing variable
   * scenarios, interleaving parent and child entries so {@link
   * ScenarioGenerationOptions.maxScenarios} doesn't drop the entire child
   * batch. Re-applies limit and minimize-coverage afterwards.
   */
  private static appendChildChangesScenarios(args: {
    variableScenarios: VariableScenario[]
    childChangesPatterns: string[]
    childJobs: Record<string, GitLabJob>
    config: ProcessedConfig
    jobNames: string[]
    maxScenarios: number
    minimizeCoverage: boolean
    changesSampleSuffix?: string
  }): { variableScenarios: VariableScenario[]; limitedScenarios: VariableScenario[] } {
    const parentCount = args.variableScenarios.length
    let variableScenarios = this.mergeChangesWithVariableScenarios(
      args.variableScenarios,
      args.childChangesPatterns,
      args.childJobs,
      args.changesSampleSuffix,
    )
    const childScenarios = variableScenarios.slice(parentCount)

    if (childScenarios.length > 0) {
      const parentScenarios = variableScenarios.slice(0, parentCount)
      const interleaved: VariableScenario[] = []
      const maxLen = Math.max(parentScenarios.length, childScenarios.length)
      for (let i = 0; i < maxLen; i++) {
        if (i < parentScenarios.length) interleaved.push(parentScenarios[i])
        if (i < childScenarios.length) interleaved.push(childScenarios[i])
      }
      variableScenarios = interleaved
    }

    let limitedScenarios = variableScenarios.slice(0, args.maxScenarios)
    if (args.minimizeCoverage && limitedScenarios.length > 0) {
      limitedScenarios = this.minimizeToUniqueOutcomes(limitedScenarios, args.config, args.jobNames)
    }
    return { variableScenarios, limitedScenarios }
  }

  /**
   * Phase-3 helper: convert each VariableScenario to a TestScenario with
   * assertions. Runs sequentially (not Promise.all) because
   * ChildPipelineEvaluator tracks `processedPaths` to detect circular
   * references — parallel runs would poison that state across scenarios.
   *
   * When `reprocessForScenario` is set, the config is re-resolved per
   * scenario so includes with `rules:` are honored against the scenario's
   * variables.
   */
  private static async convertScenariosToTests(args: {
    limitedScenarios: VariableScenario[]
    config: ProcessedConfig
    jobNames: string[]
    includeAssertions: boolean
    childEvaluator: ChildPipelineEvaluator | null
    reprocessForScenario?: ReprocessForScenario
  }): Promise<TestScenario[]> {
    const testScenarios: TestScenario[] = []
    for (const scenario of args.limitedScenarios) {
      const perScenarioConfig = args.reprocessForScenario
        ? await args.reprocessForScenario(this.buildEvaluationContext(scenario))
        : args.config

      const testScenario = args.childEvaluator
        ? await this.convertScenarioWithChildren(
            scenario,
            perScenarioConfig,
            args.jobNames,
            args.includeAssertions,
            args.childEvaluator,
          )
        : this.convertToTestScenario(
            scenario,
            perScenarioConfig,
            args.jobNames,
            args.includeAssertions,
          )
      testScenarios.push(testScenario)
    }
    return testScenarios
  }

  /** Reset the child evaluator before each conversion so per-scenario
   *  `processedPaths` state stays isolated. */
  private static async convertScenarioWithChildren(
    scenario: VariableScenario & { changes?: string[] },
    config: ProcessedConfig,
    jobNames: string[],
    includeAssertions: boolean,
    childEvaluator: ChildPipelineEvaluator,
  ): Promise<TestScenario> {
    childEvaluator.reset()
    return this.convertToTestScenarioWithChildren(
      scenario,
      config,
      jobNames,
      includeAssertions,
      childEvaluator,
    )
  }

  /**
   * Format scenarios as JSON or YAML string.
   * @param result - The generation result
   * @param format - Output format ('json' or 'yaml')
   * @returns Formatted string
   */
  static formatOutput(result: ScenarioGenerationResult, format: 'json' | 'yaml' = 'yaml'): string {
    if (format === 'json') {
      return JSON.stringify(result.scenarios, null, 2)
    }

    // YAML format with document separators
    return result.scenarios
      .map(scenario => {
        // Convert null values to string 'null' for YAML output display
        const yamlScenario = {
          description: scenario.description,
          variables: this.convertVariablesForYaml(scenario.variables),
          ...(scenario.changes && scenario.changes.length > 0 && { changes: scenario.changes }),
          ...(scenario.assertions && { assertions: scenario.assertions }),
        }
        return stringify(yamlScenario, {
          indent: 2,
          lineWidth: 0,
          minContentWidth: 0,
        }).trim()
      })
      .join('\n---\n')
  }

  /**
   * Generate a filename for a single scenario file.
   * Format: "01-main-branch-push.yaml" (zero-padded index + slugified description).
   *
   * @param scenario - The test scenario
   * @param index - Zero-based index of the scenario
   * @param format - Output format ('json' or 'yaml')
   * @returns Filename string
   */
  static formatScenarioFileName(
    scenario: TestScenario,
    index: number,
    format: 'json' | 'yaml' = 'yaml',
  ): string {
    const paddedIndex = String(index + 1).padStart(2, '0')
    const slug = this.slugify(scenario.description || `scenario-${index + 1}`)
    const ext = format === 'json' ? 'json' : 'yaml'
    return `${paddedIndex}-${slug}.${ext}`
  }

  /**
   * Format a single scenario as a YAML or JSON string.
   *
   * @param scenario - The test scenario
   * @param format - Output format ('json' or 'yaml')
   * @returns Formatted string for a single scenario
   */
  static formatSingleScenario(scenario: TestScenario, format: 'json' | 'yaml' = 'yaml'): string {
    if (format === 'json') {
      return JSON.stringify(scenario, null, 2)
    }

    const yamlScenario = {
      description: scenario.description,
      variables: this.convertVariablesForYaml(scenario.variables),
      ...(scenario.changes && scenario.changes.length > 0 && { changes: scenario.changes }),
      ...(scenario.assertions && { assertions: scenario.assertions }),
    }
    return stringify(yamlScenario, {
      indent: 2,
      lineWidth: 0,
      minContentWidth: 0,
    }).trim()
  }

  /**
   * Convert a text string to a URL/filename-friendly slug.
   */
  private static slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 60)
  }

  /**
   * Filter jobs based on target job list.
   */
  private static filterJobs(
    allJobs: Record<string, GitLabJob>,
    targetJobs?: string[],
  ): Record<string, GitLabJob> {
    if (!targetJobs || targetJobs.length === 0) {
      // Filter out template jobs (starting with .)
      const filtered: Record<string, GitLabJob> = {}
      for (const [name, job] of Object.entries(allJobs)) {
        if (!name.startsWith('.')) {
          filtered[name] = job
        }
      }
      return filtered
    }

    const filtered: Record<string, GitLabJob> = {}
    for (const name of targetJobs) {
      if (allJobs[name]) {
        filtered[name] = allJobs[name]
      }
    }
    return filtered
  }

  /**
   * Extract all parsed conditions from job rules.
   */
  private static extractConditionsFromJobs(jobs: Record<string, GitLabJob>): ParsedCondition[] {
    const conditions: ParsedCondition[] = []

    for (const job of Object.values(jobs)) {
      if (job.rules && Array.isArray(job.rules)) {
        for (const rule of job.rules) {
          if (rule.if && typeof rule.if === 'string') {
            try {
              const parsed = ConditionParser.parse(rule.if)
              conditions.push(parsed)
            } catch {
              // Skip unparseable conditions
            }
          }
        }
      }
    }

    return conditions
  }

  /**
   * Generate default scenarios when no conditions are found.
   * Uses PIPELINE_CONTEXT_TEMPLATES to ensure correct variable values per pipeline source.
   */
  private static generateDefaultScenarios(): VariableScenario[] {
    return PIPELINE_CONTEXT_TEMPLATES.map(template => ({
      variables: { ...template.variables },
      description: template.description,
      tags: [...template.tags],
    }))
  }

  /**
   * Apply pinned variables to generated scenarios.
   * Filters scenarios to only those where the pinned variable's value matches
   * (or the variable is absent/null), then overrides the variable value in all
   * remaining scenarios. This reduces the Cartesian product by fixing one dimension.
   *
   * After injecting pinned values, re-runs GitLab cross-variable constraints
   * because the injected value may invalidate other variables (e.g., pinning
   * CI_PIPELINE_SOURCE=merge_request_event requires CI_COMMIT_BRANCH=null).
   */
  private static applyPinnedVariables(
    scenarios: VariableScenario[],
    pinnedVariables: Record<string, string>,
  ): VariableScenario[] {
    let filtered = scenarios

    for (const [varName, pinnedValue] of Object.entries(pinnedVariables)) {
      filtered = filtered.filter(scenario => {
        const currentValue = scenario.variables[varName]
        // Keep scenarios where the variable matches the pinned value,
        // or where the variable is not set (null/undefined) so we can inject it
        return currentValue === pinnedValue || currentValue === null || currentValue === undefined
      })

      // Override the variable value in all remaining scenarios
      for (const scenario of filtered) {
        scenario.variables[varName] = pinnedValue
      }
    }

    // Re-enforce GitLab constraints after injecting pinned values.
    // Pinning may introduce combinations that weren't present during initial
    // generation (e.g., CI_PIPELINE_SOURCE was absent, now set to merge_request_event).
    for (const scenario of filtered) {
      ScenarioGenerator.enforceGitLabConstraints(scenario.variables)
    }

    // Deduplicate scenarios that became identical after pinning + constraint enforcement
    const seen = new Map<string, VariableScenario>()
    for (const scenario of filtered) {
      const key = JSON.stringify(scenario.variables)
      if (!seen.has(key)) {
        seen.set(key, scenario)
      }
    }

    return Array.from(seen.values())
  }

  /**
   * Minimize scenarios to only those with unique outcomes.
   */
  private static minimizeToUniqueOutcomes(
    scenarios: VariableScenario[],
    config: ProcessedConfig,
    jobNames: string[],
  ): VariableScenario[] {
    const seenOutcomes = new Set<string>()
    const uniqueScenarios: VariableScenario[] = []

    for (const scenario of scenarios) {
      const outcomeKey = this.computeOutcomeKey(scenario, config, jobNames)
      if (!seenOutcomes.has(outcomeKey)) {
        seenOutcomes.add(outcomeKey)
        uniqueScenarios.push(scenario)
      }
    }

    return uniqueScenarios
  }

  /**
   * Compute a unique key representing the job outcomes for a scenario.
   */
  private static computeOutcomeKey(
    scenario: VariableScenario & { changes?: string[] },
    config: ProcessedConfig,
    jobNames: string[],
  ): string {
    const context: EvaluationContext = {
      variables: this.convertVariablesForEvaluation(scenario.variables),
    }
    if (scenario.changes && scenario.changes.length > 0) {
      context.changes = scenario.changes
    }

    const evaluation = RuleEvaluator.evaluateAllJobs(config, context)

    // Build outcome key from job statuses
    const outcomes: string[] = []
    for (const jobName of jobNames.sort()) {
      const runningJob = evaluation.jobs.find(j => j.name === jobName)
      const skippedJob = evaluation.skipped.find(j => j.name === jobName)

      if (runningJob) {
        const status = runningJob.when === 'manual' ? 'manual' : 'automatic'
        outcomes.push(`${jobName}:${status}`)
      } else if (skippedJob) {
        outcomes.push(`${jobName}:skipped`)
      }
    }

    return outcomes.join('|')
  }

  /**
   * Convert a VariableScenario to a TestScenario with assertions.
   */
  /**
   * Build an EvaluationContext from a VariableScenario for use both by
   * include-rule evaluation (during config re-processing) and job-rule
   * evaluation (during assertion building). Keeping this single helper keeps
   * the two contexts in lockstep.
   */
  private static buildEvaluationContext(
    scenario: VariableScenario & { changes?: string[] },
  ): EvaluationContext {
    const variables = this.convertVariablesForEvaluation(scenario.variables)
    const context: EvaluationContext = { variables }
    if (scenario.changes && scenario.changes.length > 0) {
      context.changes = scenario.changes
    }
    return context
  }

  private static convertToTestScenario(
    scenario: VariableScenario & { changes?: string[] },
    config: ProcessedConfig,
    jobNames: string[],
    includeAssertions: boolean,
  ): TestScenario {
    const context = this.buildEvaluationContext(scenario)
    const variables = context.variables
    const evaluation = RuleEvaluator.evaluateAllJobs(config, context)

    const testScenario = {
      description: scenario.description,
      variables: variables as Record<string, string>,
      ...(scenario.changes && scenario.changes.length > 0 && { changes: scenario.changes }),
      assertions: { jobs: {}, counts: {} },
    } as TestScenario

    if (!includeAssertions) {
      delete (testScenario as Partial<TestScenario>).assertions
      return testScenario
    }

    // Build assertions from evaluation results
    const assertions: TestAssertions = {
      jobs: {},
      counts: {
        automatic: 0,
        manual: 0,
        skipped: 0,
      },
    }

    // Process jobs that will run
    for (const job of evaluation.jobs) {
      // Only include assertions for targeted jobs
      if (jobNames.includes(job.name)) {
        const status = this.getJobStatus(job)
        assertions.jobs![job.name] = status

        if (status === 'automatic') {
          assertions.counts!.automatic = (assertions.counts!.automatic || 0) + 1
        } else if (status === 'manual') {
          assertions.counts!.manual = (assertions.counts!.manual || 0) + 1
        }
      }
    }

    // Process skipped jobs
    for (const job of evaluation.skipped) {
      if (jobNames.includes(job.name)) {
        assertions.jobs![job.name] = 'skipped'
        assertions.counts!.skipped = (assertions.counts!.skipped || 0) + 1
      }
    }

    testScenario.assertions = assertions
    return testScenario
  }

  /**
   * Convert a VariableScenario to a TestScenario with child pipeline assertions.
   */
  private static async convertToTestScenarioWithChildren(
    scenario: VariableScenario & { changes?: string[] },
    config: ProcessedConfig,
    jobNames: string[],
    includeAssertions: boolean,
    childEvaluator: ChildPipelineEvaluator,
  ): Promise<TestScenario> {
    const context = this.buildEvaluationContext(scenario)
    const variables = context.variables

    // Evaluate with child pipelines
    const evaluation = await childEvaluator.evaluateWithChildren(config, context)

    const testScenario = {
      description: scenario.description,
      variables: variables as Record<string, string>,
      ...(scenario.changes && scenario.changes.length > 0 && { changes: scenario.changes }),
      assertions: { jobs: {}, counts: {} },
    } as TestScenario

    if (!includeAssertions) {
      delete (testScenario as Partial<TestScenario>).assertions
      return testScenario
    }

    // Build assertions from parent evaluation results
    const assertions: TestAssertions = {
      jobs: {},
      counts: {
        automatic: 0,
        manual: 0,
        skipped: 0,
      },
    }

    // Process parent jobs that will run
    for (const job of evaluation.jobs) {
      if (jobNames.includes(job.name)) {
        const status = this.getJobStatus(job)
        assertions.jobs![job.name] = status

        if (status === 'automatic') {
          assertions.counts!.automatic = (assertions.counts!.automatic || 0) + 1
        } else if (status === 'manual') {
          assertions.counts!.manual = (assertions.counts!.manual || 0) + 1
        }
      }
    }

    // Process parent skipped jobs
    for (const job of evaluation.skipped) {
      if (jobNames.includes(job.name)) {
        assertions.jobs![job.name] = 'skipped'
        assertions.counts!.skipped = (assertions.counts!.skipped || 0) + 1
      }
    }

    // Add child pipeline assertions
    if (evaluation.childPipelines && evaluation.childPipelines.length > 0) {
      assertions.childPipelines = this.generateChildPipelineAssertions(evaluation.childPipelines)
    }

    testScenario.assertions = assertions
    return testScenario
  }

  /**
   * Generate assertions for child pipelines recursively.
   */
  private static generateChildPipelineAssertions(
    childPipelines: ChildPipelineResult[],
  ): Record<string, ChildPipelineAssertions> {
    const childAssertions: Record<string, ChildPipelineAssertions> = {}

    for (const child of childPipelines) {
      // Skip child pipelines that had errors
      if (child.error) {
        continue
      }

      const assertions: ChildPipelineAssertions = {
        jobs: {},
        counts: {
          automatic: 0,
          manual: 0,
          skipped: 0,
          total: child.evaluation.totalJobs,
        },
      }

      // Process running jobs
      for (const job of child.evaluation.jobs) {
        const status = this.getJobStatus(job)
        assertions.jobs![job.name] = status

        if (status === 'automatic') {
          assertions.counts!.automatic = (assertions.counts!.automatic || 0) + 1
        } else if (status === 'manual') {
          assertions.counts!.manual = (assertions.counts!.manual || 0) + 1
        }
      }

      // Process skipped jobs
      for (const job of child.evaluation.skipped) {
        assertions.jobs![job.name] = 'skipped'
        assertions.counts!.skipped = (assertions.counts!.skipped || 0) + 1
      }

      // Recursively process grandchild pipelines
      if (child.children && child.children.length > 0) {
        assertions.childPipelines = this.generateChildPipelineAssertions(child.children)
      }

      childAssertions[child.triggerJobName] = assertions
    }

    return childAssertions
  }

  /**
   * Determine the status of a job from its evaluation result.
   */
  private static getJobStatus(job: JobEvaluationResult): ExpectedJobStatus {
    if (!job.willRun) {
      return 'skipped'
    }
    if (job.when === 'manual') {
      return 'manual'
    }
    return 'automatic'
  }

  /**
   * Convert variables for evaluation (shallow copy preserving null values).
   */
  private static convertVariablesForEvaluation(
    variables: Record<string, string | null>,
  ): Record<string, string | null> {
    const result: Record<string, string | null> = {}
    for (const [key, value] of Object.entries(variables)) {
      result[key] = value
    }
    return result
  }

  /**
   * Convert variables for YAML output (preserve null representation).
   */
  private static convertVariablesForYaml(
    variables: Record<string, string>,
  ): Record<string, string | null> {
    const result: Record<string, string | null> = {}
    for (const [key, value] of Object.entries(variables)) {
      // Convert empty strings or undefined back to null for display
      result[key] = value === '' ? null : value
    }
    return result
  }

  /**
   * Collect all unique variables from parsed conditions.
   */
  private static collectVariables(conditions: ParsedCondition[]): string[] {
    const variables = new Set<string>()
    for (const condition of conditions) {
      for (const variable of condition.variables) {
        variables.add(variable)
      }
    }
    return Array.from(variables).sort()
  }

  /**
   * Count unique outcome combinations across scenarios.
   */
  private static countUniqueOutcomes(scenarios: TestScenario[]): number {
    const outcomes = new Set<string>()
    for (const scenario of scenarios) {
      if (scenario.assertions?.jobs) {
        const key = Object.entries(scenario.assertions.jobs)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, status]) => `${name}:${status}`)
          .join('|')
        outcomes.add(key)
      }
    }
    return outcomes.size
  }

  /**
   * Extract all unique changes patterns from job rules.
   */
  private static extractChangesFromJobs(jobs: Record<string, GitLabJob>): string[] {
    const patterns = new Set<string>()
    for (const job of Object.values(jobs)) {
      if (job.rules && Array.isArray(job.rules)) {
        for (const rule of job.rules) {
          const rulePatterns = extractChangesPatterns(rule.changes)
          rulePatterns.forEach(p => patterns.add(p))
        }
      }
    }
    return Array.from(patterns).sort()
  }

  /**
   * Compute the job signature for a changes pattern: the set of (jobName, ruleIndex) pairs
   * where this pattern appears. Patterns with identical signatures are equivalent.
   */
  private static computeChangesSignature(pattern: string, jobs: Record<string, GitLabJob>): string {
    const pairs: string[] = []
    for (const [jobName, job] of Object.entries(jobs)) {
      if (job.rules && Array.isArray(job.rules)) {
        for (let ruleIdx = 0; ruleIdx < job.rules.length; ruleIdx++) {
          const rule = job.rules[ruleIdx] as GitLabRule
          const rulePatterns = extractChangesPatterns(rule.changes)
          if (rulePatterns.includes(pattern)) {
            pairs.push(`${jobName}:${ruleIdx}`)
          }
        }
      }
    }
    return pairs.sort().join('|')
  }

  /**
   * Compute equivalence classes of changes patterns based on their job signatures.
   * Returns one representative pattern per equivalence class.
   *
   * Representative selection: when multiple patterns share the same job-set
   * signature (they appear together in the same rules' `changes:` arrays),
   * the one listed FIRST in its source rule wins — that's the path the rule
   * author chose to lead with, typically the most-relevant primary path
   * (e.g., `server/src/main/**\/*` in a Java repo, not the alphabetically-
   * first `build-tools/**\/*`). Ties on position are broken alphabetically.
   *
   * Falls back to alphabetical when no position info is available (e.g.,
   * patterns from rules using `rule.changes` as an object, not an array).
   */
  private static computeChangesEquivalenceClasses(
    patterns: string[],
    jobs: Record<string, GitLabJob>,
  ): string[] {
    const firstPositions = this.computeFirstPositions(patterns, jobs)
    const signatureToPattern = new Map<string, string>()
    for (const pattern of patterns) {
      const signature = this.computeChangesSignature(pattern, jobs)
      const existing = signatureToPattern.get(signature)
      if (!existing) {
        signatureToPattern.set(signature, pattern)
        continue
      }
      // Already have a representative for this signature — replace if the new
      // candidate has a smaller first-position, tie-break alphabetically.
      const existingPos = firstPositions.get(existing) ?? Infinity
      const candidatePos = firstPositions.get(pattern) ?? Infinity
      const candidateWins =
        candidatePos < existingPos || (candidatePos === existingPos && pattern < existing)
      if (candidateWins) {
        signatureToPattern.set(signature, pattern)
      }
    }
    return Array.from(signatureToPattern.values())
  }

  /**
   * For each pattern, compute the smallest index it appears at across any
   * rule's `changes:` array. Used by {@link computeChangesEquivalenceClasses}
   * to prefer patterns that authors listed first in their rules. Patterns
   * never seen in an array-form `changes:` (e.g., only appear in object-form
   * `changes: {paths: ...}`) return undefined from the map; callers fall back
   * to alphabetical ordering for those.
   */
  private static computeFirstPositions(
    patterns: string[],
    jobs: Record<string, GitLabJob>,
  ): Map<string, number> {
    const positions = new Map<string, number>()
    const patternSet = new Set(patterns)
    for (const job of Object.values(jobs)) {
      if (!job.rules || !Array.isArray(job.rules)) continue
      for (const rule of job.rules) {
        this.recordPositionsFromRule(rule, patternSet, positions)
      }
    }
    return positions
  }

  /**
   * Walk one rule's `changes:` array and record the smallest position seen
   * for each known pattern into the running `positions` map. Object-form
   * `changes:` (non-array) is skipped — those patterns simply don't get
   * position info, which is the documented contract for
   * {@link computeFirstPositions}.
   */
  private static recordPositionsFromRule(
    rule: GitLabRule,
    patternSet: Set<string>,
    positions: Map<string, number>,
  ): void {
    const changes = rule.changes
    if (!Array.isArray(changes)) return
    for (let i = 0; i < changes.length; i++) {
      const entry = changes[i]
      if (typeof entry !== 'string' || !patternSet.has(entry)) continue
      const prev = positions.get(entry)
      if (prev === undefined || i < prev) {
        positions.set(entry, i)
      }
    }
  }

  /**
   * Default fallback suffix appended to a generic-glob prefix when no
   * special-case extension (.tf/.yml/.json/.md) matches. TypeScript-flavoured
   * by historical bias; consumers in non-TS repos can override via the
   * `--changes-sample-suffix` CLI flag (see {@link generateSamplePath}).
   */
  static readonly DEFAULT_CHANGES_SAMPLE_SUFFIX = 'src/index.ts'

  /**
   * Generate a realistic sample file path from a glob pattern.
   *
   * Extension-specific heuristics (.tf, .yml/.yaml, .json, .md) always
   * take precedence — they produce paths that respect the file type the
   * glob targets. For generic globs (e.g., `server/**\/*`), the
   * fallback appends `sampleSuffix` to the prefix (default
   * {@link DEFAULT_CHANGES_SAMPLE_SUFFIX}). Pass `--changes-sample-suffix`
   * on the CLI (or `changesSampleSuffix` in options) to override for
   * non-TypeScript repos.
   */
  static generateSamplePath(pattern: string, sampleSuffix?: string): string {
    // If pattern has no glob characters, it's already a literal file path
    if (!/[*?{[]/.test(pattern)) {
      return pattern
    }

    // Strip trailing glob segments to get the directory prefix
    const prefixMatch = pattern.match(/^([^*?{[]+?)(?:\/?\*\*\/?\*?|\/?\*|\/)$/)
    let prefix = prefixMatch ? (prefixMatch[1] ?? '') : pattern.replace(/\/?\*\*\/?\*?$/, '')
    // If prefix still contains glob characters, it's not a real directory prefix
    if (/[*?{[]/.test(prefix)) {
      prefix = ''
    }

    // Detect pattern type from prefix and full pattern
    const lowerPattern = pattern.toLowerCase()

    if (lowerPattern.includes('terraform') || lowerPattern.endsWith('.tf')) {
      return prefix ? `${prefix}/main.tf` : 'main.tf'
    }

    if (
      lowerPattern.endsWith('.yml') ||
      lowerPattern.endsWith('.yaml') ||
      lowerPattern.includes('.gitlab-ci')
    ) {
      if (prefix) {
        return `${prefix}/config.yml`
      }
      return '.gitlab-ci.yml'
    }

    if (lowerPattern.endsWith('.json')) {
      return prefix || 'config.json'
    }

    if (lowerPattern.endsWith('.md') || pattern === '*.md') {
      return 'README.md'
    }

    // Generic glob patterns: append the configurable suffix to the prefix
    const suffix = sampleSuffix ?? this.DEFAULT_CHANGES_SAMPLE_SUFFIX
    if (prefix) {
      // If prefix already looks like a file (has extension), return it
      if (/\.\w+$/.test(prefix)) {
        return prefix
      }
      return `${prefix}/${suffix}`
    }

    return suffix
  }

  /**
   * Determine which pipeline context tags are relevant for rules containing a given
   * changes pattern. Returns 'push' and/or 'merge-request' tags.
   */
  private static getPipelineContextsForPattern(
    pattern: string,
    jobs: Record<string, GitLabJob>,
  ): string[] {
    const contexts = new Set<string>()

    for (const job of Object.values(jobs)) {
      if (!job.rules || !Array.isArray(job.rules)) continue
      for (const rule of job.rules) {
        const rulePatterns = extractChangesPatterns(rule.changes)
        if (!rulePatterns.includes(pattern)) continue

        if (rule.if && typeof rule.if === 'string') {
          const ruleIf = rule.if
          if (ruleIf.includes('merge_request_event')) {
            contexts.add('merge-request')
          } else if (
            ruleIf.includes('push') ||
            ruleIf.includes('CI_COMMIT_BRANCH') ||
            ruleIf.includes('CI_DEFAULT_BRANCH')
          ) {
            contexts.add('push')
          }
        }

        // If no if condition, this changes rule applies to any pipeline source
        if (!rule.if) {
          contexts.add('push')
          contexts.add('merge-request')
        }
      }
    }

    // Default to both if we couldn't determine
    if (contexts.size === 0) {
      contexts.add('push')
      contexts.add('merge-request')
    }

    return Array.from(contexts)
  }

  /**
   * Extract conditions and changes patterns from child pipeline configs.
   * Loads each child pipeline referenced by trigger jobs and extracts both their
   * variable conditions (from `if:` rules) and changes patterns.
   * Returns conditions, patterns, and the merged child jobs map.
   */
  private static async extractFromChildPipelines(
    parentJobs: Record<string, GitLabJob>,
    childEvaluator: ChildPipelineEvaluator,
  ): Promise<{
    conditions: ParsedCondition[]
    patterns: string[]
    childJobs: Record<string, GitLabJob>
  }> {
    const allConditions: ParsedCondition[] = []
    const patterns = new Set<string>()
    const allChildJobs: Record<string, GitLabJob> = {}
    const parentJobNames = new Set(Object.keys(parentJobs))

    for (const [jobName, job] of Object.entries(parentJobs)) {
      if (jobName.startsWith('.')) continue
      if (!childEvaluator.isTriggerWithLocalInclude(job)) continue

      const localPath = childEvaluator.getLocalPath(job)
      if (!localPath) continue

      try {
        const childConfig = await childEvaluator.loadChildPipeline(localPath)
        if (!childConfig) continue

        const childJobs = childConfig.getJobs()
        const filteredChildJobs = this.filterJobs(childJobs)

        // Extract variable conditions from child pipeline job rules
        const childConditions = this.extractConditionsFromJobs(filteredChildJobs)
        allConditions.push(...childConditions)

        // Extract changes patterns from child pipeline job rules
        const childPatterns = this.extractChangesFromJobs(childJobs)
        childPatterns.forEach(p => patterns.add(p))

        // Only include actual child pipeline jobs, not trigger jobs that reference
        // other pipelines. Parent trigger jobs have broad changes: patterns that
        // would cause unrelated child patterns to collapse into one equivalence class.
        for (const [childJobName, childJob] of Object.entries(childJobs)) {
          if (parentJobNames.has(childJobName)) continue
          if (childJob['trigger']) continue
          allChildJobs[childJobName] = childJob
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(
          `Warning: Failed to extract from child pipeline '${localPath}' ` +
            `(trigger job: '${jobName}'): ${message}`,
        )
      }
    }

    return {
      conditions: allConditions,
      patterns: Array.from(patterns).sort(),
      childJobs: allChildJobs,
    }
  }

  /**
   * Merge changes-based scenarios with variable scenarios using smart pairing.
   * For each equivalence class representative, pairs with the most relevant
   * variable scenario (MR or push context) instead of Cartesian product.
   */
  private static mergeChangesWithVariableScenarios(
    variableScenarios: VariableScenario[],
    allPatterns: string[],
    jobs: Record<string, GitLabJob>,
    sampleSuffix?: string,
  ): (VariableScenario & { changes?: string[] })[] {
    const representatives = this.computeChangesEquivalenceClasses(allPatterns, jobs)
    const result: (VariableScenario & { changes?: string[] })[] = [...variableScenarios]

    // Find the best variable scenario for each pipeline context type
    const findBestScenario = (tag: string): VariableScenario | undefined => {
      // First try from generated scenarios
      const fromGenerated = variableScenarios.find(s => s.tags?.includes(tag))
      if (fromGenerated) return fromGenerated

      // Fallback to templates
      const template = PIPELINE_CONTEXT_TEMPLATES.find(t => t.tags.includes(tag))
      if (template) {
        return {
          variables: { ...template.variables },
          description: template.description,
          tags: [...template.tags],
        }
      }
      return variableScenarios[0]
    }

    const pushScenario = findBestScenario('push')
    const mrScenario = findBestScenario('merge-request')

    for (const pattern of representatives) {
      const samplePath = this.generateSamplePath(pattern, sampleSuffix)
      const contexts = this.getPipelineContextsForPattern(pattern, jobs)

      for (const ctx of contexts) {
        const baseScenario = ctx === 'merge-request' ? mrScenario : pushScenario
        if (!baseScenario) continue

        // Check if an identical scenario already exists (same variables + changes)
        const changesFiles = [samplePath]
        const key = JSON.stringify({ v: baseScenario.variables, c: changesFiles })
        const alreadyExists = result.some(
          s => JSON.stringify({ v: s.variables, c: s.changes }) === key,
        )
        if (alreadyExists) continue

        const contextLabel = ctx === 'merge-request' ? 'MR' : 'push'
        const shortPattern = pattern.length > 40 ? `${pattern.substring(0, 37)}...` : pattern
        result.push({
          variables: { ...baseScenario.variables },
          description: `${baseScenario.description} (changes: ${shortPattern}, ${contextLabel})`,
          tags: [...(baseScenario.tags || []), 'changes'],
          changes: changesFiles,
        })
      }
    }

    return result
  }
}
