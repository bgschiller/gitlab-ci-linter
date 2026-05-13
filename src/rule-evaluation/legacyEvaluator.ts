import type { GitLabExcept, GitLabJob, GitLabOnly } from '../types'
import type { EvaluationContext, JobEvaluationResult } from './types'
import type { JobBaseResult } from './modernRuleEvaluator.js'
import { matchesAnyPattern } from './patternUtils.js'
import { evaluateExceptRefs, evaluateOnlyRefs, type RefMatchResult } from './refMatcher.js'
import { ConditionParser } from '../condition-analysis/ConditionParser.js'
import { ConditionEvaluator } from '../condition-analysis/ConditionEvaluator.js'

/**
 * Evaluate legacy 'only:variables' condition.
 * Job runs if ANY of the variable expressions evaluate to true (OR logic).
 */
function evaluateOnlyVariables(variables: string[], context: EvaluationContext): RefMatchResult {
  // If no variable expressions, assume match
  if (!variables || variables.length === 0) {
    return { matches: true }
  }

  // For only:variables, ANY expression must match (OR logic)
  for (const expression of variables) {
    try {
      const condition = ConditionParser.parse(expression)
      const evaluation = ConditionEvaluator.evaluate(condition, context.variables)
      if (evaluation.result) {
        return { matches: true }
      }
    } catch {
      // If parsing fails, try legacy evaluation
      if (evaluateLegacyVariableExpression(expression, context)) {
        return { matches: true }
      }
    }
  }

  return { matches: false, reason: 'only.variables not matched' }
}

/**
 * Evaluate legacy 'except:variables' condition.
 * Job is excluded if ANY of the variable expressions evaluate to true (OR logic).
 */
function evaluateExceptVariables(variables: string[], context: EvaluationContext): RefMatchResult {
  // If no variable expressions, no exclusion
  if (!variables || variables.length === 0) {
    return { matches: false }
  }

  // For except:variables, ANY expression matching means exclusion (OR logic)
  for (const expression of variables) {
    try {
      const condition = ConditionParser.parse(expression)
      const evaluation = ConditionEvaluator.evaluate(condition, context.variables)
      if (evaluation.result) {
        return { matches: true, reason: `except.variables matched: ${expression}` }
      }
    } catch {
      // If parsing fails, try legacy evaluation
      if (evaluateLegacyVariableExpression(expression, context)) {
        return { matches: true, reason: `except.variables matched: ${expression}` }
      }
    }
  }

  return { matches: false }
}

/**
 * Legacy variable expression evaluation for unparseable conditions.
 */
function evaluateLegacyVariableExpression(expression: string, context: EvaluationContext): boolean {
  // Extract variable comparisons like $VAR == "value"
  const comparisonMatch = expression.match(/\$([A-Z_][A-Z0-9_]*)\s*(==|!=)\s*["']?([^"'\s)]+)["']?/)
  if (comparisonMatch) {
    const varName = comparisonMatch[1]
    const operator = comparisonMatch[2]
    const expectedValue = comparisonMatch[3]

    if (!varName || !operator) {
      return true // Unparseable, assume match
    }

    const actualValue = context.variables[varName]

    if (operator === '==') {
      if (expectedValue === 'null' || expectedValue === '') {
        return actualValue === null || actualValue === undefined || actualValue === ''
      }
      return actualValue === expectedValue
    } else if (operator === '!=') {
      if (expectedValue === 'null' || expectedValue === '') {
        return actualValue !== null && actualValue !== undefined && actualValue !== ''
      }
      return actualValue !== expectedValue
    }
  }

  // For unhandled conditions, assume they don't match (conservative for legacy)
  return false
}

/**
 * Evaluate legacy 'only' condition.
 * Supports both array form (only: [ref1, ref2]) and object form (only: { refs: [...], changes: [...], variables: [...] })
 */
