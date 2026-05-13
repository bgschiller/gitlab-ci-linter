import type { GitLabJob } from '../types'
import type { ProcessedConfig } from '../ProcessedConfig'
import type { EvaluationContext, EvaluationSummary, JobEvaluationResult } from './types'
import { evaluateModernRules, evaluateRule } from './modernRuleEvaluator.js'
import { evaluateLegacyConditions } from './legacyEvaluator.js'

/**
 * Expand variable references ($VAR or ${VAR}) in a string using the provided variables.
 */
function expandVariableReferences(value: string, variables: Record<string, string | null>): string {
  // YAML may parse rule variable values as numbers/booleans (e.g.
  // `KUBERNETES_CPU_REQUEST: 4`). $VAR substitution only makes sense for
  // strings — coerce non-strings to their string form so the declared
  // return type is honest. GitLab rule conditions compare via string
  // equality, so `4` and `"4"` behave identically in workflow rules.
  if (typeof value !== 'string') {
    return String(value)
  }
  return value.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (match, varName) => {
    if (Object.prototype.hasOwnProperty.call(variables, varName)) {
      return variables[varName] ?? ''
    }
    return match
  })
}

/**
 * Expand variable references in all values of a variables object.
 */
function expandWorkflowVariables(
  workflowVars: Record<string, string>,
  contextVars: Record<string, string | null>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(workflowVars)) {
    result[key] = expandVariableReferences(value, contextVars)
  }
  return result
}

/**
 * Evaluates GitLab CI job rules against a given context to determine
 * which jobs will run.
 */
export class RuleEvaluator {
  /**
   * Evaluate workflow rules and extract variables from the first matching rule.
   * GitLab CI workflow rules can set variables that job rules depend on.
   */
  static evaluateWorkflowVariables(
    config: ProcessedConfig,
    context: EvaluationContext,
  ): Record<string, string> {
    const workflow = config.getWorkflow()
    if (!workflow?.rules) return {}

    for (const rule of workflow.rules) {
      const result = evaluateRule(rule, context)
      if (result.matches && rule.variables) {
        // Expand variable references in workflow variables using context variables
        return expandWorkflowVariables(rule.variables, context.variables)
      }
    }
    return {}
  }

  /**
   * Evaluate all jobs in the configuration and return results.
   */
  static evaluateAllJobs(config: ProcessedConfig, context: EvaluationContext): EvaluationSummary {
    // Evaluate workflow rules and inject variables into context
    const workflowVars = this.evaluateWorkflowVariables(config, context)
    const enrichedContext: EvaluationContext = {
      ...context,
      variables: { ...context.variables, ...workflowVars },
    }

    const jobs = config.getJobs()

    const results = Object.entries(jobs)
      .filter(([jobName]) => !jobName.startsWith('.')) // Skip template jobs
      .map(([jobName, job]) => this.evaluateJob(jobName, job, enrichedContext))

    const sortedResults = this.sortByStageAndName(results, config.getStages())

    return {
      jobs: sortedResults.filter(r => r.willRun),
      skipped: sortedResults.filter(r => !r.willRun),
      totalJobs: sortedResults.length,
    }
  }

  /**
   * Evaluate a single job and return the result.
   */
  static evaluateJob(
    jobName: string,
    job: GitLabJob,
    context: EvaluationContext,
  ): JobEvaluationResult {
    const stage = job.stage || 'test'
    const baseResult = {
      name: jobName,
      stage,
      jobConfig: job,
    }

    // Check modern rules if present
    if (job.rules && job.rules.length > 0) {
      return evaluateModernRules(job, baseResult, context)
    }

    // Check legacy only/except if present
    if (job.only || job.except) {
      return evaluateLegacyConditions(job, baseResult, context)
    }

    // No conditions, job runs by default (unless when: never)
    const when = job.when || 'on_success'
    return {
      ...baseResult,
      willRun: when !== 'never',
      when,
    }
  }

  /**
   * Sort job results by stage order, then by name.
   * Jobs with unknown stages are placed at the end.
   */
  private static sortByStageAndName(
    results: JobEvaluationResult[],
    stages: string[],
  ): JobEvaluationResult[] {
    return [...results].sort((a, b) => {
      const stageIndexA = stages.indexOf(a.stage)
      const stageIndexB = stages.indexOf(b.stage)
      const effectiveIndexA = stageIndexA === -1 ? Infinity : stageIndexA
      const effectiveIndexB = stageIndexB === -1 ? Infinity : stageIndexB

      if (effectiveIndexA !== effectiveIndexB) {
        return effectiveIndexA - effectiveIndexB
      }
      return a.name.localeCompare(b.name)
    })
  }
}
