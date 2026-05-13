import type { GitLabJob, GitLabRule, LintIssue, PipelineContext } from '../types'
import type { ProcessedConfig } from '../ProcessedConfig'
import { ConditionParser } from '../condition-analysis/ConditionParser.js'
import { ConditionEvaluator } from '../condition-analysis/ConditionEvaluator.js'
import { ScenarioGenerator } from '../condition-analysis/ScenarioGenerator.js'
import type { ParsedCondition, VariableScenario } from '../condition-analysis/types.js'

interface DependencyAnalysis {
  dependentJob: string
  dependencyJob: string
  dependentJobObject: GitLabJob
  dependencyJobObject: GitLabJob
  problematicScenarios: Array<{ scenario: string; changes: string[] }>
  conditionAnalysis?: {
    dependentConditions: ParsedCondition[]
    dependencyConditions: ParsedCondition[]
    conflictScenarios: VariableScenario[]
  }
}

interface RuleAnalysis {
  suggestion?: string
  details?: string
}

export function checkDependencyRules(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const jobs = config.getJobs()
  const variables = config.getVariables()

  // Simulate different scenarios to find potential dependency issues
  const scenarios: Array<{
    changes: string[]
    name: string
    variables?: Record<string, string | null>
  }> = [
    { changes: ['src/app.js'], name: 'source code changes' },
    { changes: ['config/production.yml'], name: 'config changes' },
    { changes: ['package.json'], name: 'dependency definition changes' },
    { changes: ['pnpm-lock.yaml'], name: 'lockfile changes' },
    { changes: ['README.md'], name: 'documentation changes' },
    { changes: ['modern/**/*'], name: 'modern code changes' },
    { changes: ['legacy/**/*'], name: 'legacy code changes' },
    // Variable-based scenarios for condition analysis
    { changes: ['src/**/*'], name: 'source code changes', variables: { EPH_ENV_ID: null } },
    {
      changes: ['src/**/*'],
      name: 'ephemeral environment changes',
      variables: { EPH_ENV_ID: 'feature-env-123' },
    },
    {
      changes: ['src/**/*'],
      name: 'production deployment',
      variables: { EPH_ENV_ID: null, DEPLOY_ENV: 'production' },
    },
    {
      changes: ['src/**/*'],
      name: 'staging deployment',
      variables: { EPH_ENV_ID: 'staging-123', DEPLOY_ENV: 'staging' },
    },
    // Scheduled pipeline scenario
    {
      changes: [],
      name: 'scheduled pipeline',
      variables: { CI_PIPELINE_SOURCE: 'schedule' },
    },
  ]

  // Track issues by job pair to provide detailed analysis
  const dependencyAnalysis = new Map<string, DependencyAnalysis>()

  for (const scenario of scenarios) {
    const context: PipelineContext = {
      event: 'push',
      ref: 'main',
      variables: {
        ...variables,
        ...Object.fromEntries(
          Object.entries(scenario.variables || {}).filter(
            (entry): entry is [string, string] => entry[1] !== null,
          ),
        ),
      },
      changes: scenario.changes,
    }

    const activeJobs = new Set<string>()
    const allJobs = new Set(Object.keys(jobs))

    for (const [jobName, job] of Object.entries(jobs)) {
      if (shouldJobRun(job, context)) {
        activeJobs.add(jobName)
      }
    }

    for (const [jobName, job] of Object.entries(jobs)) {
      if (activeJobs.has(jobName)) {
        const dependencies = job.dependencies || []
        const needs = Array.isArray(job.needs)
          ? job.needs.map(n => (typeof n === 'string' ? n : n.job))
          : []

        for (const dep of [...dependencies, ...needs]) {
          if (allJobs.has(dep) && !activeJobs.has(dep)) {
            const issueKey = `${jobName}-depends-on-${dep}`

            if (!dependencyAnalysis.has(issueKey)) {
              // Extract conditions from job rules
              const dependentConditions = extractConditionsFromJob(job)
              const dependencyConditions = extractConditionsFromJob(jobs[dep]!)

              // Generate conflict scenarios if both jobs have conditions
              let conflictScenarios: VariableScenario[] = []
              if (dependentConditions.length > 0 || dependencyConditions.length > 0) {
                try {
                  conflictScenarios = ScenarioGenerator.generateConflictScenarios(
                    dependentConditions,
                    dependencyConditions,
                  )
                } catch (_error) {
                  // If condition analysis fails, continue without detailed scenarios
                  conflictScenarios = []
                }
              }

              dependencyAnalysis.set(issueKey, {
                dependentJob: jobName,
                dependencyJob: dep,
                dependentJobObject: job,
                dependencyJobObject: jobs[dep]!,
                problematicScenarios: [],
                conditionAnalysis: {
                  dependentConditions,
                  dependencyConditions,
                  conflictScenarios,
                },
              })
            }

            dependencyAnalysis.get(issueKey)!.problematicScenarios.push({
              scenario: scenario.name,
              changes: scenario.changes,
            })
          }
        }
      }
    }
  }

  // Generate detailed error messages for each dependency issue
  for (const analysis of dependencyAnalysis.values()) {
    const detailedMessage = generateDetailedDependencyMessage(analysis)
    issues.push({
      severity: 'error',
      message: detailedMessage,
      location: analysis.dependentJob,
    })
  }

  return issues
}

