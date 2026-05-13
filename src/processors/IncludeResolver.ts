import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { execFileSync, execSync } from 'child_process'
import { glob } from 'glob'
import { parseDocument, type Scalar, visit } from 'yaml'
import type { GitLabCI, GitLabInclude, GitLabRule } from '../types'
import type { ProcessingContext } from '../ProcessedConfig'
import { evaluateRule } from '../rule-evaluation/modernRuleEvaluator.js'
import { type ParseOptions, parseWithCustomTags } from './parseWithCustomTags'

interface ParsedComponentPath {
  host: string
  project: string
  component?: string
  version: string
}

interface ComponentSpec {
  inputs?: Record<string, { default?: unknown; type?: string }>
}

/** Cache for glab auth health check results per host. */
const glabHostOverride: Record<string, string | null> = {}

/**
 * Cache for remote content fetched via glab API or curl.
 *
 * Keyed by a unique string (e.g., "gitlab:project:file:ref" or "remote:url").
 * Persists across ConfigProcessor.process() calls so that batch test runs
 * (e.g., 67 CI scenarios) don't re-fetch the same remote templates on every
 * scenario. The ConfigProcessor resets context.includedFiles (which controls
 * whether an include is *processed*) but the content cache avoids redundant
 * network calls for immutable remote content.
 */
const remoteContentCache = new Map<string, string | null>()

/**
 * Get the environment for glab commands, with correct GITLAB_HOST handling.
 * Checks if glab is authenticated for the given host, falls back to default auth
 * if not (e.g., when local glab is authed against a SSH host alias but GITLAB_HOST
 * is set to the canonical HTTPS hostname).
 */
export function getGlabEnv(host: string): NodeJS.ProcessEnv {
  if (!(host in glabHostOverride)) {
    // Try with explicit GITLAB_HOST
    try {
      execFileSync('glab', ['auth', 'status', '--hostname', host], { stdio: 'pipe' })
      glabHostOverride[host] = host
    } catch (_hostErr: unknown) {
      // Try without GITLAB_HOST (default glab config)
      try {
        execFileSync('glab', ['auth', 'status'], { stdio: 'pipe' })
        console.warn(
          `Warning: glab not authenticated for '${host}', ` +
            'using default glab auth. External includes will resolve via default host.',
        )
        // Cache the successful fallback
        glabHostOverride[host] = null
      } catch (defaultErr: unknown) {
        const isEnoent =
          defaultErr instanceof Error &&
          'code' in defaultErr &&
          (defaultErr as NodeJS.ErrnoException).code === 'ENOENT'
        const stderr = (defaultErr as { stderr?: Buffer })?.stderr?.toString('utf8').trim()
        if (isEnoent) {
          console.warn(
            `Warning: glab CLI not found. Install it with: brew install glab\n` +
              '  External includes (components, project refs) will not be resolved.',
          )
        } else {
          console.warn(
            `Warning: glab not authenticated for '${host}' or default host. ` +
              `Run: glab auth login --hostname ${host}\n` +
              (stderr ? `  Detail: ${stderr}\n` : '') +
              '  External includes (components, project refs) will not be resolved.',
          )
        }
        // Do NOT cache auth failures — allow retry if user fixes auth mid-session
      }
    }
  }
  const override = glabHostOverride[host]
  return override ? { ...process.env, GITLAB_HOST: override } : { ...process.env }
}

/**
 * Reset the glab host override cache (for testing).
 */
export function resetGlabHostCache(): void {
  for (const key of Object.keys(glabHostOverride)) {
    delete glabHostOverride[key]
  }
}

/**
 * Pre-populate the glab host cache (for testing), bypassing the auth check.
 */
export function primeGlabHostCache(host: string, override: string | null = host): void {
  glabHostOverride[host] = override
}

/**
 * Reset the remote content cache (for testing).
 */
export function resetRemoteContentCache(): void {
  remoteContentCache.clear()
}

/**
 * Pre-populate the remote content cache (for testing).
 */
export function primeRemoteContentCache(key: string, content: string | null): void {
  remoteContentCache.set(key, content)
}

/**
 * Stringify a primitive YAML scalar value for inline-text interpolation.
 * GitLab CI component inputs are typed `string`, `number`, `boolean`, or
 * `array` — bigint isn't in the spec, and YAML parsers route integers to
 * `number`, so we don't accept bigint here.
 */
function primitiveToYamlString(v: string | number | boolean): string {
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return v.toString()
}

export class IncludeResolver {
  constructor(protected context: ProcessingContext) {}

  /**
   * Decide whether an include should be loaded under its `rules:` (if any).
   *
   * GitLab semantics: first matching rule wins. If the matching rule has
   * `when: never`, skip the include. If no rule matches, skip. Else include.
   *
   * Skipped only when an evaluation context is set on this processor — without
   * one (default linting mode), all includes load regardless of `rules`.
   */
  protected shouldIncludeUnderRules(include: GitLabInclude): boolean {
    const rules: GitLabRule[] | undefined = include.rules
    if (!rules || rules.length === 0) return true
    if (!this.context.evaluationContext) return true

    for (const rule of rules) {
      const { matches } = evaluateRule(rule, this.context.evaluationContext)
      if (matches) {
        return rule.when !== 'never'
      }
    }
    return false
  }

