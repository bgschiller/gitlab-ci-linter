import type { GitLabCI } from '../types'
import type { ProcessingContext } from '../ProcessedConfig'
import type { GitLabRemoteSource } from '../GitLabRemoteSource'
import { IncludeResolver } from './IncludeResolver'
import { parseWithCustomTags } from './parseWithCustomTags'

/**
 * IncludeResolver variant that handles local includes relative to a remote GitLab project
 * instead of the local filesystem
 */
export class RemoteIncludeResolver extends IncludeResolver {
  constructor(
    context: ProcessingContext,
    private remoteSource: GitLabRemoteSource,
  ) {
    super(context)
  }

  /**
   * Override loadLocalInclude to fetch from the remote GitLab project
   * instead of the local filesystem
   */
  protected override async loadLocalInclude(
    localPath: string,
  ): Promise<{ content: string | null; resolvedPath?: string; alreadyProcessed?: boolean }> {
    // Create a remote path by combining the project info with the local path
    const remotePath = `${(this.remoteSource as any).project}:${localPath}@${(this.remoteSource as any).ref}`

    // Check for circular includes
    if (this.context.includeStack.includes(remotePath)) {
      console.warn(
        `Warning: Circular include detected: ${[...this.context.includeStack, remotePath].join(' → ')}`,
      )
      return { content: null }
    }

    // Check if already processed
    if (this.context.includedFiles.has(remotePath)) {
      return { content: null, alreadyProcessed: true }
    }

    try {
      // Create a new remote source for this include file
      const { GitLabRemoteSource } = await import('../GitLabRemoteSource')
      const includeRemoteSource = new GitLabRemoteSource(
        (this.remoteSource as any).project,
        (this.remoteSource as any).ref,
        localPath,
      )

      // Fetch the content
      const { content } = await includeRemoteSource.fetchContent()

      // Mark as included
      this.context.includedFiles.add(remotePath)

      return {
        content,
        resolvedPath: remotePath,
      }
    } catch (error) {
      console.warn(
        `Warning: Failed to fetch remote include '${localPath}' from ${(this.remoteSource as any).project} at ${(this.remoteSource as any).ref}: ${error}`,
      )
      return { content: null }
    }
  }

  /**
   * Override resolveIncludesRecursive to handle remote local includes properly
   */
  protected override async resolveIncludesRecursive(
    config: GitLabCI,
    currentDir: string,
  ): Promise<GitLabCI> {
    const result = { ...config }

    if (!result.include) return result

    const includes = Array.isArray(result.include) ? result.include : [result.include]

    for (const rawInclude of includes) {
      // GitLab supports shorthand string includes which are treated as local includes
      const include = typeof rawInclude === 'string' ? { local: rawInclude } : rawInclude

      const { content, resolvedPath, alreadyProcessed } = await this.loadInclude(
        include,
        currentDir,
      )

      if (content) {
        const parsed = parseWithCustomTags(content) as GitLabCI
        // For remote sources, all includes are treated as remote
        const isRemote = true
        this.mergeConfig(result, parsed, isRemote)

        // Recursively process includes in the newly loaded config
        // For local includes in remote sources, keep using remote resolution
        if (resolvedPath) {
          this.context.includeStack.push(resolvedPath)
          const processedParsed = await this.resolveIncludesRecursive(parsed, currentDir)
          this.context.includeStack.pop()
          // Re-merge the processed result
          this.mergeConfig(result, processedParsed, isRemote)
        } else {
          const processedParsed = await this.resolveIncludesRecursive(parsed, currentDir)
          this.mergeConfig(result, processedParsed, isRemote)
        }
      } else if (!alreadyProcessed) {
        // Only warn when we fail to resolve an include (not when it's already processed)
        this.warnFailedInclude(include, currentDir)
      }
    }

    delete result.include
    return result
  }
}