export function evaluateOnly(
  only: string[] | GitLabOnly,
  context: EvaluationContext,
): RefMatchResult {
  const ref = context.variables['CI_COMMIT_REF_NAME'] || context.variables['CI_COMMIT_BRANCH']
  const pipelineSource = context.variables['CI_PIPELINE_SOURCE']

  // Handle array form: only: [chrome, main, branches]
  if (Array.isArray(only)) {
    return evaluateOnlyRefs(only, ref, pipelineSource)
  }

  // Handle object form: only: { refs: [...], changes: [...], variables: [...] }
  if (only.refs && Array.isArray(only.refs)) {
    const refsResult = evaluateOnlyRefs(only.refs, ref, pipelineSource)
    if (!refsResult.matches) {
      return refsResult
    }
  }

  // Check variables - all conditions in 'only' must be met (AND logic between different conditions)
  if (only.variables && Array.isArray(only.variables)) {
    const varsResult = evaluateOnlyVariables(only.variables, context)
    if (!varsResult.matches) {
      return varsResult
    }
  }

  // Check changes
  if (only.changes) {
    const stringPatterns = only.changes.filter((p): p is string => typeof p === 'string')
    if (!evaluateChanges(stringPatterns, context.changes)) {
      return { matches: false, reason: 'only.changes not matched' }
    }
  }

  return { matches: true }
}

/**
 * Evaluate legacy 'except' condition.
 * Supports both array form (except: [ref1, ref2]) and object form (except: { refs: [...], changes: [...], variables: [...] })
 */
export function evaluateExcept(
  except: string[] | GitLabExcept,
  context: EvaluationContext,
): RefMatchResult {
  const ref = context.variables['CI_COMMIT_REF_NAME'] || context.variables['CI_COMMIT_BRANCH']
  const pipelineSource = context.variables['CI_PIPELINE_SOURCE']

  // Handle array form: except: [chrome, main]
  if (Array.isArray(except)) {
    return evaluateExceptRefs(except, ref, pipelineSource)
  }

  // Handle object form: except: { refs: [...], changes: [...], variables: [...] }
  if (except.refs && Array.isArray(except.refs)) {
    const refsResult = evaluateExceptRefs(except.refs, ref, pipelineSource)
    if (refsResult.matches) {
      return refsResult
    }
  }

  // Check variables - if any variable expression matches, job is excluded
  if (except.variables && Array.isArray(except.variables)) {
    const varsResult = evaluateExceptVariables(except.variables, context)
    if (varsResult.matches) {
      return varsResult
    }
  }

  // Check changes - if changes match, job is excluded
  if (except.changes) {
    const stringPatterns = except.changes.filter((p): p is string => typeof p === 'string')
    if (evaluateChanges(stringPatterns, context.changes)) {
      return { matches: true, reason: 'except.changes matched' }
    }
  }

  return { matches: false }
}

/**
 * Evaluate 'changes' patterns against the list of changed files.
 */
function evaluateChanges(patterns: string[], changedFiles?: string[]): boolean {
  // If no changes provided, treat as no match (conservative)
  if (!changedFiles || changedFiles.length === 0) {
    return false
  }

  return matchesAnyPattern(patterns, changedFiles)
}

/**
 * Evaluate legacy `only:` and `except:` keywords for a job.
 */
export function evaluateLegacyConditions(
  job: GitLabJob,
  baseResult: JobBaseResult,
  context: EvaluationContext,
): JobEvaluationResult {
  if (job.only) {
    const onlyResult = evaluateOnly(job.only, context)
    if (!onlyResult.matches) {
      return {
        ...baseResult,
        willRun: false,
        when: 'never',
        reason: onlyResult.reason || 'only condition not met',
      }
    }
  }

  if (job.except) {
    const exceptResult = evaluateExcept(job.except, context)
    if (exceptResult.matches) {
      return {
        ...baseResult,
        willRun: false,
        when: 'never',
        reason: exceptResult.reason || 'except condition matched',
      }
    }
  }

  // Conditions passed, job runs
  return {
    ...baseResult,
    willRun: true,
    when: job.when || 'on_success',
  }
}