  async resolve(config: GitLabCI): Promise<GitLabCI> {
    // Add the main file to the include stack
    this.context.includeStack.push(this.context.filePath)
    const result = await this.resolveIncludesRecursive(config, this.context.baseDir)
    this.context.includeStack.pop()
    return result
  }

  protected async resolveIncludesRecursive(
    config: GitLabCI,
    currentDir: string,
  ): Promise<GitLabCI> {
    const result = { ...config }

    if (result.include) {
      const includes = Array.isArray(result.include) ? result.include : [result.include]

      for (const rawInclude of includes) {
        // GitLab supports shorthand string includes which are treated as local includes
        const include = typeof rawInclude === 'string' ? { local: rawInclude } : rawInclude

        if (!this.shouldIncludeUnderRules(include)) {
          continue
        }

        await this.processSingleInclude(include, currentDir, result)
      }

      delete result.include
    }

    return result
  }

  /**
   * Load and merge a single include into the accumulating result. Pulled out
   * of {@link resolveIncludesRecursive} to keep that loop's cognitive
   * complexity low — this helper handles the load → parse → merge → recurse
   * pipeline for one include, plus circular-detection bookkeeping.
   */
  private async processSingleInclude(
    include: GitLabInclude,
    currentDir: string,
    result: GitLabCI,
  ): Promise<void> {
    const { content, resolvedPath, alreadyProcessed } = await this.loadInclude(include, currentDir)

    if (!content) {
      if (!alreadyProcessed) {
        // Only warn when we fail to resolve an include (not when it's already processed)
        this.warnFailedInclude(include, currentDir)
      }
      return
    }

    const parseOptions: ParseOptions = {
      filePath: resolvedPath || this.describeInclude(include),
      includeStack: [...this.context.includeStack],
    }
    const parsed = parseWithCustomTags(content, parseOptions) as GitLabCI
    // Determine if this is a remote include
    const isRemote = !include.local
    this.mergeConfig(result, parsed, isRemote)

    // Recursively process includes in the newly loaded config.
    // For local includes, always use the base directory (project root);
    // for remote includes, use the current directory.
    const nextDir = include.local ? this.context.baseDir : currentDir

    if (resolvedPath) {
      this.context.includeStack.push(resolvedPath)
    }
    try {
      const processedParsed = await this.resolveIncludesRecursive(parsed, nextDir)
      this.mergeConfig(result, processedParsed, isRemote)
    } finally {
      if (resolvedPath) {
        this.context.includeStack.pop()
      }
    }
  }

  protected async loadInclude(
    include: GitLabInclude,
    _currentDir: string,
  ): Promise<{ content: string | null; resolvedPath?: string; alreadyProcessed?: boolean }> {
    try {
      if (include.local) {
        return await this.loadLocalInclude(include.local)
      }

      if (include.project && include.file) {
        return await this.loadProjectInclude(include.project, include.file, include.ref)
      }

      if (include.remote) {
        return await this.loadRemoteInclude(include.remote)
      }

      if (include.template) {
        return await this.loadTemplateInclude(include.template)
      }

      if (include.component) {
        return await this.loadComponentInclude(include.component, include.inputs)
      }
    } catch (error) {
      console.warn(`Warning: Failed to load include: ${error}`)
    }

    return { content: null }
  }

  protected async loadLocalInclude(
    localPath: string,
  ): Promise<{ content: string | null; resolvedPath?: string; alreadyProcessed?: boolean }> {
    const isGlob = localPath.includes('*') || localPath.includes('?') || localPath.includes('[')
    return isGlob ? this.loadGlobLocalInclude(localPath) : this.loadSingleLocalFile(localPath)
  }

  /**
   * Resolve, parse, and merge every file matched by a glob `local:` include.
   * Split out from `loadLocalInclude` so the dispatcher there stays trivial
   * and this glob path keeps its own complexity budget.
   */
  private async loadGlobLocalInclude(
    localPath: string,
  ): Promise<{ content: string | null; resolvedPath?: string; alreadyProcessed?: boolean }> {
    // GitLab's `local: '/path'` is repo-root-relative, NOT a filesystem
    // absolute path. node:path.resolve treats a leading `/` as absolute and
    // discards baseDir, so strip the leading slash before resolving.
    const repoRelativePath = localPath.startsWith('/') ? localPath.slice(1) : localPath
    const globPattern = resolve(this.context.baseDir, repoRelativePath)

    try {
      const matchedFiles = await glob(globPattern)
      if (matchedFiles.length === 0) {
        return { content: null }
      }

      const combinedConfig: GitLabCI = {}
      let hasContent = false
      for (const matchedFile of matchedFiles) {
        if (await this.mergeGlobMatchedFile(matchedFile, combinedConfig)) {
          hasContent = true
        }
      }

      if (!hasContent) {
        return { content: null, resolvedPath: globPattern }
      }

      try {
        const { stringify } = await import('yaml')
        return { content: stringify(combinedConfig), resolvedPath: globPattern }
      } catch (error) {
        console.warn(`Warning: Failed to serialize combined YAML: ${error}`)
        return { content: null }
      }
    } catch (error) {
      console.warn(`Warning: Failed to expand glob pattern '${localPath}': ${error}`)
      return { content: null }
    }
  }

