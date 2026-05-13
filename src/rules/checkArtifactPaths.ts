import { type LintIssue } from '../types.js'
import { type ProcessedConfig } from '../ProcessedConfig.js'

/**
 * Check artifact configuration for validity and potential issues
 */
export function checkArtifactPaths(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const jobs = config.getJobs()

  for (const [jobName, job] of Object.entries(jobs)) {
    if (job.artifacts) {
      // Check for invalid expire_in values
      if (job.artifacts.expire_in) {
        if (!isValidExpiration(job.artifacts.expire_in)) {
          issues.push({
            severity: 'error',
            message: `Job '${jobName}' has invalid artifact expire_in value '${job.artifacts.expire_in}'. Expected format: number + unit (e.g., '1 day', '2 weeks', '30 mins', 'never')`,
            location: jobName,
          })
        }
      }

      // Check for empty or invalid paths
      if (job.artifacts.paths) {
        if (job.artifacts.paths.length === 0) {
          issues.push({
            severity: 'warning',
            message: `Job '${jobName}' has empty artifacts.paths array. Consider removing the artifacts configuration or specifying paths`,
            location: jobName,
          })
        } else {
          // Check for suspicious paths that might be too broad
          for (const path of job.artifacts.paths) {
            if (isSuspiciousArtifactPath(path)) {
              issues.push({
                severity: 'warning',
                message: `Job '${jobName}' has potentially overly broad artifact path '${path}'. Consider being more specific to avoid large artifacts`,
                location: jobName,
              })
            }
          }
        }
      }

      // Warn about never expiring artifacts that might consume storage
      if (job.artifacts.expire_in === 'never') {
        issues.push({
          severity: 'warning',
          message: `Job '${jobName}' has artifacts that never expire. Consider setting an expiration to manage storage costs`,
          location: jobName,
        })
      }
    }
  }

  return issues
}

/**
 * Check if an expiration string is valid according to GitLab format
 *
 * GitLab supports flexible time formats including:
 * - Full units: second(s), minute(s), hour(s), day(s), week(s), month(s), year(s)
 * - Abbreviations: sec, s, min, mins, hr, hrs, h, d, mo, mos, yr, yrs
 * - Combined units: "3 mins 4 sec", "2h20min", "6 mos 1 day", "3 weeks and 2 days"
 * - Bare numbers (interpreted as seconds): "42"
 * - Special value: "never"
 */
function isValidExpiration(expiration: string): boolean {
  const trimmed = expiration.trim()

  if (trimmed === 'never') {
    return true
  }

  // Bare number (interpreted as seconds by GitLab)
  if (/^\d+$/.test(trimmed)) {
    return true
  }

  // Valid time unit patterns (singular, plural, and abbreviations)
  // Based on official GitLab documentation
  // IMPORTANT: Order from longest to shortest to prevent partial matches
  const unitPattern =
    /seconds|second|secs|sec|minutes|minute|mins|min|hours|hour|hrs|hr|weeks|week|months|month|years|year|days|day|mos|yrs|mo|yr|h|d|s/i

  // Simple format: number + unit (with optional space)
  // Examples: "1 day", "2 weeks", "30 mins", "1h", "5 yrs", "2h20min"
  const simplePattern = new RegExp(`^\\d+\\s*(?:${unitPattern.source})$`, 'i')
  if (simplePattern.test(trimmed)) {
    return true
  }

  // Combined format: multiple number+unit pairs with optional spaces/connectors
  // Examples: "3 mins 4 sec", "2 hrs 20 min", "6 mos 1 day", "3 weeks and 2 days"
  // Remove "and" connectors and extra spaces, then check each part
  const normalized = trimmed.replace(/\band\b/gi, ' ').replace(/\s+/g, ' ')

  // Split into potential time components and validate each
  // Match patterns like "3 mins", "4sec", "2h", etc.
  const componentPattern = new RegExp(`\\d+\\s*(?:${unitPattern.source})`, 'gi')
  const components = normalized.match(componentPattern)

  if (components && components.length > 0) {
    // Reconstruct what we matched and compare to original (minus connectors)
    const matched = components.join(' ')
    const originalNormalized = normalized.replace(/\s+/g, ' ').trim()

    // Check if all parts of the string are valid time components
    // by comparing lengths (allowing for spacing differences)
    const matchedChars = matched.replace(/\s/g, '').length
    const originalChars = originalNormalized.replace(/\s/g, '').length

    if (matchedChars === originalChars) {
      return true
    }
  }

  return false
}

/**
 * Check if an artifact path is suspiciously broad and might cause large artifacts
 */
function isSuspiciousArtifactPath(path: string): boolean {
  // Very broad patterns that are almost always problematic
  const alwaysSuspicious = [
    '/', // Root directory
    '*', // Everything in current directory
    '**/*', // Everything recursively
    '**', // Everything recursively (shorter form)
    '.', // Current directory
    './', // Current directory explicit
  ]

  // Directories that are typically large and shouldn't be artifacts
  const largeDirsPatterns = [
    'node_modules/',
    'node_modules/**',
    '.git/',
    '.git/**',
    'vendor/',
    'vendor/**',
    '.npm/',
    '.npm/**',
    '.cache/',
    '.cache/**',
    'tmp/',
    'tmp/**',
    'temp/',
    'temp/**',
    'logs/',
    'logs/**',
    'log/',
    'log/**',
    '.next/',
    '.next/**', // Next.js build
    // 'coverage/**', // Removed - allow coverage/ for test coverage reports
    // Don't include generic build/target/dist patterns as they might be legitimate
    // when used with specific paths like "build/lib/*.so" or "target/release/myapp"
  ]

  // Patterns that match too many files across directories
  const overlyBroadPatterns = [
    '**/*.log',
    '**/*.tmp',
    '**/*.temp', // Log and temp files everywhere
    '**/node_modules/**',
    '**/vendor/**', // Package dirs everywhere
    '**/.git/**',
    '**/.cache/**', // Hidden dirs everywhere
    // Note: don't include '**/target/**', '**/build/**', '**/dist/**' here
    // as these might be too restrictive for legitimate multi-module builds
  ]

  // Check for exact matches with always suspicious patterns
  if (alwaysSuspicious.includes(path)) {
    return true
  }

  // Check for large directory patterns
  for (const pattern of largeDirsPatterns) {
    if (path === pattern || (pattern.includes('**') && matchesGlobPattern(path, pattern))) {
      return true
    }
  }

  // Check for overly broad glob patterns
  for (const pattern of overlyBroadPatterns) {
    if (path === pattern || matchesGlobPattern(path, pattern)) {
      return true
    }
  }

  // Additional heuristics for potentially problematic paths - but be more conservative

  // Only flag patterns that are clearly overly broad
  // Patterns matching ALL files of common types recursively (very broad)
  if (/^\*\*\/\*\.(log|tmp|temp|cache)$/.test(path)) {
    return true // These are clearly problematic everywhere
  }

  // Very broad recursive patterns with many wildcards
  if (path.includes('**') && (path.match(/\*/g) || []).length > 3) {
    return true // Extremely complex recursive patterns are often too broad
  }

  return false
}

/**
 * Simple glob pattern matching for artifact path checking
 */
function matchesGlobPattern(path: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\*\*/g, '§§') // Temporary placeholder for **
    .replace(/\*/g, '[^/]*') // * matches non-slash chars
    .replace(/§§/g, '.*') // ** matches everything including slashes
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(path)
}