function shouldJobRun(job: GitLabJob, context: PipelineContext): boolean {
  if (job.rules) {
    for (const rule of job.rules) {
      if (evaluateRule(rule, context)) {
        return rule.when !== 'never'
      }
    }
    return false
  }

  if (job.only) {
    return evaluateOnly(job.only, context)
  }

  return true
}

function evaluateRule(rule: any, context: PipelineContext): boolean {
  // First check if condition, then changes pattern
  let conditionMatches = true

  // Use our new condition parser for 'if' conditions
  if (rule.if && typeof rule.if === 'string') {
    try {
      const condition = ConditionParser.parse(rule.if)
      const variables = createVariableContext(context)
      const evaluation = ConditionEvaluator.evaluate(condition, variables)
      conditionMatches = evaluation.result
    } catch (_error) {
      // Fallback to legacy evaluation for unparseable conditions
      conditionMatches = evaluateLegacyRuleCondition(rule, context)
    }
  }

  // If if-condition doesn't match, rule doesn't match
  if (!conditionMatches) {
    return false
  }

  // Check changes pattern if present
  if (rule.changes && !evaluateChanges(rule.changes, context)) {
    return false
  }

  return true
}

function evaluateOnly(only: any, context: PipelineContext): boolean {
  if (only.refs && !only.refs.includes(context.ref)) {
    return false
  }

  if (only.changes && !evaluateChanges(only.changes, context)) {
    return false
  }

  return true
}

function createVariableContext(context: PipelineContext): Record<string, string | null> {
  return {
    // Standard GitLab CI variables - use context.ref for both branch and ref name
    CI_COMMIT_BRANCH: context.ref,
    CI_COMMIT_REF_NAME: context.ref,
    CI_DEFAULT_BRANCH: 'main',
    CI_PIPELINE_SOURCE:
      context.event === 'push' ? 'push' : context.event === 'schedule' ? 'schedule' : 'web',

    // Generate some realistic defaults for common patterns
    EPH_ENV_ID:
      context.ref.startsWith('feature/') || context.ref.startsWith('hotfix/')
        ? `env-${context.ref.replace(/[^a-zA-Z0-9]/g, '-')}`
        : null,

    // Custom variables from context (override defaults)
    ...context.variables,
  }
}

function evaluateLegacyRuleCondition(rule: any, context: PipelineContext): boolean {
  if (rule.if) {
    // Handle common patterns like CI_COMMIT_REF_NAME == "main"
    if (
      rule.if.includes('CI_COMMIT_REF_NAME') &&
      rule.if.includes('main') &&
      context.ref === 'main'
    ) {
      // Continue to check other conditions
    } else if (
      rule.if.includes('CI_COMMIT_BRANCH') &&
      rule.if.includes('main') &&
      context.ref === 'main'
    ) {
      // Continue to check other conditions
    } else if (rule.if.includes('CI_PIPELINE_SOURCE') && rule.if.includes('schedule')) {
      // Schedule-related conditions
      return rule.if.includes('!=')
    } else if (rule.if.includes('CUSTOM_VAR')) {
      // Handle custom variable evaluation
      const varMatch = rule.if.match(/\$([A-Z_]+)\s*==\s*["']([^"']+)["']/)
      if (varMatch && context.variables) {
        const [, varName, expectedValue] = varMatch
        return context.variables[varName] === expectedValue
      }
      return false
    } else {
      // For other conditions, assume they might match
      return true
    }
  }

  return true
}

function extractChangesPatterns(changes: GitLabRule['changes']): string[] {
  if (!changes) return []
  if (Array.isArray(changes)) {
    return changes.filter((p): p is string => typeof p === 'string')
  }
  if (typeof changes === 'object' && 'paths' in changes && Array.isArray(changes.paths)) {
    return changes.paths.filter((p): p is string => typeof p === 'string')
  }
  return []
}