  /**
   * Read, parse, and merge a single glob-matched file into `combinedConfig`.
   * Returns true iff content was contributed (i.e., the file existed and
   * wasn't filtered out as circular or already-processed).
   */
  private async mergeGlobMatchedFile(
    matchedFile: string,
    combinedConfig: GitLabCI,
  ): Promise<boolean> {
    if (this.context.includeStack.includes(matchedFile)) {
      console.warn(
        `Warning: Circular include detected: ${[...this.context.includeStack, matchedFile].join(' → ')}`,
      )
      return false
    }
    if (this.context.includedFiles.has(matchedFile)) {
      return false
    }
    if (!existsSync(matchedFile)) {
      return false
    }

    this.context.includedFiles.add(matchedFile)
    const fileContent = readFileSync(matchedFile, 'utf8')
    const parseOptions: ParseOptions = {
      filePath: matchedFile,
      includeStack: [...this.context.includeStack],
    }
    let parsedConfig = parseWithCustomTags(fileContent, parseOptions)

    // Recursively resolve any include directives within glob-matched files
    // (e.g., component includes inside deploy_prod.yml matched by *.yml glob).
    if (parsedConfig.include) {
      this.context.includeStack.push(matchedFile)
      parsedConfig = await this.resolveIncludesRecursive(parsedConfig, this.context.baseDir)
      this.context.includeStack.pop()
    }

    this.mergeConfig(combinedConfig, parsedConfig, false)
    return true
  }

  private async loadSingleLocalFile(
    localPath: string,
  ): Promise<{ content: string | null; resolvedPath?: string; alreadyProcessed?: boolean }> {
    // GitLab's `local: '/path'` is repo-root-relative, NOT a filesystem
    // absolute path. node:path.resolve treats a leading `/` as absolute and
    // discards baseDir, so strip the leading slash before resolving.
    const repoRelativePath = localPath.startsWith('/') ? localPath.slice(1) : localPath
    // Local includes are always resolved relative to the base directory (project root)
    const resolvedPath = resolve(this.context.baseDir, repoRelativePath)

    // Check for true circular includes (current file already in include stack)
    if (this.context.includeStack.includes(resolvedPath)) {
      console.warn(
        `Warning: Circular include detected: ${[...this.context.includeStack, resolvedPath].join(' → ')}`,
      )
      return { content: null }
    }

    // Check if already processed to avoid duplicate processing
    if (this.context.includedFiles.has(resolvedPath)) {
      // File already processed - return null without warning
      // This is normal when the same file is included from multiple places
      return { content: null, alreadyProcessed: true }
    }

    if (existsSync(resolvedPath)) {
      // Mark this file as included
      this.context.includedFiles.add(resolvedPath)
      return {
        content: readFileSync(resolvedPath, 'utf8'),
        resolvedPath: resolvedPath,
      }
    }

    // File not found - return null so caller can issue warning
    return { content: null }
  }

  private async loadProjectInclude(
    project: string,
    file: string | string[],
    ref?: string,
  ): Promise<{ content: string | null; alreadyProcessed?: boolean }> {
    const files = Array.isArray(file) ? file : [file]
    const includeKey = `${project}:${files.join(',')}:${ref || 'default'}`

    // Check if already processed to avoid infinite processing
    if (this.context.includedFiles.has(includeKey)) {
      // File already processed - return null without warning
      return { content: null, alreadyProcessed: true }
    }

    this.context.includedFiles.add(includeKey)
    const content = await this.loadFromGitLab(project, file, ref)
    return { content }
  }

  private async loadRemoteInclude(
    url: string,
  ): Promise<{ content: string | null; alreadyProcessed?: boolean }> {
    // Check if already processed to avoid infinite processing
    if (this.context.includedFiles.has(url)) {
      // File already processed - return null without warning
      return { content: null, alreadyProcessed: true }
    }

    this.context.includedFiles.add(url)
    const content = await this.loadRemoteFile(url)
    return { content }
  }

  private async loadTemplateInclude(
    template: string,
  ): Promise<{ content: string | null; alreadyProcessed?: boolean }> {
    const templateKey = `template:${template}`

    // Check if already processed to avoid infinite processing
    if (this.context.includedFiles.has(templateKey)) {
      // File already processed - return null without warning
      return { content: null, alreadyProcessed: true }
    }

    this.context.includedFiles.add(templateKey)
    const content = await this.loadTemplate(template)
    return { content }
  }

