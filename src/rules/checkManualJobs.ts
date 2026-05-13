import type { LintIssue } from '../types'
import type { ProcessedConfig } from '../ProcessedConfig'

export function checkManualJobs(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const jobs = config.getJobs()

  for (const [jobName, job] of Object.entries(jobs)) {
    if (job.rules) {
      for (const rule of job.rules) {
        if (rule.when === 'manual') {
          // Check if allow_failure is set on the rule OR at the job level
          // Also check if job has top-level when: manual (which implicitly sets allow_failure: true)
          // But if job explicitly sets allow_failure: false, that overrides the implicit allow_failure
          const ruleAllowFailure = rule.allow_failure === true
          const jobAllowFailure = job.allow_failure === true
          const jobExplicitlyDisallowsFailure = job.allow_failure === false
          const jobHasTopLevelManual = job.when === 'manual' && !jobExplicitlyDisallowsFailure

          if (!ruleAllowFailure && !jobAllowFailure && !jobHasTopLevelManual) {
            // Check if this rule only runs on the main/default branch - if so, it's safe without allow_failure
            if (isMainBranchOnlyRule(rule)) {
              // Skip warning - main branch jobs can't stall MRs since they run after merge
              continue
            }

            const conditionDetails = extractRuleConditions(rule)
            const whenMessage = conditionDetails ? ` when ${conditionDetails}` : ''

            issues.push({
              severity: 'warning',
              message: `Job '${jobName}' has manual rule without allow_failure: true, which may stall the pipeline${whenMessage}`,
              location: jobName,
            })
          }
        }
      }
    }

    // Check for jobs with top-level when: manual but explicit allow_failure: false
    if (job.when === 'manual' && job.allow_failure === false) {
      issues.push({
        severity: 'warning',
        message: `Job '${jobName}' is manual with explicit allow_failure: false, which may stall the pipeline`,
        location: jobName,
      })
    }
  }

  return issues
}

function isMainBranchOnlyRule(rule: any): boolean {
  // Check if the rule has an 'if' condition that restricts it to the main/default branch
  if (!rule.if || typeof rule.if !== 'string') {
    return false
  }

  const condition = rule.if.trim()

  // Common patterns that indicate main/default branch only:
  // - if $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  // - if $CI_COMMIT_REF_NAME == $CI_DEFAULT_BRANCH
  // - if '$CI_COMMIT_BRANCH' == '$CI_DEFAULT_BRANCH'
  // - if "$CI_COMMIT_BRANCH" == "$CI_DEFAULT_BRANCH"
  // Handle variations with spacing and quotes
  const mainBranchPatterns = [
    /\$CI_COMMIT_BRANCH\s*==\s*\$CI_DEFAULT_BRANCH/,
    /\$CI_COMMIT_REF_NAME\s*==\s*\$CI_DEFAULT_BRANCH/,
    /['"]\$CI_COMMIT_BRANCH['"]\s*==\s*['"]\$CI_DEFAULT_BRANCH['"]/,
    /['"]\$CI_COMMIT_REF_NAME['"]\s*==\s*['"]\$CI_DEFAULT_BRANCH['"]/,
  ]

  return mainBranchPatterns.some(pattern => pattern.test(condition))
}

function extractRuleConditions(rule: any): string {
  const conditions: string[] = []

  // Handle 'if' conditions
  if (rule.if && typeof rule.if === 'string') {
    conditions.push(`if: ${rule.if}`)
  }

  // Handle 'changes' conditions
  if (rule.changes && Array.isArray(rule.changes)) {
    const changePatterns = rule.changes.join(', ')
    conditions.push(`changes: ${changePatterns}`)
  }

  // Handle 'exists' conditions
  if (rule.exists && Array.isArray(rule.exists)) {
    const existPatterns = rule.exists.join(', ')
    conditions.push(`exists: ${existPatterns}`)
  }

  // Handle 'variables' conditions
  if (rule.variables && typeof rule.variables === 'object') {
    const varConditions = Object.entries(rule.variables)
      .map(([key, value]) => `$${key} = ${value}`)
      .join(', ')
    conditions.push(`variables: ${varConditions}`)
  }

  return conditions.join(' and ')
}
