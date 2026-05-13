import { type LintIssue } from '../types.js'
import { type ProcessedConfig } from '../ProcessedConfig.js'

export function checkConditionalDependencies(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const jobs = config.getJobs()

  for (const [jobName, job] of Object.entries(jobs)) {
    // Skip template jobs (starting with .)
    if (jobName.startsWith('.')) continue

    const dependencies = getAllJobDependencies(job)

    for (const depJobName of dependencies) {
      const depJob = jobs[depJobName]
      if (!depJob) continue // Skip if dependency doesn't exist

      // Check if this is a problematic conditional dependency
      const issue = analyzeConditionalDependency(jobName, job, depJobName, depJob)
      if (issue) {
        issues.push(issue)
      }
    }
  }

  return issues
}

function getAllJobDependencies(job: any): string[] {
  const dependencies: string[] = []

  if (job.dependencies) {
    dependencies.push(...job.dependencies)
  }

  if (job.needs) {
    for (const need of job.needs) {
      const needJobName = typeof need === 'string' ? need : need.job
      if (needJobName) {
        dependencies.push(needJobName)
      }
    }
  }

  return [...new Set(dependencies)] // Remove duplicates
}

function analyzeConditionalDependency(
  dependentJobName: string,
  dependentJob: any,
  dependencyJobName: string,
  dependencyJob: any,
): LintIssue | null {
  // Check if dependency has change-based rules
  const dependencyHasChanges = jobHasChangesRules(dependencyJob)
  if (!dependencyHasChanges) {
    return null // No conditional dependency issue if dependency doesn't have changes rules
  }

  // Check if dependent job also has the same change requirements
  const dependentHasMatchingChanges = jobHasMatchingChangesRules(dependentJob, dependencyJob)
  if (dependentHasMatchingChanges) {
    return null // No issue if both jobs have matching change requirements
  }

  // Check if the dependent job can run when dependency's changes aren't present
  const canDependentRunWithoutChanges = canJobRunWithoutSpecificChanges(dependentJob, dependencyJob)
  if (!canDependentRunWithoutChanges) {
    return null // No issue if dependent job also can't run without the changes
  }

  // Skip validation if the dependent job is manual - manual jobs can depend on conditionally run jobs
  // because users will manually trigger dependencies as needed. The dependency job can be manual
  // or have conditional rules since manual jobs in GitLab CI can depend on skipped jobs.
  const dependentIsManual = jobIsManual(dependentJob)
  if (dependentIsManual) {
    return null // Manual jobs can safely depend on jobs with conditional rules
  }

  // This is a problematic conditional dependency
  const dependencyChangePatterns = getChangePatternsFromJob(dependencyJob)
  const suggestion = generateConditionalDependencySuggestion(
    dependentJobName,
    dependencyJobName,
    dependencyChangePatterns,
  )

  return {
    severity: 'error',
    message: `Job '${dependentJobName}' needs '${dependencyJobName}' job, but '${dependencyJobName}' only runs when there are changes to: ${dependencyChangePatterns.join(', ')}. ${suggestion}`,
    location: dependentJobName,
  }
}

function jobHasChangesRules(job: any): boolean {
  if (!job.rules) return false

  // A job "has changes rules" (i.e., is problematic) only if it EXCLUSIVELY requires changes
  // If there are any rules that can run without changes, then the job is not problematic
  return job.rules.every((rule: any) => {
    // If rule has changes requirement, it's conditional
    if (rule.changes && rule.changes.length > 0) {
      return true
    }

    // If rule has no changes AND is not set to "never", it's a fallback rule
    // that can run without specific changes
    if (rule.when !== 'never') {
      return false
    }

    // If rule has when: never, it doesn't affect whether job can run
    return true
  })
}

function jobHasMatchingChangesRules(dependentJob: any, dependencyJob: any): boolean {
  const dependentChanges = getChangePatternsFromJob(dependentJob)
  const dependencyChanges = getChangePatternsFromJob(dependencyJob)

  if (dependentChanges.length === 0) return false

  // Check if dependent job has at least the same change patterns as dependency
  return dependencyChanges.every(pattern => dependentChanges.includes(pattern))
}

function canJobRunWithoutSpecificChanges(dependentJob: any, dependencyJob: any): boolean {
  const dependencyChangePatterns = getChangePatternsFromJob(dependencyJob)

  if (!dependentJob.rules || dependentJob.rules.length === 0) {
    return true // Job with no rules runs by default
  }

  // Check if there's any rule in the dependent job that can run without the dependency's change patterns
  return dependentJob.rules.some((rule: any) => {
    // If rule has no changes requirement, it can run without specific changes
    if (!rule.changes) {
      return rule.when !== 'never'
    }

    // If rule has changes but they don't overlap with dependency's changes, it can run without them
    const ruleChanges = rule.changes || []
    const hasOverlap = dependencyChangePatterns.some(depPattern =>
      ruleChanges.some((rulePattern: string) => changesPatternsOverlap(depPattern, rulePattern)),
    )

    return !hasOverlap && rule.when !== 'never'
  })
}

function getChangePatternsFromJob(job: any): string[] {
  const patterns: string[] = []
  if (job.rules) {
    for (const rule of job.rules) {
      if (rule.changes) {
        patterns.push(...rule.changes)
      }
    }
  }
  return [...new Set(patterns)] // Remove duplicates
}

function changesPatternsOverlap(pattern1: string, pattern2: string): boolean {
  // Simple heuristic: patterns overlap if one contains the other or they're identical
  return pattern1 === pattern2 || pattern1.includes(pattern2) || pattern2.includes(pattern1)
}

function jobIsManual(job: any): boolean {
  // Check if job has `when: manual` at the top level
  if (job.when === 'manual') {
    return true
  }

  // Check if all rules specify `when: manual`
  if (job.rules && job.rules.length > 0) {
    return job.rules.every((rule: any) => rule.when === 'manual')
  }

  return false
}

function generateConditionalDependencySuggestion(
  dependentJobName: string,
  dependencyJobName: string,
  changePatterns: string[],
): string {
  if (changePatterns.length === 1) {
    return `Consider adding 'changes: [${changePatterns[0]}]' to '${dependentJobName}' rules or use 'needs: [{job: ${dependencyJobName}, optional: true}]' to make the dependency optional.`
  } else {
    return `Consider adding the same change patterns to '${dependentJobName}' rules or use 'needs: [{job: ${dependencyJobName}, optional: true}]' to make the dependency optional.`
  }
}
