import { dirname } from 'path'
import type { GitLabCI } from '../types'
import { ProcessedConfig, type ProcessingContext, resetProcessingContext } from '../ProcessedConfig'
import type { EvaluationContext } from '../rule-evaluation/types'
import { IncludeResolver } from './IncludeResolver'
import { expandVariables } from './expandVariables'
import { resolveExtends } from './resolveExtends'
import { resolveReferences } from './resolveReferences'
import { type ParseOptions, parseWithCustomTags } from './parseWithCustomTags'

export interface ConfigProcessorOptions {
  /** Override the root directory for resolving local includes (defaults to dirname of filePath) */
  rootDir?: string
  /** GitLab host for resolving component includes (defaults to gitlab.com) */
  gitlabHost?: string
}

export class ConfigProcessor {
  private includeResolver: IncludeResolver
  private context: ProcessingContext

  constructor(
    private content: string,
    filePath: string,
    options?: ConfigProcessorOptions,
  ) {
    this.context = {
      filePath,
      baseDir: options?.rootDir ?? dirname(filePath),
      includedFiles: new Set(),
      includeStack: [],
      remoteJobs: new Set(),
      gitlabHost: options?.gitlabHost ?? 'gitlab.com',
    }
    this.includeResolver = new IncludeResolver(this.context)
  }

  /**
   * Process the configuration.
   *
   * @param evaluationContext - When provided, includes with `rules:` are
   *   evaluated against this scenario context. Includes whose rules don't
   *   match (or match with `when: never`) are skipped. When omitted, all
   *   includes load regardless of `rules` — matches pre-existing behavior.
   */
  async process(evaluationContext?: EvaluationContext): Promise<ProcessedConfig> {
    resetProcessingContext(this.context, evaluationContext)

    const parseOptions: ParseOptions = {
      filePath: this.context.filePath,
      includeStack: [],
    }
    let config = parseWithCustomTags(this.content, parseOptions) as GitLabCI

    // Processing pipeline
    config = await this.includeResolver.resolve(config)
    config = expandVariables(config)
    config = resolveExtends(config)
    config = resolveReferences(config)

    return new ProcessedConfig(config, this.context)
  }
}
