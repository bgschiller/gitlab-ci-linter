import type { LintIssue } from '../types.js'
import type { ProcessedConfig } from '../ProcessedConfig.js'

export function checkMissingDependencies(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const jobs = config.getJobs()
  const stages = config.getStages()

  for (const [jobName, job] of Object.entries(jobs)) {
    // Skip template jobs (starting with .)
    if (jobName.startsWith('.')) continue

    // Get explicit dependencies for this job
    const explicitDeps = getExplicitDependencies(job)

    // Check for potential missing dependencies
    checkForMissingArtifactDependencies(jobName, job, jobs, explicitDeps, stages, issues)
  }

  return issues
}

function getExplicitDependencies(job: any): Set<string> {
  const explicitDeps = new Set<string>()

  // Add dependencies from 'dependencies' field
  if (job.dependencies) {
    job.dependencies.forEach((dep: string) => {
      explicitDeps.add(dep)
    })
  }

  // Add dependencies from 'needs' field
  if (job.needs) {
    job.needs.forEach((need: any) => {
      const needJobName = typeof need === 'string' ? need : need.job
      if (needJobName) explicitDeps.add(needJobName)
    })
  }

  return explicitDeps
}

function checkForMissingArtifactDependencies(
  jobName: string,
  job: any,
  jobs: Record<string, any>,
  _explicitDeps: Set<string>,
  stages: string[],
  _issues: LintIssue[],
): void {
  // Check if this job might need artifacts from other jobs
  if (!job.script) return

  // Handle both string and array formats for script
  const scriptContent = Array.isArray(job.script) ? job.script.join(' ') : job.script

  // Look for very specific patterns that strongly suggest artifact usage
  const artifactPatterns = [
    /cp\s+.*(dist|build|target|output)/, // Copy from build directories
    /\$CI_PROJECT_DIR\/(dist|build|target|output)/,
    /download.*artifact/i,
    /unzip.*\.(zip|tar\.gz|jar|war)/i,
    /java\s+-jar\s+.*\.(jar|war)/i,
  ]

  const mightUseArtifacts = artifactPatterns.some(pattern => pattern.test(scriptContent))

  if (mightUseArtifacts) {
    // Find jobs that produce artifacts with paths (not just reports)
    const artifactProducers: string[] = []

    for (const [otherJobName, otherJob] of Object.entries(jobs)) {
      if (otherJobName === jobName) continue
      if (otherJobName.startsWith('.')) continue // Skip template jobs

      // Only consider jobs that produce actual file artifacts, not just reports
      if (otherJob.artifacts && (otherJob.artifacts.paths || otherJob.artifacts.untracked)) {
        // Check if the artifact producer is in an earlier stage or same stage
        const otherStage = otherJob.stage || 'test'
        if (couldJobsRunInProblemOrder(job, otherStage, stages)) {
          artifactProducers.push(otherJobName)
        }
      }
    }
  }
}

function couldJobsRunInProblemOrder(job: any, otherStage: string, stages: string[]): boolean {
  const currentStage = job.stage || 'test'

  // If in same stage, they could run in parallel - potential issue
  if (currentStage === otherStage) return true

  // If other job is in later stage, no issue
  const currentIndex = stages.indexOf(currentStage)
  const otherIndex = stages.indexOf(otherStage)

  // If stage not found, assume it could be problematic
  if (currentIndex === -1 || otherIndex === -1) return true

  // If other job is in earlier stage but this job doesn't depend on it, potential issue
  return otherIndex < currentIndex
}
