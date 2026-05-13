import { type LintIssue } from '../types'
import { type ProcessedConfig } from '../ProcessedConfig'

export function checkCircularDependencies(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const jobs = config.getJobs()

  // Build dependency graph
  const dependencyGraph: Map<string, string[]> = new Map()

  for (const [jobName, job] of Object.entries(jobs)) {
    const dependencies: string[] = []

    // Add dependencies from 'dependencies' field
    if (job.dependencies) {
      dependencies.push(...job.dependencies)
    }

    // Add dependencies from 'needs' field
    if (job.needs) {
      const needs = Array.isArray(job.needs) ? job.needs : [job.needs]
      for (const need of needs) {
        const needJobName = typeof need === 'string' ? need : need.job
        if (needJobName) {
          dependencies.push(needJobName)
        }
      }
    }

    dependencyGraph.set(jobName, dependencies)
  }

  // Detect cycles using DFS with path tracking
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const currentPath: string[] = []

  const detectCycleDFS = (jobName: string): boolean => {
    if (recursionStack.has(jobName)) {
      // Found a cycle - extract the cycle path
      const cycleStart = currentPath.indexOf(jobName)
      const cycle = [...currentPath.slice(cycleStart), jobName]

      issues.push({
        severity: 'error',
        message: `Circular dependency detected: ${cycle.join(' → ')}`,
        location: cycle[0],
      })
      return true
    }

    if (visited.has(jobName)) {
      return false
    }

    visited.add(jobName)
    recursionStack.add(jobName)
    currentPath.push(jobName)

    const dependencies = dependencyGraph.get(jobName) || []
    for (const dep of dependencies) {
      // Only check dependencies that exist as jobs
      if (dependencyGraph.has(dep)) {
        if (detectCycleDFS(dep)) {
          return true
        }
      }
    }

    recursionStack.delete(jobName)
    currentPath.pop()
    return false
  }

  // Check each job for cycles
  for (const jobName of Object.keys(jobs)) {
    if (!visited.has(jobName)) {
      detectCycleDFS(jobName)
    }
  }

  return issues
}
