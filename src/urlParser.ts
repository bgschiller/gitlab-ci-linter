/**
 * Utilities for parsing GitLab URLs and project/ref combinations
 * into normalized project and ref information for API calls.
 */

export interface ParsedGitLabRef {
  project: string
  ref: string
  file?: string
  /** Host parsed from the URL, when available (e.g. "gitlab.com"). */
  host?: string
}

/**
 * Parse various GitLab URL formats and project/ref combinations:
 * - https://gitlab.com/group/project/-/commit/225a63dd1fa2b38ee101f7a7bc6a55248ad649bd
 * - https://gitlab.example.com/group/project/-/tree/main/.gitlab-ci.yml
 * - group/project 225a63dd1fa2b38ee101f7a7bc6a55248ad649bd
 * - group/project 225a63dd1 (short sha)
 * - group/project some-branch-name (branch name)
 */
export function parseGitLabInput(input: string, secondArg?: string): ParsedGitLabRef | null {
  // If secondArg is provided, treat input as project and secondArg as ref
  if (secondArg) {
    return {
      project: input.trim(),
      ref: secondArg.trim(),
    }
  }

  const trimmed = input.trim()

  // Check if it's a URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return parseGitLabUrl(trimmed)
  }

  // Not a URL and no second argument - not valid for our use case
  return null
}

/**
 * Parse GitLab URLs to extract project and ref information
 */
function parseGitLabUrl(url: string): ParsedGitLabRef | null {
  try {
    const parsedUrl = new URL(url)

    // Extract the pathname and remove leading slash
    const pathname = parsedUrl.pathname.substring(1)

    // Look for different GitLab URL patterns

    // Pattern 1: /-/commit/sha (commit URL)
    const commitMatch = pathname.match(/^(.+?)\/-\/commit\/([a-f0-9]+)/)
    if (commitMatch) {
      return {
        project: commitMatch[1]!,
        ref: commitMatch[2]!,
        host: parsedUrl.hostname,
      }
    }

    // Pattern 2: /-/tree/branch/path (tree view with file)
    const treeMatch = pathname.match(/^(.+?)\/-\/tree\/(.+)/)
    if (treeMatch) {
      const project = treeMatch[1]!
      const branchAndFile = treeMatch[2]!

      // Find the last slash to separate branch from file
      const lastSlashIndex = branchAndFile.lastIndexOf('/')
      if (lastSlashIndex > 0) {
        const ref = branchAndFile.substring(0, lastSlashIndex)
        const file = branchAndFile.substring(lastSlashIndex + 1)
        return {
          project,
          ref,
          file,
          host: parsedUrl.hostname,
        }
      } else {
        // No file, just a branch
        return {
          project,
          ref: branchAndFile,
          host: parsedUrl.hostname,
        }
      }
    }

    // Pattern 4: /-/blob/branch/file (blob view)
    // This needs to handle branch names that contain slashes like "feature/ci-updates"
    const blobMatch = pathname.match(/^(.+?)\/-\/blob\/(.+)/)
    if (blobMatch) {
      const project = blobMatch[1]!
      const branchAndFile = blobMatch[2]!

      // Find the last slash to separate branch from file
      const lastSlashIndex = branchAndFile.lastIndexOf('/')
      if (lastSlashIndex > 0) {
        const ref = branchAndFile.substring(0, lastSlashIndex)
        const file = branchAndFile.substring(lastSlashIndex + 1)
        return {
          project,
          ref,
          file,
          host: parsedUrl.hostname,
        }
      }
    }

    // Pattern 5: Basic project URL - assume main/master branch
    if (!pathname.includes('/-/')) {
      // Only handle GitLab URLs (not GitHub or other platforms)
      if (!parsedUrl.hostname?.includes('gitlab')) {
        return null
      }

      // Remove trailing slash and ensure valid project path
      const cleanPath = pathname.replace(/\/$/, '')
      if (cleanPath && isValidProjectPath(cleanPath)) {
        return {
          project: cleanPath,
          ref: 'main', // Default to main branch
          host: parsedUrl.hostname,
        }
      }
    }

    return null
  } catch (_error) {
    return null
  }
}

/**
 * Validate if a string looks like a valid GitLab project path
 */
export function isValidProjectPath(project: string): boolean {
  // GitLab project paths should contain at least one slash and valid characters
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(project)
}

/**
 * Validate if a string looks like a valid Git reference (branch, tag, or SHA)
 */
export function isValidRef(ref: string): boolean {
  // Git refs can contain alphanumeric, hyphens, underscores, dots, and slashes
  // SHA can be 7-40 characters of hex
  return /^[a-zA-Z0-9_./-]+$/.test(ref) && ref.length >= 1 && ref.length <= 255
}

/**
 * Determine if a ref is likely a commit SHA vs a branch/tag name
 */
export function isLikelyCommitSha(ref: string): boolean {
  // Consider it a SHA if it's 7-40 hex characters
  return /^[a-f0-9]{7,40}$/.test(ref)
}
