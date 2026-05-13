import type { GitLabCI, GitLabJob, GitLabWorkflow } from './types'
import type { EvaluationContext } from './rule-evaluation/types'

export interface ProcessingContext {
  filePath: string
  baseDir: string
  includedFiles: Set<string>
  includeStack: string[]
  remoteJobs: Set<string>
  /** GitLab host for resolving component includes (default: gitlab.com) */
  gitlabHost: string
  /**
   * Scenario evaluation context. When set, includes with `rules:` are evaluated
   * against these variables and skipped if no rule matches with non-never `when`.
   * When unset (default), all includes are loaded regardless of their `rules`.
   */
  evaluationContext?: EvaluationContext
}

/**
 * Reset per-call processing state so that repeated process() invocations
 * re-resolve all includes from scratch (e.g., when running multiple test
 * scenarios against the same processor instance). Shared between
 * {@link ConfigProcessor} and {@link RemoteConfigProcessor}.
 */
export function resetProcessingContext(
  context: ProcessingContext,
  evaluationContext?: EvaluationContext,
): void {
  context.includedFiles.clear()
  context.includeStack = []
  context.remoteJobs.clear()
  context.evaluationContext = evaluationContext
}

export class ProcessedConfig {
  constructor(
    public readonly config: GitLabCI,
    public readonly context: ProcessingContext,
  ) {}

  getJobs(): Record<string, GitLabJob> {
    const jobs: Record<string, GitLabJob> = {}
    // Top-level GitLab CI keywords that are not jobs
    const reservedKeys = [
      'stages',
      'variables',
      'workflow',
      'include',
      'default',
      'cache',
      'image',
      'services',
      'before_script',
      'after_script',
      'artifacts',
    ]

    for (const [key, value] of Object.entries(this.config)) {
      if (!reservedKeys.includes(key) && typeof value === 'object' && value !== null) {
        jobs[key] = value as GitLabJob
      }
    }

    return jobs
  }

  getStages(): string[] {
    return this.config.stages || ['.pre', 'build', 'test', 'deploy', '.post']
  }

  getVariables(): Record<string, string> {
    return this.config.variables || {}
  }

  getWorkflow(): GitLabWorkflow | undefined {
    return this.config.workflow
  }

  isRemoteJob(jobName: string): boolean {
    return this.context.remoteJobs.has(jobName)
  }

  getRemoteJobs(): Set<string> {
    return this.context.remoteJobs
  }
}
