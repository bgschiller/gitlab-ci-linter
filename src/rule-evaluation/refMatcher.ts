import { safeRegex } from './patternUtils.js'

/** Special keywords for only/except ref matching */
export const SPECIAL_REF_KEYWORDS = [
  'branches',
  'tags',
  'merge_requests',
  'web',
  'api',
  'schedules',
  'pipelines',
  'pushes',
  'triggers',
] as const

export type SpecialRefKeyword = (typeof SPECIAL_REF_KEYWORDS)[number]

export interface RefMatchResult {
  matches: boolean
  reason?: string
}

/**
 * Check if a ref pattern matches a special keyword condition.
 */
export function matchesSpecialKeyword(
  refPattern: string,
  currentRef: string | null | undefined,
  pipelineSource: string | null | undefined,
): boolean {
  switch (refPattern) {
    case 'branches':
      return Boolean(currentRef)
    case 'tags':
      // Would need CI_COMMIT_TAG to verify
      return false
    case 'merge_requests':
      return pipelineSource === 'merge_request_event'
    case 'schedules':
      return pipelineSource === 'schedule'
    case 'web':
      return pipelineSource === 'web'
    case 'api':
      return pipelineSource === 'api'
    case 'pipelines':
      return pipelineSource === 'pipeline'
    case 'pushes':
      return pipelineSource === 'push'
    case 'triggers':
      return pipelineSource === 'trigger'
    default:
      return false
  }
}

/**
 * Get a human-readable reason for a special keyword match.
 */
export function getSpecialKeywordReason(
  refPattern: string,
  pipelineSource: string | null | undefined,
): string {
  switch (refPattern) {
    case 'branches':
      return `'branches' in except refs`
    case 'merge_requests':
      return `pipeline source is merge_request_event`
    case 'schedules':
      return `pipeline source is schedule`
    case 'web':
      return `pipeline source is web`
    case 'api':
      return `pipeline source is api`
    case 'pipelines':
      return `pipeline source is pipeline`
    case 'pushes':
      return `pipeline source is push`
    case 'triggers':
      return `pipeline source is trigger`
    default:
      return `matched '${refPattern}' (source: ${pipelineSource})`
  }
}

/**
 * Check if a ref pattern is a special keyword.
 */
export function isSpecialKeyword(refPattern: string): refPattern is SpecialRefKeyword {
  return SPECIAL_REF_KEYWORDS.includes(refPattern as SpecialRefKeyword)
}

/**
 * Evaluate refs for 'only' condition.
 * Returns true if any ref pattern matches.
 */
export function evaluateOnlyRefs(
  refs: string[],
  currentRef: string | null | undefined,
  pipelineSource: string | null | undefined,
): RefMatchResult {
  for (const refPattern of refs) {
    if (matchesSpecialKeyword(refPattern, currentRef, pipelineSource)) {
      return { matches: true }
    }

    // Check exact ref match or pattern match (skip special keywords)
    if (!isSpecialKeyword(refPattern)) {
      if (currentRef === refPattern) {
        return { matches: true }
      }
      // Check if it's a regex pattern (starts with /)
      if (refPattern.startsWith('/') && refPattern.endsWith('/') && currentRef) {
        const pattern = refPattern.slice(1, -1)
        const regex = safeRegex(pattern)
        if (regex && regex.test(currentRef)) {
          return { matches: true }
        }
      }
    }
  }

  return { matches: false, reason: `ref '${currentRef}' not in only refs [${refs.join(', ')}]` }
}

/**
 * Evaluate refs for 'except' condition.
 * Returns true if any ref pattern matches (meaning the job should be excluded).
 */
export function evaluateExceptRefs(
  refs: string[],
  currentRef: string | null | undefined,
  pipelineSource: string | null | undefined,
): RefMatchResult {
  for (const refPattern of refs) {
    // Check special keywords
    if (matchesSpecialKeyword(refPattern, currentRef, pipelineSource)) {
      return { matches: true, reason: getSpecialKeywordReason(refPattern, pipelineSource) }
    }

    // Check exact ref match (skip special keywords)
    if (!isSpecialKeyword(refPattern)) {
      if (currentRef === refPattern) {
        return { matches: true, reason: `ref '${currentRef}' in except refs` }
      }

      // Check regex pattern
      if (refPattern.startsWith('/') && refPattern.endsWith('/') && currentRef) {
        const pattern = refPattern.slice(1, -1)
        const regex = safeRegex(pattern)
        if (regex && regex.test(currentRef)) {
          return {
            matches: true,
            reason: `ref '${currentRef}' matches except pattern ${refPattern}`,
          }
        }
      }
    }
  }

  return { matches: false }
}
