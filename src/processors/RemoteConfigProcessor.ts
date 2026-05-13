import type { GitLabCI } from '../types'
import { ProcessedConfig, type ProcessingContext, resetProcessingContext } from '../ProcessedConfig'
import type { EvaluationContext } from '../rule-evaluation/types'
import { RemoteIncludeResolver } from './RemoteIncludeResolver'
import { expandVariables } from './expandVariables'
import { resolveExtends } from './resolveExtends'
import { resolveReferences } from './resolveReferences'
import { parseWithCustomTags } from './parseWithCustomTags'
import type { GitLabRemoteSource } from '../GitLabRemoteSource'

/**
 * ConfigProcessor variant for handling remote GitLab CI sources
 * where local includes need to be resolved relative to the remote project
 */
export class RemoteConfigProcessor {
  private includeResolver: RemoteIncludeResolver
  private context: ProcessingContext

  constructor(
    private remoteSource: GitLabRemoteSource,
    gitlabHost?: string,
  ) {
    this.context = {
      filePath: remoteSource.getFilePath(),
      baseDir: remoteSource.getBaseDirectory(),
      includedFiles: new Set(),
      includeStack: [],
      remoteJobs: new Set(),
      gitlabHost: gitlabHost ?? 'gitlab.com',
    }
    this.includeResolver = new RemoteIncludeResolver(this.context, remoteSource)
  }

  async process(evaluationContext?: EvaluationContext): Promise<ProcessedConfig> {
    resetProcessingContext(this.context, evaluationContext)

    // Fetch the content from the remote source
    const { content } = await this.remoteSource.fetchContent()

    let config = parseWithCustomTags(content) as GitLabCI

    // Processing pipeline - same as ConfigProcessor
    config = await this.includeResolver.resolve(config)
    config = expandVariables(config)
    config = resolveExtends(config)
    config = resolveReferences(config)

    return new ProcessedConfig(config, this.context)
  }
}
