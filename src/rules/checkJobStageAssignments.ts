import type { LintIssue } from '../types'
import type { ProcessedConfig } from '../ProcessedConfig'

export function checkJobStageAssignments(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const jobs = config.getJobs()

  // GitLab default stages (used when no stages are declared)
  const defaultStages = ['.pre', 'build', 'test', 'deploy', '.post']

  // Determine valid stages
  let validStages: string[]
  if (config.config.stages && config.config.stages.length > 0) {
    // Custom stages were declared, add .pre and .post if not already present
    const customStages = [...config.config.stages]
    validStages = []

    if (!customStages.includes('.pre')) {
      validStages.push('.pre')
    }
    validStages.push(...customStages)
    if (!customStages.includes('.post')) {
      validStages.push('.post')
    }
  } else {
    // No stages declared or empty array, use defaults
    validStages = defaultStages
  }

  for (const [jobName, job] of Object.entries(jobs)) {
    if (job.stage && !validStages.includes(job.stage)) {
      issues.push({
        severity: 'error',
        message: `Job '${jobName}' references undefined stage '${job.stage}'. Available stages: ${validStages.join(', ')}`,
        location: jobName,
      })
    }
  }

  return issues
}
