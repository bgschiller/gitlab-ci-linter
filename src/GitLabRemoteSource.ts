import type { ParsedGitLabRef } from './urlParser'
import { getGlabEnv } from './processors/IncludeResolver'

/**
 * GitLab remote source that fetches .gitlab-ci.yml files from GitLab repositories
 * using the MCP GitLab API integration or fallback methods.
 */
export class GitLabRemoteSource {
  constructor(
    private project: string,
    private ref: string,
    private file = '.gitlab-ci.yml',
    private host?: string,
  ) {}

  /**
   * Create a GitLabRemoteSource from parsed GitLab input
   */
  static fromParsedRef(parsed: ParsedGitLabRef): GitLabRemoteSource {
    return new GitLabRemoteSource(
      parsed.project,
      parsed.ref,
      parsed.file || '.gitlab-ci.yml',
      parsed.host,
    )
  }

  /**
   * Fetch the GitLab CI content from the remote repository
   */
  async fetchContent(): Promise<{ content: string; filePath: string }> {
    try {
      // Try MCP GitLab integration first if available
      const mcpResult = await this.tryMcpGitLabFetch()
      if (mcpResult) {
        return mcpResult
      }
    } catch (_error) {
      console.warn('MCP GitLab fetch failed, falling back to existing methods')
    }

    // Fallback to existing glab/curl approach
    return await this.fallbackFetch()
  }

  /**
   * Try to use MCP GitLab integration to fetch file content
   */
  private async tryMcpGitLabFetch(): Promise<{ content: string; filePath: string } | null> {
    try {
      // Check if MCP GitLab functions are available
      if (typeof (globalThis as any).mcp__gitlab__get_file_contents === 'function') {
        const result = await (globalThis as any).mcp__gitlab__get_file_contents({
          project_id: this.project,
          file_path: this.file,
          ref: this.ref,
        })

        if (result && typeof result === 'object' && 'content' in result) {
          // MCP returns base64 encoded content for files
          const content =
            result.encoding === 'base64'
              ? Buffer.from(result.content, 'base64').toString('utf8')
              : result.content

          return {
            content,
            filePath: `${this.project}:${this.file}@${this.ref}`,
          }
        }
      }
    } catch (_error) {
      // MCP not available or failed, continue to fallback
    }

    return null
  }

  /**
   * Fallback to existing glab/curl methods from IncludeResolver
   */
  private async fallbackFetch(): Promise<{ content: string; filePath: string }> {
    const { execSync } = await import('child_process')

    // Prefer the host parsed from the original URL when present; fall back to gitlab.com.
    const host = this.host ?? 'gitlab.com'

    // Try multiple approaches similar to IncludeResolver
    const approaches = [
      // Approach 1: Standard glab API with ref
      () => {
        const encodedProject = encodeURIComponent(this.project)
        const encodedFile = encodeURIComponent(this.file)
        const refParam = `?ref=${encodeURIComponent(this.ref)}`
        return `glab api projects/${encodedProject}/repository/files/${encodedFile}/raw${refParam}`
      },

      // Approach 2: Remove leading slash if present
      () => {
        const encodedProject = encodeURIComponent(this.project)
        const cleanFile = this.file.startsWith('/') ? this.file.slice(1) : this.file
        const encodedFile = encodeURIComponent(cleanFile)
        const refParam = `?ref=${encodeURIComponent(this.ref)}`
        return `glab api projects/${encodedProject}/repository/files/${encodedFile}/raw${refParam}`
      },
    ]

    for (const approach of approaches) {
      const command = approach()

      try {
        const content = execSync(command, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: getGlabEnv(host),
        })

        return {
          content,
          filePath: `${this.project}:${this.file}@${this.ref}`,
        }
      } catch (_glabError) {
        // Try curl fallback for gitlab.com
        if (host === 'gitlab.com') {
          try {
            const encodedProject = encodeURIComponent(this.project)
            const encodedFile = encodeURIComponent(this.file)
            const refParam = `?ref=${encodeURIComponent(this.ref)}`
            const curlUrl = `https://gitlab.com/api/v4/projects/${encodedProject}/repository/files/${encodedFile}/raw${refParam}`

            const content = execSync(`curl -s "${curlUrl}"`, {
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'],
            })

            if (content && !content.includes('404')) {
              return {
                content,
                filePath: `${this.project}:${this.file}@${this.ref}`,
              }
            }
          } catch (_curlError) {
            // Continue to next approach
          }
        }
      }
    }

    throw new Error(`Failed to fetch ${this.file} from ${this.project} at ref ${this.ref}`)
  }

  /**
   * Get a virtual base directory for resolving local includes
   * This creates a path that indicates it's from a remote source
   */
  getBaseDirectory(): string {
    return `/virtual/gitlab/${this.project}@${this.ref}`
  }

  /**
   * Get the effective file path for this remote source
   */
  getFilePath(): string {
    return `${this.project}:${this.file}@${this.ref}`
  }
}

// Extend global to include MCP types if they exist
declare global {
  const mcp__gitlab__get_file_contents:
    | ((params: { project_id: string; file_path: string; ref?: string }) => Promise<{
        content: string
        encoding?: string
        file_path: string
        ref: string
        [key: string]: any
      }>)
    | undefined
}
