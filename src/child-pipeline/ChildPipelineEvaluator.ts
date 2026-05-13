import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { GitLabJob } from '../types'
import type {
  EvaluationContext,
  EvaluationSummary,
  JobEvaluationResult,
} from '../rule-evaluation/types'
import type { ProcessedConfig } from '../ProcessedConfig'
import { ConfigProcessor } from '../processors/ConfigProcessor'
import { RuleEvaluator } from '../rule-evaluation/RuleEvaluator'
import { Linter, type LinterOptions } from '../linter'
import type {
  ChildPipelineOptions,
  ChildPipelineResult,
  EvaluationSummaryWithChildren,
  LintIssueWithSource,
  TriggerJobInfo,
} from './types'

/** Default maximum depth for child pipeline nesting (matching GitLab's limit) */
const DEFAULT_MAX_DEPTH = 2

/**
 * Evaluates child pipelines triggered via `trigger.include.local`.
 * Supports recursive evaluation up to 2 levels deep (parent -> child -> grandchild).
 */
export class ChildPipelineEvaluator {
  private processedPaths: Set<string> = new Set()
  private linterOptions: LinterOptions

  constructor(
    private baseDir: string,
    private options: ChildPipelineOptions = {},
    linterOptions: LinterOptions = {},
  ) {
    this.linterOptions = linterOptions
  }

  /**
   * Check if a job is a trigger job with a local include.
   */
  isTriggerWithLocalInclude(job: GitLabJob): boolean {
    if (!job['trigger']) {
      return false
    }

    const trigger = job['trigger']

    // Handle object-style trigger
    if (typeof trigger === 'object' && trigger !== null) {
      const include = trigger.include

      // Handle array of includes
      if (Array.isArray(include)) {
        return include.some(
          inc =>
            typeof inc === 'object' &&
            inc !== null &&
            'local' in inc &&
            typeof inc.local === 'string',
        )
      }

      // Handle single include object
      if (typeof include === 'object' && include !== null && 'local' in include) {
        return typeof include.local === 'string'
      }

      // Handle string include (shorthand for local)
      if (typeof include === 'string') {
        return true
      }
    }

    return false
  }

  /**
   * Extract the local path from a trigger job.
   */
  getLocalPath(job: GitLabJob): string | null {
    const trigger = job['trigger']
    if (typeof trigger !== 'object' || trigger === null) {
      return null
    }

    const include = trigger.include

    // Handle string include (shorthand for local)
    if (typeof include === 'string') {
      return include
    }

    // Handle array of includes (return first local one)
    if (Array.isArray(include)) {
      for (const inc of include) {
        if (
          typeof inc === 'object' &&
          inc !== null &&
          'local' in inc &&
          typeof inc.local === 'string'
        ) {
          return inc.local
        }
      }
      return null
    }

    // Handle single include object
    if (typeof include === 'object' && include !== null && 'local' in include) {
      return typeof include.local === 'string' ? include.local : null
    }

    return null
  }

  /**
   * Detect all trigger jobs with local includes in a configuration.
   */
  detectTriggerJobs(
    config: ProcessedConfig,
    evaluationResults: EvaluationSummary,
  ): TriggerJobInfo[] {
    const triggerJobs: TriggerJobInfo[] = []
    const jobs = config.getJobs()

    // Build a map of job evaluation results
    const jobResultMap = new Map<string, JobEvaluationResult>()
    for (const job of [...evaluationResults.jobs, ...evaluationResults.skipped]) {
      jobResultMap.set(job.name, job)
    }

    for (const [jobName, job] of Object.entries(jobs)) {
      // Skip template jobs
      if (jobName.startsWith('.')) {
        continue
      }

      if (this.isTriggerWithLocalInclude(job)) {
        const localPath = this.getLocalPath(job)
        if (localPath) {
          const evalResult = jobResultMap.get(jobName)
          const trigger = job['trigger'] as {
            forward?: { pipeline_variables?: boolean; yaml_variables?: boolean }
          }

          triggerJobs.push({
            jobName,
            job,
            localPath,
            willRun: evalResult?.willRun ?? false,
            forward: trigger.forward,
            jobVariables: job.variables,
            matchedRuleVariables: evalResult?.matchedRule?.variables,
          })
        }
      }
    }

    return triggerJobs
  }

