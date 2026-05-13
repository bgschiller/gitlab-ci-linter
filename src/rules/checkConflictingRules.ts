import type { GitLabJob, GitLabRule, LintIssue } from '../types'
import type { ProcessedConfig } from '../ProcessedConfig'

export function checkConflictingRules(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const jobs = config.getJobs()

  for (const [jobName, job] of Object.entries(jobs)) {
    if (job.rules && job.rules.length > 0) {
      const ruleIssues = analyzeJobRules(jobName, job.rules)
      issues.push(...ruleIssues)

      // Check for job-level when with rules that don't specify when
      const whenIssue = checkJobLevelWhenWithRules(jobName, job)
      if (whenIssue) {
        issues.push(whenIssue)
      }
    }
  }

  return issues
}

function analyzeJobRules(jobName: string, rules: GitLabRule[]): LintIssue[] {
  const issues: LintIssue[] = []

  // Check for mutually exclusive conditions in rules

  for (const rule of rules) {
    if (rule.if) {
      // Check for obvious contradictions in if conditions
      if (
        rule.if.includes('$CI_COMMIT_REF_NAME == "main"') &&
        rule.if.includes('$CI_COMMIT_REF_NAME != "main"')
      ) {
        issues.push({
          severity: 'error',
          message: `Job '${jobName}' has contradictory conditions in a single rule`,
          location: jobName,
        })
      }
    }
  }

  // Check for patterns that might be too restrictive
  checkRestrictiveRulePatterns(jobName, rules, issues)

  return issues
}

function checkRestrictiveRulePatterns(
  jobName: string,
  rules: GitLabRule[],
  issues: LintIssue[],
): void {
  // Check for rules that are likely too restrictive - but be conservative to avoid false positives
  const hasOnlyVerySpecificChanges =
    rules.length === 1 &&
    rules.every(
      rule =>
        rule.changes &&
        Array.isArray(rule.changes) &&
        rule.changes.length === 1 &&
        typeof rule.changes[0] === 'string' &&
        rule.changes[0].split('/').length > 4, // Very deep path (more than 4 levels)
    )

  if (hasOnlyVerySpecificChanges) {
    issues.push({
      severity: 'info',
      message: `Job '${jobName}' has very specific change patterns - it may rarely run`,
      location: jobName,
    })
  }

  // Check for rules with exists conditions that might never be satisfied
  const existsRules = rules.filter(rule => rule.exists)
  if (existsRules.length > 0) {
    for (const rule of existsRules) {
      if (rule.exists && rule.exists.length > 0) {
        // Look for patterns that are likely typos or missing files
        const suspiciousExists = rule.exists.filter(
          (path: string) =>
            path.includes('..') || // Parent directory references
            path.startsWith('/') || // Absolute paths (unusual in GitLab CI)
            (path.includes('**/') && path.includes('**/**')), // Double wildcard patterns
        )

        if (suspiciousExists.length > 0) {
          issues.push({
            severity: 'warning',
            message: `Job '${jobName}' has potentially problematic exists patterns: ${suspiciousExists.join(', ')}`,
            location: jobName,
          })
        }
      }
    }
  }
}

/**
 * Check for jobs that have both job-level `when:` and `rules:` where some rules
 * don't specify their own `when:`. In this case, the job-level `when:` is used
 * as the default for those rules, which can be confusing.
 */
function checkJobLevelWhenWithRules(jobName: string, job: GitLabJob): LintIssue | null {
  // Only check if job has both job-level when and rules
  if (!job.when || !job.rules || job.rules.length === 0) {
    return null
  }

  // Skip if job-level when is 'on_success' (the default) - no confusion there
  if (job.when === 'on_success') {
    return null
  }

  // Find rules that don't specify their own when
  const rulesWithoutWhen = job.rules.filter(rule => !rule.when)

  if (rulesWithoutWhen.length === 0) {
    return null
  }

  // Generate a helpful message
  const rulesCount = rulesWithoutWhen.length
  const totalRules = job.rules.length

  return {
    severity: 'info',
    message:
      `Job '${jobName}' has 'when: ${job.when}' at job level with ${rulesCount}/${totalRules} rule(s) ` +
      `that don't specify 'when:'. These rules will use '${job.when}' as default instead of 'on_success'.`,
    location: jobName,
  }
}