  private async loadFromGitLab(
    project: string,
    file: string | string[],
    ref?: string,
  ): Promise<string | null> {
    try {
      const files = Array.isArray(file) ? file : [file]
      let combinedContent = ''

      for (const f of files) {
        const cacheKey = `gitlab:${project}:${f}:${ref || 'default'}`
        let content: string | null | undefined

        if (remoteContentCache.has(cacheKey)) {
          content = remoteContentCache.get(cacheKey) ?? null
        } else {
          content = await this.tryMultipleGlabApproaches(project, f, ref)
          remoteContentCache.set(cacheKey, content)
        }

        if (content) {
          combinedContent += content + '\n'
        } else if (files.length === 1) {
          return null
        }
      }

      return combinedContent || null
    } catch (error) {
      console.warn(`Warning: GitLab API access failed: ${error}`)
      return null
    }
  }

  private async tryMultipleGlabApproaches(
    project: string,
    file: string,
    ref?: string,
  ): Promise<string | null> {
    // For GitLab official projects (like gitlab-org/gitlab), try gitlab.com first.
    // For other projects, prefer the configured host and fall back to gitlab.com.
    const configuredHost = this.context.gitlabHost
    const hosts =
      project.startsWith('gitlab-org/') || configuredHost === 'gitlab.com'
        ? ['gitlab.com', ...(configuredHost === 'gitlab.com' ? [] : [configuredHost])]
        : [configuredHost, 'gitlab.com']

    for (const host of hosts) {
      const result = await this.tryGlabWithHost(project, file, ref, host)
      if (result) {
        return result
      }
    }

    // No verbose error - the individual host methods will show appropriate warnings
    return null
  }

  private async tryGlabWithHost(
    project: string,
    file: string,
    ref: string | undefined,
    host: string,
  ): Promise<string | null> {
    const approaches = [
      // Approach 1: Standard approach with ref
      () => {
        if (!ref) return null
        const encodedProject = encodeURIComponent(project)
        const encodedFile = encodeURIComponent(file)
        const refParam = `?ref=${encodeURIComponent(ref)}`
        return `glab api projects/${encodedProject}/repository/files/${encodedFile}/raw${refParam}`
      },

      // Approach 2: Without ref (use default branch)
      () => {
        const encodedProject = encodeURIComponent(project)
        const encodedFile = encodeURIComponent(file)
        return `glab api projects/${encodedProject}/repository/files/${encodedFile}/raw`
      },

      // Approach 3: Remove leading slash from file path
      () => {
        if (!ref) return null
        const encodedProject = encodeURIComponent(project)
        const cleanFile = file.startsWith('/') ? file.slice(1) : file
        const encodedFile = encodeURIComponent(cleanFile)
        const refParam = `?ref=${encodeURIComponent(ref)}`
        return `glab api projects/${encodedProject}/repository/files/${encodedFile}/raw${refParam}`
      },

      // Approach 4: Remove leading slash and try without ref
      () => {
        const encodedProject = encodeURIComponent(project)
        const cleanFile = file.startsWith('/') ? file.slice(1) : file
        const encodedFile = encodeURIComponent(cleanFile)
        return `glab api projects/${encodedProject}/repository/files/${encodedFile}/raw`
      },
    ]

    for (let i = 0; i < approaches.length; i++) {
      const approach = approaches[i]
      if (!approach) continue
      const command = approach()
      if (!command) continue

      try {
        const result = execSync(command, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: getGlabEnv(host),
        })
        return result
      } catch (glabError: unknown) {
        // Log the actual error for debugging (only if DEBUG_GLAB is set)
        if (process.env['DEBUG_GLAB']) {
          const errorMessage =
            glabError instanceof Error
              ? glabError.message
              : (glabError as { stderr?: string })?.stderr || String(glabError)
          console.warn(`  [DEBUG] glab api failed for ${host}/${project}/${file}:`)
          console.warn(`  [DEBUG] Command: ${command}`)
          console.warn(`  [DEBUG] Error: ${errorMessage}`)
        }

        // For gitlab.com, try curl as fallback since it might be a public repo
        if (host === 'gitlab.com') {
          try {
            const encodedProject = encodeURIComponent(project)
            const encodedFile = encodeURIComponent(file)
            const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : ''
            const curlUrl = `https://gitlab.com/api/v4/projects/${encodedProject}/repository/files/${encodedFile}/raw${refParam}`
            const curlResult = execSync(`curl -s "${curlUrl}"`, {
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'],
            })
            if (curlResult && !curlResult.includes('404')) {
              return curlResult
            }
          } catch (_curlError) {
            // Continue to next approach
          }
        }

        // Only show detailed error for the last approach on the configured host
        if (host === this.context.gitlabHost && i === approaches.length - 1) {
          console.warn(`Warning: Unable to fetch '${file}' from ${host}/${project}`)
          if (ref) console.warn(`  (ref: ${ref})`)
        }
      }
    }