function evaluateChanges(changes: GitLabRule['changes'], context: PipelineContext): boolean {
  if (!context.changes || context.changes.length === 0) {
    return false
  }

  const patterns = extractChangesPatterns(changes)
  return patterns.some(pattern => {
    return context.changes!.some(change => {
      const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'))
      return regex.test(change)
    })
  })
}

function generateDetailedDependencyMessage(analysis: DependencyAnalysis): string {
  const {
    dependentJob,
    dependencyJob,
    dependentJobObject,
    dependencyJobObject,
    problematicScenarios,
    conditionAnalysis,
  } = analysis

  // Basic message
  let message = `Job '${dependentJob}' depends on '${dependencyJob}' which may not run due to rules`

  // Add scenario context first (for backwards compatibility)
  if (problematicScenarios.length > 0) {
    const scenarios = [...new Set(problematicScenarios.map(s => s.scenario))]
    if (scenarios.length === 1) {
      message += ` (fails during ${scenarios[0]})`
    } else if (scenarios.length <= 3) {
      message += ` (fails during ${scenarios.join(', ')})`
    } else {
      message += ` (fails in multiple scenarios)`
    }
  }

  // Add detailed condition analysis if available
  if (conditionAnalysis && conditionAnalysis.conflictScenarios.length > 0) {
    const conflictScenarios = conditionAnalysis.conflictScenarios.slice(0, 3) // Show up to 3 scenarios

    message += '\n'
    message += `  The pipeline would fail in these scenarios:`

    for (const scenario of conflictScenarios) {
      const variableDesc = Object.entries(scenario.variables)
        .filter(([, value]) => value !== null)
        .map(([key, value]) => `$${key} = "${value}"`)
        .join(', ')

      const nullVariables = Object.entries(scenario.variables)
        .filter(([, value]) => value === null)
        .map(([key]) => `$${key} = null`)

      const allVarDesc = [...(variableDesc ? [variableDesc] : []), ...nullVariables].join(', ')

      message += `\n    - When ${allVarDesc}`
      if (scenario.description) {
        message += ` (${scenario.description})`
      }
    }

    if (conditionAnalysis.conflictScenarios.length > 3) {
      message += `\n    - And ${conditionAnalysis.conflictScenarios.length - 3} more scenarios...`
    }
  } else if (problematicScenarios.length > 0 && problematicScenarios.length <= 1) {
    // This case is already handled above, skip
  }

  // Analyze the specific rule differences
  const ruleAnalysis = analyzeRuleDifferences(
    dependentJobObject,
    dependencyJobObject,
    dependentJob,
    dependencyJob,
    conditionAnalysis,
  )

  if (ruleAnalysis.suggestion) {
    message += `\n  ${ruleAnalysis.suggestion}`
  }

  if (ruleAnalysis.details) {
    message += `\n  Details: ${ruleAnalysis.details}`
  }

  return message
}

