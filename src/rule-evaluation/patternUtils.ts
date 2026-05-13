/** Maximum length for regex patterns to prevent ReDoS attacks */
export const MAX_REGEX_PATTERN_LENGTH = 200

/**
 * Safely create a RegExp from a pattern with protection against ReDoS.
 * Returns null if the pattern is too long or invalid.
 */
export function safeRegex(pattern: string): RegExp | null {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return null
  }
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

/**
 * Format a list of patterns for display, truncating if needed.
 */
export function formatPatternList(patterns: string[], maxItems = 2): string {
  if (patterns.length <= maxItems) {
    return patterns.join(', ')
  }
  return `${patterns.slice(0, maxItems).join(', ')}...`
}

/**
 * Convert a glob pattern to a safe regex.
 * Escapes special regex characters before converting glob wildcards.
 */
export function globToRegex(pattern: string): RegExp | null {
  // First escape special regex characters (except * and ?)
  // Handle **/ separately: it means "zero or more directories" in GitLab globs
  // Replace ? before placeholders to avoid clobbering regex ? quantifiers
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*\*\//g, '<<<DOUBLESTARSLASH>>>')
    .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<DOUBLESTARSLASH>>>/g, '(.*/)?')
    .replace(/<<<DOUBLESTAR>>>/g, '.*')

  return safeRegex(`^${escaped}$`)
}

/**
 * Evaluate glob patterns against a list of files.
 * Returns true if any pattern matches any file.
 */
export function matchesAnyPattern(patterns: string[], files: string[]): boolean {
  return patterns.some(pattern => {
    const regex = globToRegex(pattern)
    if (!regex) {
      return false
    }
    return files.some(file => regex.test(file))
  })
}