    return null
  }

  private async loadRemoteFile(url: string): Promise<string | null> {
    const cacheKey = `remote:${url}`
    if (remoteContentCache.has(cacheKey)) {
      return remoteContentCache.get(cacheKey) ?? null
    }

    try {
      const result = execSync(`curl -s "${url}"`, { encoding: 'utf8' })
      remoteContentCache.set(cacheKey, result)
      return result
    } catch (_error) {
      remoteContentCache.set(cacheKey, null)
      return null
    }
  }

  private async loadTemplate(template: string): Promise<string | null> {
    return await this.loadFromGitLab(
      'gitlab-org/gitlab',
      `lib/gitlab/ci/templates/${template}`,
      'master',
    )
  }

  protected mergeConfig(target: GitLabCI, source: GitLabCI, isRemote = false): void {
    for (const [key, value] of Object.entries(source)) {
      if (key === 'variables') {
        target.variables = {
          ...target.variables,
          ...value,
        }
      } else if (key === 'stages') {
        const existingStages = target.stages || []
        target.stages = [...new Set([...existingStages, ...value])]
      } else {
        // If this is a job (not a special config key), track if it's remote
        if (isRemote && typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Check if this looks like a job definition (has script, stage, or other job properties)
          if (this.looksLikeJob(value)) {
            this.context.remoteJobs.add(key)
          }
        }

        // Deep merge job definitions instead of replacing them entirely
        // This allows included jobs to provide a base that can be extended by later definitions
        const existingValue = target[key]
        if (
          existingValue &&
          typeof existingValue === 'object' &&
          !Array.isArray(existingValue) &&
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          this.looksLikeJob(existingValue)
        ) {
          // Merge job properties: source (included) provides base, existing (main config) values take precedence
          // This matches GitLab's behavior where main file definitions override included definitions
          target[key] = {
            ...value,
            ...existingValue,
          }
        } else {
          target[key] = value
        }
      }
    }
  }

  private looksLikeJob(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) {
      return false
    }
    // A job typically has at least one of these properties
    const jobProperties = [
      'script',
      'stage',
      'extends',
      'rules',
      'only',
      'except',
      'when',
      'needs',
      'dependencies',
    ]
    return jobProperties.some(prop => prop in value)
  }

  /**
   * Load a GitLab CI component include.
   * Components use the format: $CI_SERVER_FQDN/namespace/project/component@version
   */
  private async loadComponentInclude(
    componentPath: string,
    inputs?: Record<string, unknown>,
  ): Promise<{ content: string | null; resolvedPath?: string; alreadyProcessed?: boolean }> {
    // Parse the component path
    const parsed = this.parseComponentPath(componentPath)
    if (!parsed) {
      console.warn(`Warning: Invalid component path: ${componentPath}`)
      return { content: null }
    }

    // Resolve the version early so we can include it in cache key and error messages.
    // Honor the host embedded in the component path when it looks like an FQDN
    // (contains a dot); otherwise fall back to the configured host.
    const host = parsed.host.includes('.') ? parsed.host : this.context.gitlabHost

    let resolvedVersion = parsed.version
    if (this.isPartialSemver(parsed.version)) {
      const fullVersion = this.resolvePartialVersion(parsed.project, parsed.version, host)
      if (fullVersion) {
        resolvedVersion = fullVersion
      }
    }

    // Build cache key with resolved version and inputs
    // Include inputs in the key so the same component with different inputs
    // (e.g., ecs-deploy with job-name: deploy-prod vs deploy-qa) is not deduplicated
    const inputsSuffix = inputs ? `:${JSON.stringify(inputs, Object.keys(inputs).sort())}` : ''
    const cacheKey = `component:${parsed.host}/${parsed.project}/${parsed.component || ''}@${resolvedVersion}${inputsSuffix}`
    if (this.context.includedFiles.has(cacheKey)) {
      return { content: null, alreadyProcessed: true }
    }

    // Determine template file path. GitLab supports two component layouts
    // (see https://docs.gitlab.com/ee/ci/components/#directory-structure):
    //   1. Directory form:  templates/<component>/template.yml
    //   2. Single-file form: templates/<component>.yml
    // Try the directory form first (preferred for components that ship
    // assets alongside their template); fall back to the single-file form
    // if the first fetch returns null.
    const directoryTemplate = parsed.component
      ? `templates/${parsed.component}/template.yml`
      : 'templates/template.yml'

    let rawContent = await this.fetchComponentTemplate(parsed, directoryTemplate)
    if (!rawContent && parsed.component) {
      const singleFileTemplate = `templates/${parsed.component}.yml`
      rawContent = await this.fetchComponentTemplate(parsed, singleFileTemplate)
    }
    if (!rawContent) {
      return { content: null }
    }

    // Parse spec and extract template content
    const { spec, templateContent } = this.parseComponentSpec(rawContent)

    // Merge inputs with defaults
    const mergedInputs = this.mergeInputsWithDefaults(spec, inputs || {})

    // Interpolate $[[ inputs.name ]] syntax
    const interpolated = this.interpolateInputs(templateContent, mergedInputs)

    this.context.includedFiles.add(cacheKey)
    return { content: interpolated, resolvedPath: cacheKey }
  }

  /**
   * Parse a component path into its parts.
   * Format: host/namespace/project[/component]@version
   * Example: $CI_SERVER_FQDN/my-group/components/deploy@1.2.0
   */
  private parseComponentPath(path: string): ParsedComponentPath | null {
    // Replace $CI_SERVER_FQDN with the configured GitLab host
    const resolved = path.replace(/\$CI_SERVER_FQDN/g, this.context.gitlabHost)

    // Parse: host/path@version
    const atIndex = resolved.lastIndexOf('@')
    if (atIndex === -1) {
      return null
    }

    const version = resolved.slice(atIndex + 1)
    const pathPart = resolved.slice(0, atIndex)

    // Split path into parts
    const parts = pathPart.split('/')
    if (parts.length < 3) {
      return null
    }

    const host = parts[0]!
    // The remaining parts can be namespace/project or namespace/project/component
    // GitLab projects can have nested namespaces (e.g., org/subgroup/project)
    // Convention: components are typically at paths like namespace/project/component
    // where the last segment (if it's not part of the namespace/project pair) is the component

    // Heuristic: The project path typically follows patterns like:
    // - host/namespace/project (no component, uses templates/template.yml)
    // - host/namespace/project/component (with component)
    // - host/namespace/subgroup/project/component (nested namespace)

    // For simplicity, we'll assume the last segment after the project is the component
    // if there are 4+ parts (host + namespace + project + component)
    if (parts.length >= 4) {
      // Has component
      const component = parts[parts.length - 1]
      const project = parts.slice(1, -1).join('/')
      return { host, project, component, version }
    } else {
      // No component (just host/namespace/project)
      const project = parts.slice(1).join('/')
      return { host, project, version }
    }
  }

  /**
   * Parse component spec block and template content.
   * Components have a YAML document separator (---) between spec and template.
   */
  private parseComponentSpec(content: string): { spec: ComponentSpec; templateContent: string } {
    // Look for the document separator "---"
    const separatorPattern = /^---\s*$/m
    const match = content.match(separatorPattern)

    if (!match || match.index === undefined) {
      // No separator found - treat entire content as template with no spec
      return { spec: {}, templateContent: content }
    }

    const specPart = content.slice(0, match.index).trim()
    const templateContent = content.slice(match.index + match[0].length).trim()

    // Parse the spec block
    let spec: ComponentSpec = {}
    if (specPart) {
      // Note: spec parsing errors are non-fatal - we'll just use empty spec
      try {
        const parsed = parseWithCustomTags(specPart)
        if (parsed && typeof parsed === 'object' && 'spec' in parsed) {
          spec = (parsed as { spec: ComponentSpec }).spec || {}
        } else if (parsed && typeof parsed === 'object' && 'inputs' in parsed) {
          // Some components put inputs directly without wrapping in spec
          spec = parsed as ComponentSpec
        }
      } catch (error) {
        console.warn(`Warning: Failed to parse component spec: ${error}`)
      }
    }

    return { spec, templateContent }
  }

  /**
   * Merge provided inputs with spec defaults.
   */
  private mergeInputsWithDefaults(
    spec: ComponentSpec,
    providedInputs: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged: Record<string, unknown> = {}

    // Apply defaults from spec
    if (spec.inputs) {
      for (const [name, inputDef] of Object.entries(spec.inputs)) {
        if (inputDef.default !== undefined) {
          merged[name] = inputDef.default
        }
      }
    }

    // Override with provided inputs
    for (const [name, value] of Object.entries(providedInputs)) {
      merged[name] = value
    }

    return merged
  }

  /**
   * Interpolate `$[[ inputs.name ]]` placeholders in a component template.
   *
   * Implementation: parse the template into a YAML AST, walk every scalar
   * node, and substitute placeholders by mutating the scalar's `value`.
   * Re-serializing through `Document.toString()` lets the `yaml` library
   * pick the appropriate scalar style (plain / single-quoted / double-
   * quoted / block-literal / block-folded) based on the new value AND the
   * surrounding indentation — handling multi-line strings, leading colons,
   * special YAML characters, and node-replacement (e.g. an array input
   * substituted into a scalar slot) without us hand-rolling escape rules.
   *
   * Two substitution modes per scalar:
   *   - "whole-placeholder" (the scalar value is exactly `$[[ inputs.X ]]`):
   *     replace the scalar's value with the input value verbatim. If the
   *     input is non-string (number, boolean, array, object), the lib
   *     emits the appropriate YAML representation.
   *   - "mixed" (placeholder embedded in surrounding text, e.g.
   *     `"prefix-$[[ inputs.X ]]-suffix"`): coerce the input to string and
   *     splice it into the scalar value. The lib still picks the right
   *     quoting style on re-serialize.
   */
  private interpolateInputs(content: string, inputs: Record<string, unknown>): string {
    // `$[[ inputs.NAME ]]` or `$[[ inputs.NAME | filter1 | filter2(args) ]]`.
    // GitLab supports filters (`expand_vars`, `truncate(offset,length)`) that
    // execute at pipeline-creation time using runtime CI variables. The
    // linter doesn't have that variable context, so we consume the filter
    // chain but substitute the *unfiltered* input value — `$VAR` references
    // are left literal, which matches GitLab's behavior when those variables
    // are undefined and keeps scenario output deterministic across runs.
    const filterChain = String.raw`(?:\s*\|[^\]]*)?`
    const wholePlaceholder = new RegExp(
      String.raw`^\$\[\[\s*inputs\.([a-zA-Z0-9_-]+)${filterChain}\s*\]\]$`,
    )
    const anyPlaceholder = new RegExp(
      String.raw`\$\[\[\s*inputs\.([a-zA-Z0-9_-]+)${filterChain}\s*\]\]`,
      'g',
    )

    const doc = parseDocument(content)

    visit(doc, {
      Scalar: (_key, node: Scalar) => {
        if (typeof node.value !== 'string') return
        const original = node.value
        if (!anyPlaceholder.test(original)) return
        anyPlaceholder.lastIndex = 0

        const wholeMatch = original.match(wholePlaceholder)
        if (wholeMatch) {
          const inputName = wholeMatch[1]!
          if (!Object.hasOwn(inputs, inputName)) {
            console.warn(`Warning: Undefined input '${inputName}' in component`)
            return
          }
          const inputValue = inputs[inputName]

          // Arrays/objects can't live in a Scalar — replace the entire
          // node with a fresh YAML node tree built from the input value.
          // Returning a node from the visitor swaps it in place.
          if (typeof inputValue === 'object' && inputValue !== null) {
            return doc.createNode(inputValue)
          }

          // Primitives (string, number, boolean): mutate in place. Clearing
          // `source` forces the lib to re-derive the serialized form from
          // `value`; clearing `type` lets it pick a fresh scalar style for
          // non-string substitutions (e.g. number → plain, multi-line string
          // → block-literal) instead of inheriting the placeholder's style.
          node.value = inputValue
          node.source = undefined
          if (typeof inputValue !== 'string') {
            node.type = undefined
          }
          return
        }

        // Placeholder embedded in surrounding text — splice the string form
        // into the scalar value. The yaml lib still picks correct quoting
        // on re-serialize.
        node.value = original.replace(anyPlaceholder, (match, inputName) => {
          if (!Object.hasOwn(inputs, inputName)) {
            console.warn(`Warning: Undefined input '${inputName}' in component`)
            return match
          }
          const v = inputs[inputName]
          if (v === null || v === undefined) return ''
          if (typeof v === 'object') return JSON.stringify(v)
          // At this point v is a primitive — delegate stringification to
          // the typed helper so we don't end up with `[object Object]`.
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            return primitiveToYamlString(v)
          }
          console.warn(
            `Warning: Input '${inputName}' has unsupported type '${typeof v}', leaving placeholder unresolved`,
          )
          return match
        })
        node.source = undefined
      },
    })

    return doc.toString()
  }

  /**
   * Check if a version string is a partial semver (e.g., "1" or "1.24" instead of "1.24.1").
   */
  private isPartialSemver(version: string): boolean {
    // Full semver has 3 parts: major.minor.patch
    // Partial has 1 or 2 parts
    const parts = version.split('.')
    return parts.length < 3 && parts.every(p => /^\d+$/.test(p))
  }

  /**
   * Resolve a partial semver version to the latest matching full version.
   * For example, "1" might resolve to "1.24.1" if that's the latest 1.x.x tag.
   */
  private resolvePartialVersion(
    project: string,
    partialVersion: string,
    host: string,
  ): string | null {
    const cacheKey = `version:${host}/${project}@${partialVersion}`
    if (remoteContentCache.has(cacheKey)) {
      return remoteContentCache.get(cacheKey) ?? null
    }

    try {
      const encodedProject = encodeURIComponent(project)
      // Fetch tags from GitLab API
      const command = `glab api projects/${encodedProject}/repository/tags --paginate`
      const result = execSync(command, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getGlabEnv(host),
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large tag lists
      })

      // glab api --paginate concatenates multiple JSON arrays, e.g. [{...}][{...}]
      // Join them into a single array by replacing ][ with ,
      const normalizedJson = result.trim().replace(/\]\s*\[/g, ',')
      const tags = JSON.parse(normalizedJson) as Array<{ name: string }>
      const tagNames = tags.map(t => t.name)

      // Filter tags that match the partial version prefix
      const versionPrefix = partialVersion + '.'
      const matchingTags = tagNames.filter(
        tag => tag === partialVersion || tag.startsWith(versionPrefix),
      )

      if (matchingTags.length === 0) {
        remoteContentCache.set(cacheKey, null)
        return null
      }

      // Sort by semver (descending) to get the latest
      const sorted = matchingTags.sort((a, b) => {
        const aParts = a.split('.').map(p => parseInt(p, 10) || 0)
        const bParts = b.split('.').map(p => parseInt(p, 10) || 0)

        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aVal = aParts[i] || 0
          const bVal = bParts[i] || 0
          if (aVal !== bVal) {
            return bVal - aVal // Descending order
          }
        }
        return 0
      })

      const resolved = sorted[0] || null
      if (resolved && resolved !== partialVersion) {
        if (process.env['DEBUG_GLAB']) {
          console.warn(`[DEBUG] Resolved partial version ${partialVersion} to ${resolved}`)
        }
      }
      remoteContentCache.set(cacheKey, resolved)
      return resolved
    } catch (error) {
      if (process.env['DEBUG_GLAB']) {
        console.warn(`[DEBUG] Failed to resolve partial version ${partialVersion}: ${error}`)
      }
      remoteContentCache.set(cacheKey, null)
      return null
    }
  }

  /**
   * Fetch a component template from GitLab.
   */
  private async fetchComponentTemplate(
    parsed: ParsedComponentPath,
    templateFile: string,
  ): Promise<string | null> {
    // Honor the host embedded in the component path when it looks like an FQDN
    // (contains a dot); otherwise fall back to the configured host.
    const host = parsed.host.includes('.') ? parsed.host : this.context.gitlabHost

    // Resolve partial semver versions (e.g., "1" -> "1.24.1")
    let resolvedVersion = parsed.version
    if (this.isPartialSemver(parsed.version)) {
      const fullVersion = this.resolvePartialVersion(parsed.project, parsed.version, host)
      if (fullVersion) {
        resolvedVersion = fullVersion
      }
    }

    // Check content cache before making API calls
    const cacheKey = `component:${host}/${parsed.project}/${templateFile}@${resolvedVersion}`
    if (remoteContentCache.has(cacheKey)) {
      return remoteContentCache.get(cacheKey) ?? null
    }

    // Try to fetch using glab API
    const encodedProject = encodeURIComponent(parsed.project)
    const encodedFile = encodeURIComponent(templateFile)
    const refParam = `?ref=${encodeURIComponent(resolvedVersion)}`

    try {
      const command = `glab api projects/${encodedProject}/repository/files/${encodedFile}/raw${refParam}`
      const result = execSync(command, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getGlabEnv(host),
      })
      remoteContentCache.set(cacheKey, result)
      return result
    } catch (error) {
      if (process.env['DEBUG_GLAB']) {
        console.warn(`[DEBUG] glab api failed for component ${parsed.project}/${templateFile}:`)
        console.warn(`[DEBUG] Error: ${error}`)
      }

      // Try without version (use default branch) as fallback
      try {
        const command = `glab api projects/${encodedProject}/repository/files/${encodedFile}/raw`
        const result = execSync(command, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: getGlabEnv(host),
        })
        remoteContentCache.set(cacheKey, result)
        return result
      } catch (_fallbackError) {
        console.warn(
          `Warning: Unable to fetch component template '${templateFile}' from ${host}/${parsed.project}@${parsed.version}`,
        )
        remoteContentCache.set(cacheKey, null)
        return null
      }
    }
  }

  /**
   * Generate a human-readable description of an include for error messages.
   */
  protected describeInclude(include: GitLabInclude): string {
    if (include.local) {
      return `local:${include.local}`
    }
    if (include.project && include.file) {
      const files = Array.isArray(include.file) ? include.file.join(',') : include.file
      return `project:${include.project}/${files}${include.ref ? `@${include.ref}` : ''}`
    }
    if (include.remote) {
      return `remote:${include.remote}`
    }
    if (include.template) {
      return `template:${include.template}`
    }
    if (include.component) {
      return `component:${include.component}`
    }
    return 'unknown include'
  }

  protected warnFailedInclude(include: GitLabInclude, currentDir: string): void {
    if (include.local) {
      console.warn(
        `Warning: Failed to resolve local include '${include.local}' from directory '${currentDir}'`,
      )
    } else if (include.project && include.file) {
      const files = Array.isArray(include.file) ? include.file : [include.file]
      console.warn(
        `Warning: Failed to resolve project include '${include.project}/${files.join(',')}' (ref: ${include.ref || 'default'})`,
      )
    } else if (include.remote) {
      console.warn(`Warning: Failed to resolve remote include '${include.remote}'`)
    } else if (include.template) {
      console.warn(`Warning: Failed to resolve template include '${include.template}'`)
    } else if (include.component) {
      console.warn(`Warning: Failed to resolve component include '${include.component}'`)
    }
  }
}