  /**
   * Expand variable references in a string using the provided variables context.
   * Handles both $VAR and ${VAR} syntax.
   */
  private expandVariableValue(
    value: string | null | undefined,
    variables: Record<string, string | null>,
  ): string | null {
    if (value === null || value === undefined) {
      return null
    }
    // YAML may parse trigger-job variable values as numbers/booleans (e.g.
    // `KUBERNETES_CPU_REQUEST: 4`). $VAR substitution only makes sense for
    // strings — coerce non-strings to their string form so the function's
    // declared return type is honest, and so downstream rule evaluators
    // (which compare via string equality) keep working.
    if (typeof value !== 'string') {
      return String(value)
    }
    return value.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (match, varName) => {
      const resolved = variables[varName]
      return resolved !== undefined && resolved !== null ? resolved : match
    })
  }

  /**
   * Build evaluation context for a child pipeline.
   * Handles variable forwarding according to GitLab's behavior.
   */
  buildChildContext(
    parentContext: EvaluationContext,
    triggerJob: TriggerJobInfo,
    parentVariables: Record<string, string>,
  ): EvaluationContext {
    const childVariables: Record<string, string | null> = {}

    // 1. Forward pipeline variables if enabled (defaults to false in GitLab)
    if (triggerJob.forward?.pipeline_variables === true) {
      // Copy parent context variables
      for (const [key, value] of Object.entries(parentContext.variables)) {
        childVariables[key] = value
      }
    }

    // 2. Forward config-level variables if yaml_variables is not explicitly false
    // (yaml_variables defaults to true in GitLab)
    if (triggerJob.forward?.yaml_variables !== false) {
      for (const [key, value] of Object.entries(parentVariables)) {
        childVariables[key] = value
      }
    }

    // 3. Apply trigger job's own variables (these override forwarded variables)
    // Expand variable references against the current context BEFORE overwriting CI_PIPELINE_SOURCE
    // This ensures $CI_PIPELINE_SOURCE in job variables resolves to the parent's value
    if (triggerJob.jobVariables) {
      // Build expansion context: parent context + already-set child variables
      const expansionContext: Record<string, string | null> = {
        ...parentContext.variables,
        ...childVariables,
      }
      for (const [key, value] of Object.entries(triggerJob.jobVariables)) {
        childVariables[key] = this.expandVariableValue(value, expansionContext)
      }
    }

    // 4. Apply per-rule variables from the matched rule (these override job-level variables)
    // In GitLab, when a trigger job's rule matches, that rule's variables take highest precedence.
    // Example: rules: [{ if: '$PIPELINE_TYPE == "MAIN"', variables: { TARGET_CONTEXT: main } }]
    if (triggerJob.matchedRuleVariables) {
      const expansionContext: Record<string, string | null> = {
        ...parentContext.variables,
        ...childVariables,
      }
      for (const [key, value] of Object.entries(triggerJob.matchedRuleVariables)) {
        childVariables[key] = this.expandVariableValue(value, expansionContext)
      }
    }

    // 5. Override CI_PIPELINE_SOURCE to 'parent_pipeline'
    childVariables['CI_PIPELINE_SOURCE'] = 'parent_pipeline'

    return {
      variables: childVariables,
      changes: parentContext.changes,
      exists: parentContext.exists,
    }
  }

  /**
   * Load and process a child pipeline configuration.
   */
  async loadChildPipeline(localPath: string): Promise<ProcessedConfig | null> {
    // GitLab's `trigger.include.local: '/path'` is repo-root-relative, NOT a
    // filesystem absolute path. node:path.resolve treats a leading `/` as
    // absolute and discards baseDir, so strip the leading slash.
    const repoRelativePath = localPath.startsWith('/') ? localPath.slice(1) : localPath
    const resolvedPath = resolve(this.baseDir, repoRelativePath)

    // Check for circular references
    if (this.processedPaths.has(resolvedPath)) {
      console.warn(`Warning: Circular child pipeline reference detected: ${resolvedPath}`)
      return null
    }

    if (!existsSync(resolvedPath)) {
      console.warn(`Warning: Child pipeline config not found: ${resolvedPath}`)
      return null
    }

    try {
      const content = readFileSync(resolvedPath, 'utf8')
      const processor = new ConfigProcessor(content, resolvedPath, {
        rootDir: this.baseDir,
      })

      this.processedPaths.add(resolvedPath)
      return await processor.process()
    } catch (error) {
      console.warn(`Warning: Failed to process child pipeline ${resolvedPath}: ${error}`)
      return null
    }
  }

  /**
   * Evaluate child pipelines for a parent configuration.
   */
  async evaluateChildPipelines(
    parentConfig: ProcessedConfig,
    parentEvaluation: EvaluationSummary,
    parentContext: EvaluationContext,
    depth = 1,
  ): Promise<ChildPipelineResult[]> {
    const maxDepth = this.options.maxDepth ?? DEFAULT_MAX_DEPTH

    if (depth > maxDepth) {
      return []
    }

    const triggerJobs = this.detectTriggerJobs(parentConfig, parentEvaluation)
    const results: ChildPipelineResult[] = []
    const parentVariables = parentConfig.getVariables()

    for (const triggerJob of triggerJobs) {
      // Skip trigger jobs that won't run
      if (!triggerJob.willRun) {
        continue
      }

      const childResult = await this.evaluateSingleChildPipeline(
        triggerJob,
        parentContext,
        parentVariables,
        depth,
      )

      if (childResult) {
        results.push(childResult)
      }
    }

    return results
  }

  /**
   * Evaluate a single child pipeline.
   */
  private async evaluateSingleChildPipeline(
    triggerJob: TriggerJobInfo,
    parentContext: EvaluationContext,
    parentVariables: Record<string, string>,
    depth: number,
  ): Promise<ChildPipelineResult | null> {
    const maxDepth = this.options.maxDepth ?? DEFAULT_MAX_DEPTH

    // Load the child pipeline config
    const childConfig = await this.loadChildPipeline(triggerJob.localPath)

    if (!childConfig) {
      return {
        configPath: triggerJob.localPath,
        triggerJobName: triggerJob.jobName,
        evaluation: { jobs: [], skipped: [], totalJobs: 0 },
        lintIssues: [],
        depth,
        error: `Failed to load child pipeline: ${triggerJob.localPath}`,
      }
    }

    // Build child context
    const childContext = this.buildChildContext(parentContext, triggerJob, parentVariables)

    // Evaluate child jobs
    const childEvaluation = RuleEvaluator.evaluateAllJobs(childConfig, childContext)

    // Lint the child pipeline
    const linter = new Linter(this.linterOptions)
    const rawLintIssues = linter.lint(childConfig)
    const lintIssues: LintIssueWithSource[] = rawLintIssues.map(issue => ({
      ...issue,
      source: triggerJob.localPath,
      depth,
    }))

    // Recursively evaluate grandchildren
    let children: ChildPipelineResult[] | undefined
    if (depth < maxDepth) {
      children = await this.evaluateChildPipelines(
        childConfig,
        childEvaluation,
        childContext,
        depth + 1,
      )
      if (children.length === 0) {
        children = undefined
      }
    }

    return {
      configPath: triggerJob.localPath,
      triggerJobName: triggerJob.jobName,
      evaluation: childEvaluation,
      lintIssues,
      children,
      depth,
    }
  }

  /**
   * Evaluate all jobs including child pipelines and return extended summary.
   */
  async evaluateWithChildren(
    config: ProcessedConfig,
    context: EvaluationContext,
  ): Promise<EvaluationSummaryWithChildren> {
    // First evaluate the parent pipeline
    const parentEvaluation = RuleEvaluator.evaluateAllJobs(config, context)

    if (this.options.evaluateChildren === false) {
      return parentEvaluation
    }

    // Enrich context with workflow variables for child pipeline evaluation
    // This ensures parent workflow variables are forwarded to children when pipeline_variables is true
    const workflowVars = RuleEvaluator.evaluateWorkflowVariables(config, context)
    const enrichedContext: EvaluationContext = {
      ...context,
      variables: { ...context.variables, ...workflowVars },
    }

    // Then evaluate child pipelines with the enriched context
    const childPipelines = await this.evaluateChildPipelines(
      config,
      parentEvaluation,
      enrichedContext,
    )

    return {
      ...parentEvaluation,
      childPipelines: childPipelines.length > 0 ? childPipelines : undefined,
    }
  }

  /**
   * Discover and lint all child pipelines referenced via `trigger.include.local`,
   * unconditionally (no evaluation context needed).
   * Iterates over all jobs in the config, loads each child pipeline, lints it,
   * and recurses up to maxDepth.
   */
  async lintAllChildren(config: ProcessedConfig, depth: number): Promise<LintIssueWithSource[]> {
    const maxDepth = this.options.maxDepth ?? DEFAULT_MAX_DEPTH
    if (depth > maxDepth) {
      return []
    }

    const issues: LintIssueWithSource[] = []
    const jobs = config.getJobs()

    for (const [jobName, job] of Object.entries(jobs)) {
      if (jobName.startsWith('.')) {
        continue
      }

      if (!this.isTriggerWithLocalInclude(job)) {
        continue
      }

      const localPath = this.getLocalPath(job)
      if (!localPath) {
        continue
      }

      const childConfig = await this.loadChildPipeline(localPath)
      if (!childConfig) {
        continue
      }

      const linter = new Linter(this.linterOptions)
      const childIssues = linter.lint(childConfig)
      issues.push(
        ...childIssues.map(issue => ({
          ...issue,
          source: localPath,
          depth,
        })),
      )

      // Recurse into grandchildren
      const nestedIssues = await this.lintAllChildren(childConfig, depth + 1)
      issues.push(...nestedIssues)
    }

    return issues
  }

  /**
   * Lint all pipelines including children and return aggregated issues.
   */
  async lintWithChildren(
    config: ProcessedConfig,
    context?: EvaluationContext,
  ): Promise<LintIssueWithSource[]> {
    const allIssues: LintIssueWithSource[] = []

    // Lint the parent pipeline
    const linter = new Linter(this.linterOptions)
    const parentIssues = linter.lint(config)
    allIssues.push(
      ...parentIssues.map(issue => ({
        ...issue,
        source: 'parent',
        depth: 0,
      })),
    )

    if (this.options.evaluateChildren === false) {
      return allIssues
    }

    if (context) {
      // Context-aware path: evaluate which children will actually run
      const parentEvaluation = RuleEvaluator.evaluateAllJobs(config, context)

      // Enrich context with workflow variables for child pipeline evaluation
      const workflowVars = RuleEvaluator.evaluateWorkflowVariables(config, context)
      const enrichedContext: EvaluationContext = {
        ...context,
        variables: { ...context.variables, ...workflowVars },
      }

      const childPipelines = await this.evaluateChildPipelines(
        config,
        parentEvaluation,
        enrichedContext,
      )

      // Collect lint issues from all children
      const collectChildIssues = (children: ChildPipelineResult[]): void => {
        for (const child of children) {
          allIssues.push(...child.lintIssues)
          if (child.children) {
            collectChildIssues(child.children)
          }
        }
      }

      collectChildIssues(childPipelines)
    } else {
      // No context: unconditionally lint all children
      allIssues.push(...(await this.lintAllChildren(config, 1)))
    }

    return allIssues
  }

  /**
   * Reset the processed paths tracker (useful for multiple independent evaluations).
   */
  reset(): void {
    this.processedPaths.clear()
  }
}
