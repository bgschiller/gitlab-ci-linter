import { existsSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { GitLabCILinter } from '../GitLabCILinter'
import { GitLabRemoteSource } from '../GitLabRemoteSource'
import { isValidProjectPath, isValidRef, parseGitLabInput } from '../urlParser'

export interface ResolvedSource {
  filePath?: string
  remoteSource?: GitLabRemoteSource
}

/**
 * Resolve the source from positional args: two args = remote project+ref,
 * one arg = either a GitLab URL or local file, zero args = default
 * `.gitlab-ci.yml`. Throws on invalid two-arg combinations.
 */
export function resolveSource(positionals: string[]): ResolvedSource {
  const [first, second] = positionals
  if (first !== undefined && second !== undefined) {
    if (!isValidProjectPath(first) || !isValidRef(second)) {
      throw new Error(`Invalid project path '${first}' or ref '${second}'`)
    }
    return { remoteSource: new GitLabRemoteSource(first, second) }
  }
  if (first !== undefined) {
    const parsed = parseGitLabInput(first)
    return parsed ? { remoteSource: GitLabRemoteSource.fromParsedRef(parsed) } : { filePath: first }
  }
  return { filePath: '.gitlab-ci.yml' }
}

export interface BuildLinterOptions {
  rootDir?: string
  gitlabHost?: string
  evaluateChildren?: boolean
}

/**
 * Construct a {@link GitLabCILinter} from a resolved source. Remote source
 * wins; otherwise reads the local file (or `.gitlab-ci.yml` within a passed
 * directory). Exits with code 1 on missing/invalid input.
 */
export function buildLinter(source: ResolvedSource, opts: BuildLinterOptions = {}): GitLabCILinter {
  if (source.remoteSource) return GitLabCILinter.fromRemoteSource(source.remoteSource)

  if (!source.filePath) {
    console.error('Error: No input source specified')
    process.exit(1)
  }
  if (!existsSync(source.filePath)) {
    console.error(`Error: File ${source.filePath} not found`)
    process.exit(1)
  }
  let resolvedFilePath = source.filePath
  const stats = statSync(source.filePath)
  if (stats.isDirectory()) {
    const gitlabCiPath = join(source.filePath, '.gitlab-ci.yml')
    if (!existsSync(gitlabCiPath)) {
      console.error(`Error: Directory ${source.filePath} does not contain .gitlab-ci.yml`)
      process.exit(1)
    }
    resolvedFilePath = gitlabCiPath
  }
  const content = readFileSync(resolvedFilePath, 'utf8')
  return new GitLabCILinter(content, resolve(resolvedFilePath), opts)
}
