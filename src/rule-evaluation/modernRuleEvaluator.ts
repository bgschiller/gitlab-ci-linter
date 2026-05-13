import type { GitLabJob, GitLabRule } from '../types'
import type { EvaluationContext, JobEvaluationResult } from './types'
import { ConditionParser } from '../condition-analysis/ConditionParser.js'
import { ConditionEvaluator } from '../condition-analysis/ConditionEvaluator.js'
import { formatPatternList, matchesAnyPattern } from './patternUtils.js'

export interface RuleMatchResult {
  matches: boolean
  conditionDescription?: string
}

export type JobBaseResult = {
  name: string
  stage: string
  jobConfig: GitLabJob
}

/**
 * Evaluate a single rule against the context.
 */
export function evaluateRule(rule: GitLabRule, context: EvaluationContext): RuleMatchResult {
  // Check 'if' condition first
  if (rule.if && typeof rule.if === 'string') {
    try {
      const condition = ConditionParser.parse(rule.if)
      const evaluation = ConditionEvaluator.evaluate(condition, context.variables)
      if (!evaluation.result) {
        return { matches: false, conditionDescription: rule.if }
      }
    } catch (_error) {
      // If parsing fails, try legacy evaluation
      if (!evaluateLegacyCondition(rule.if, context)) {
        return { matches: false, conditionDescription: rule.if }
      }
    }
  }

  // Check 'changes' condition
  // Handle both simple array form and complex object form with paths/compare_to
  const changesPatterns = extractChangesPatterns(rule.changes)
  if (changesPatterns.length > 0) {
    if (!evaluateChanges(changesPatterns, context.changes)) {
      return {
        matches: false,
        conditionDescription: `changes: ${formatPatternList(changesPatterns)}`,
      }
    }
  }

  // Check 'exists' condition
  if (rule.exists && rule.exists.length > 0) {
    const stringPatterns = rule.exists.filter((p): p is string => typeof p === 'string')
    if (!evaluateExists(stringPatterns, context.exists)) {
      return {
        matches: false,
        conditionDescription: `exists: ${formatPatternList(stringPatterns)}`,
      }
    }
  }

  return { matches: true }
}

/**
 * Extract patterns from changes field, handling both simple array and complex object forms.
 * Simple form: changes: ["libs/...", "tools/..."]
 * Complex form: changes: { compare_to: "refs/heads/main", paths: ["libs/...", "tools/..."] }
 */
export function extractChangesPatterns(changes: GitLabRule['changes']): string[] {
  if (!changes) {
    return []
  }

  // Simple array form
  if (Array.isArray(changes)) {
    return changes.filter((p): p is string => typeof p === 'string')
  }

  // Complex object form with paths
  if (typeof changes === 'object' && 'paths' in changes && Array.isArray(changes.paths)) {
    return changes.paths.filter((p): p is string => typeof p === 'string')
  }

  return []
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
 * Evaluate 'exists' patterns against the list of existing files.
 */
function evaluateExists(patterns: string[], existingFiles?: string[]): boolean {
  // If no exists list provided, assume files exist (permissive)
  if (!existingFiles) {
    return true
  }

  return matchesAnyPattern(patterns, existingFiles)
}

/**
 * Legacy condition evaluation for unparseable conditions.
 * Handles simple variable comparisons that the main parser couldn't handle.
 */
function evaluateLegacyCondition(condition: string, context: EvaluationContext): boolean {
  // Extract variable comparisons
  const comparisonMatch = condition.match(/\$([A-Z_][A-Z0-9_]*)\s*(==|!=)\s*["']?([^"'\s)]+)["']?/)
  if (comparisonMatch) {
    const varName = comparisonMatch[1]
    const operator = comparisonMatch[2]
    const expectedValue = comparisonMatch[3]

    if (!varName || !operator) {
      return true // Unparseable, assume match
    }

    const actualValue = context.variables[varName]

    if (operator === '==') {
      // Handle null comparison
      if (expectedValue === 'null' || expectedValue === '') {
        return actualValue === null || actualValue === undefined || actualValue === ''
      }
      return actualValue === expectedValue
    } else if (operator === '!=') {
      if (expectedValue === 'null' || expectedValue === '') {
        return actualValue !== null && actualValue !== undefined && actualValue !== ''
      }
      return actualValue !== expectedValue
    } else {
      console.warn(`Unknown operator '${operator}' in condition: ${condition}`)
    }
  }

  // For unhandled conditions, assume they match (permissive)
  return true
}

/**
 * Evaluate modern `rules:` keyword for a job.
 */
export function evaluateModernRules(
  job: GitLabJob,
  baseResult: JobBaseResult,
  context: EvaluationContext,
): JobEvaluationResult {
  for (const rule of job.rules!) {
    const ruleResult = evaluateRule(rule, context)
    if (ruleResult.matches) {
      // Rule-level when takes precedence, then job-level when, then default to on_success
      const when = rule.when ?? job.when ?? 'on_success'
      if (when === 'never') {
        return {
          ...baseResult,
          willRun: false,
          when: 'never',
          matchedRule: rule,
          reason: `Rule matched with when: never${ruleResult.conditionDescription ? ` (${ruleResult.conditionDescription})` : ''}`,
        }
      }
      return {
        ...baseResult,
        willRun: true,
        when,
        matchedRule: rule,
      }
    }
  }

  // No rule matched - job doesn't run
  return {
    ...baseResult,
    willRun: false,
    when: 'never',
    reason: 'No rules matched',
  }
}
