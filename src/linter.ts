import type { ProcessedConfig } from './ProcessedConfig'
import type { LintIssue } from './types'

// Import all rule functions
import { checkManualJobs } from './rules/checkManualJobs'
import { checkJobStageAssignments } from './rules/checkJobStageAssignments'
import { checkCircularDependencies } from './rules/checkCircularDependencies'
import { checkDependencyRules } from './rules/checkDependencyRules'
import { checkArtifactPaths } from './rules/checkArtifactPaths'
import { checkConflictingRules } from './rules/checkConflictingRules'
import { checkMissingDependencies } from './rules/checkMissingDependencies'
import { checkConditionalDependencies } from './rules/checkConditionalDependencies'
import { checkKubernetesResources } from './rules/checkKubernetesResources'
import { checkSecurityIssues } from './rules/checkSecurityIssues'
import { checkInvalidNeeds } from './rules/checkInvalidNeeds'
import { checkUnknownKeys } from './rules/checkUnknownKeys'

export interface LinterOptions {
  severityLevel?: 'error' | 'warning' | 'info'
  enabledRules?: string[]
  disabledRules?: string[]
}

export class Linter {
  private readonly rules = [
    { name: 'manual-jobs', fn: checkManualJobs },
    { name: 'job-stage-assignments', fn: checkJobStageAssignments },
    { name: 'circular-dependencies', fn: checkCircularDependencies },
    { name: 'dependency-rules', fn: checkDependencyRules },
    { name: 'artifact-paths', fn: checkArtifactPaths },
    { name: 'conflicting-rules', fn: checkConflictingRules },
    { name: 'missing-dependencies', fn: checkMissingDependencies },
    { name: 'conditional-dependencies', fn: checkConditionalDependencies },
    { name: 'kubernetes-resources', fn: checkKubernetesResources },
    { name: 'security-issues', fn: checkSecurityIssues },
    { name: 'invalid-needs', fn: checkInvalidNeeds },
    { name: 'unknown-keys', fn: checkUnknownKeys },
  ]

  constructor(private options: LinterOptions = {}) {}

  lint(processedConfig: ProcessedConfig): LintIssue[] {
    const issues: LintIssue[] = []

    // Run all enabled rules
    for (const rule of this.rules) {
      if (this.isRuleEnabled(rule.name)) {
        try {
          const ruleIssues = rule.fn(processedConfig)
          issues.push(...ruleIssues)
        } catch (error) {
          // Log rule execution errors but don't fail the entire linting process
          console.warn(`Warning: Rule '${rule.name}' failed to execute: ${error}`)
        }
      }
    }

    // Filter issues by severity level
    return this.filterBySeverity(issues)
  }

  private isRuleEnabled(ruleName: string): boolean {
    // If specific rules are enabled, only run those
    if (this.options.enabledRules && this.options.enabledRules.length > 0) {
      return this.options.enabledRules.includes(ruleName)
    }

    // If specific rules are disabled, skip those
    if (this.options.disabledRules && this.options.disabledRules.length > 0) {
      return !this.options.disabledRules.includes(ruleName)
    }

    // By default, all rules are enabled
    return true
  }

  private filterBySeverity(issues: LintIssue[]): LintIssue[] {
    if (!this.options.severityLevel) {
      return issues // Return all issues if no filter specified
    }

    const severityOrder = { error: 3, warning: 2, info: 1 }
    const minLevel = severityOrder[this.options.severityLevel]

    return issues.filter(issue => {
      const issueLevel = severityOrder[issue.severity]
      return issueLevel >= minLevel
    })
  }

  getAvailableRules(): string[] {
    return this.rules.map(rule => rule.name)
  }
}
