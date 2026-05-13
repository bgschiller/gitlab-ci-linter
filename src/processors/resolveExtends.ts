import { type GitLabCI, type GitLabJob } from '../types'

export function resolveExtends(config: GitLabCI): GitLabCI {
  const result = { ...config }
  const jobs = getJobsFromConfig(result)

  // Memoization cache for resolved jobs
  const resolved = new Map<string, GitLabJob>()
  // Track jobs currently being resolved (cycle detection)
  const resolving = new Set<string>()

  function resolveJob(jobName: string): GitLabJob {
    // Return cached result if already resolved
    if (resolved.has(jobName)) {
      return resolved.get(jobName)!
    }

    const job = jobs[jobName]
    if (!job) {
      return {} as GitLabJob // Missing parent - return empty
    }

    // Cycle detection
    if (resolving.has(jobName)) {
      console.warn(`Circular extends detected: ${jobName}`)
      return job // Return unresolved to break cycle
    }

    // No extends - just cache and return
    if (!job.extends) {
      resolved.set(jobName, job)
      return job
    }

    resolving.add(jobName)

    // Resolve extends
    const extendNames = Array.isArray(job.extends) ? job.extends : [job.extends]
    const jobWithoutExtends = { ...job }
    delete jobWithoutExtends.extends

    // Start with empty object and merge parents in order, then child
    // Later parents override earlier ones, child overrides all
    let mergedJob: GitLabJob = {}
    for (const parentName of extendNames) {
      const resolvedParent = resolveJob(parentName) // Recursive call
      mergedJob = mergeJob(mergedJob, resolvedParent)
    }
    mergedJob = mergeJob(mergedJob, jobWithoutExtends)

    resolving.delete(jobName)
    resolved.set(jobName, mergedJob)
    return mergedJob
  }

  // Resolve all jobs
  for (const jobName of Object.keys(jobs)) {
    result[jobName] = resolveJob(jobName)
  }

  return result
}

function getJobsFromConfig(config: GitLabCI): Record<string, GitLabJob> {
  const jobs: Record<string, GitLabJob> = {}
  const reservedKeys = ['stages', 'variables', 'workflow', 'include']

  for (const [key, value] of Object.entries(config)) {
    if (!reservedKeys.includes(key) && typeof value === 'object' && value !== null) {
      jobs[key] = value as GitLabJob
    }
  }

  return jobs
}

function mergeJob(parent: GitLabJob, child: GitLabJob): GitLabJob {
  const merged = { ...parent, ...child }

  if (parent.variables && child.variables) {
    merged.variables = { ...parent.variables, ...child.variables }
  }

  if (parent.script && child.script) {
    merged.script = [...parent.script, ...child.script]
  }

  return merged
}