function analyzeRuleDifferences(
  dependentJobObject: GitLabJob,
  dependencyJobObject: GitLabJob,
  dependentJobName: string,
  dependencyJobName: string,
  conditionAnalysis?: {
    dependentConditions: ParsedCondition[]
    dependencyConditions: ParsedCondition[]
    conflictScenarios: VariableScenario[]
  },
): RuleAnalysis {
  const dependentRules = dependentJobObject.rules || []
  const dependencyRules = dependencyJobObject.rules || []

  // Use condition analysis for more specific suggestions when there are actual conditions
  if (conditionAnalysis) {
    const { dependentConditions, dependencyConditions, conflictScenarios } = conditionAnalysis

    // Only use condition analysis if there are actual conditions to analyze
    if (dependentConditions.length > 0 || dependencyConditions.length > 0) {
      if (dependencyConditions.length === 0) {
        return {
          suggestion:
            "Consider adding rules to align the dependency job's execution with the dependent job",
          details: `'${dependencyJobName}' has no rules (runs by default) but may be skipped due to pipeline conditions`,
        }
      }

      if (dependentConditions.length === 0) {
        return {
          suggestion: `Add rules to '${dependentJobName}' to match when '${dependencyJobName}' runs`,
          details: `'${dependentJobName}' runs by default but depends on conditional job`,
        }
      }

      if (conflictScenarios.length > 0) {
        const primaryConflict = conflictScenarios[0]!
        const conflictVariables = Object.keys(primaryConflict.variables)

        // Suggest specific condition alignment based on the conflict
        const suggestionVars = conflictVariables
          .slice(0, 2)
          .map(v => `$${v}`)
          .join(' and ')
        return {
          suggestion: `Align the conditions involving ${suggestionVars} between '${dependentJobName}' and '${dependencyJobName}'`,
          details: `The jobs have different requirements for ${suggestionVars}, causing dependency failures`,
        }
      }
    }
  }

  // Fall back to legacy analysis if condition analysis unavailable
  if (dependencyRules.length === 0) {
    return {
      suggestion:
        "Consider adding rules to align the dependency job's execution with the dependent job",
      details: `'${dependencyJobName}' has no rules (runs by default) but may be skipped due to pipeline conditions`,
    }
  }

  if (dependentRules.length === 0) {
    return {
      suggestion: `Add rules to '${dependentJobName}' to match when '${dependencyJobName}' runs`,
      details: `'${dependentJobName}' runs by default but depends on conditional job`,
    }
  }

  // Compare rule patterns
  const dependentChanges = extractChangePatterns(dependentRules)
  const dependencyChanges = extractChangePatterns(dependencyRules)

  // Check if dependent has additional change patterns
  const extraPatterns = dependentChanges.filter(pattern => !dependencyChanges.includes(pattern))

  const missingPatterns = dependencyChanges.filter(pattern => !dependentChanges.includes(pattern))

  if (extraPatterns.length > 0) {
    const patterns = extraPatterns.slice(0, 3).join(', ')
    const truncated = extraPatterns.length > 3 ? '...' : ''
    return {
      suggestion: `Add change patterns to '${dependencyJobName}': ${patterns}${truncated}`,
      details: `'${dependentJobName}' runs on additional file changes that don't trigger '${dependencyJobName}'`,
    }
  }

  if (missingPatterns.length > 0) {
    const patterns = missingPatterns.slice(0, 3).join(', ')
    const truncated = missingPatterns.length > 3 ? '...' : ''
    return {
      suggestion: `Consider removing change patterns from '${dependentJobName}' or add them to '${dependencyJobName}': ${patterns}${truncated}`,
      details: `'${dependencyJobName}' runs on file changes that don't trigger '${dependentJobName}'`,
    }
  }

  // Check for 'if' condition differences
  const dependentIfs = extractIfConditions(dependentRules)
  const dependencyIfs = extractIfConditions(dependencyRules)

  if (dependentIfs.length > 0 || dependencyIfs.length > 0) {
    const hasScheduleSkip = dependencyIfs.some(
      condition => condition.includes('CI_PIPELINE_SOURCE') && condition.includes('schedule'),
    )

    if (hasScheduleSkip) {
      return {
        suggestion: `Add similar pipeline source condition to '${dependentJobName}' to skip when '${dependencyJobName}' is skipped`,
        details: `'${dependencyJobName}' has pipeline source condition but '${dependentJobName}' does not`,
      }
    }

    if (dependentIfs.join() !== dependencyIfs.join()) {
      return {
        suggestion: `Align the 'if' conditions between '${dependentJobName}' and '${dependencyJobName}'`,
        details: 'Jobs have different conditional execution rules',
      }
    }
  }

  // Check for 'when: never' rules that might cause conflicts
  const dependentNeverRules = dependentRules.filter(rule => rule.when === 'never')
  const dependencyNeverRules = dependencyRules.filter(rule => rule.when === 'never')

  if (dependencyNeverRules.length > dependentNeverRules.length) {
    return {
      suggestion: `Consider adding similar 'when: never' conditions to '${dependentJobName}'`,
      details: `'${dependencyJobName}' has more restrictive rules that prevent execution`,
    }
  }

  return {
    suggestion: 'Review and align the rules between these jobs to ensure consistent execution',
    details: 'Jobs have different rule configurations that may cause dependency failures',
  }
}

function extractChangePatterns(rules: any[]): string[] {
  const patterns: string[] = []
  for (const rule of rules) {
    if (rule.changes) {
      patterns.push(...extractChangesPatterns(rule.changes))
    }
  }
  return [...new Set(patterns)]
}

function extractConditionsFromJob(job: GitLabJob): ParsedCondition[] {
  const conditions: ParsedCondition[] = []
  if (job.rules) {
    for (const rule of job.rules) {
      if (rule.if && typeof rule.if === 'string') {
        try {
          const condition = ConditionParser.parse(rule.if)
          conditions.push(condition)
        } catch (_error) {
          // Skip conditions that can't be parsed
        }
      }
    }
  }
  return conditions
}

function extractIfConditions(rules: any[]): string[] {
  const conditions: string[] = []
  for (const rule of rules) {
    if (rule.if && typeof rule.if === 'string') {
      conditions.push(rule.if)
    }
  }
  return conditions
}
