import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { execFileSync, execSync } from 'child_process'
import { glob } from 'glob'
import {
  getGlabEnv,
  IncludeResolver,
  primeGlabHostCache,
  resetGlabHostCache,
  resetRemoteContentCache,
} from './IncludeResolver'
import type { ProcessingContext } from '../ProcessedConfig'
import type { GitLabCI } from '../types'

// Mock filesystem, child_process, and glob
vi.mock('fs')
vi.mock('child_process')
vi.mock('glob')

const mockReadFileSync = vi.mocked(readFileSync)
const mockExistsSync = vi.mocked(existsSync)
const mockExecSync = vi.mocked(execSync)
const mockExecFileSync = vi.mocked(execFileSync)
const mockGlob = vi.mocked(glob)

describe('IncludeResolver', () => {
  let context: ProcessingContext
  let resolver: IncludeResolver

  beforeEach(() => {
    context = {
      filePath: '/project/.gitlab-ci.yml',
      baseDir: '/project',
      includedFiles: new Set(),
      includeStack: [],
      remoteJobs: new Set(),
      gitlabHost: 'gitlab.example.com',
    }
    resolver = new IncludeResolver(context)

    // Reset mocks, glab host cache, and remote content cache
    vi.clearAllMocks()
    resetGlabHostCache()
    resetRemoteContentCache()
    // Pre-populate cache so getGlabEnv doesn't consume mock calls for auth checks
    primeGlabHostCache('gitlab.example.com')
    primeGlabHostCache('gitlab.com')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetGlabHostCache()
  })

  describe('resolve', () => {
    it('should return config unchanged when no includes', async () => {
      const config: GitLabCI = {
        stages: ['build', 'test'],
        build: { script: ['npm run build'] },
      }

      const result = await resolver.resolve(config)

      expect(result).toEqual(config as GitLabCI)
      expect(context.includeStack).toEqual([])
    })

    it('should resolve single local include', async () => {
      const config: GitLabCI = {
        include: { local: 'common.yml' },
        build: { script: ['npm run build'] },
      }

      const includeContent = `
test:
  script: ['npm test']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(includeContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
        test: { script: ['npm test'] },
      })
      expect(result.include).toBeUndefined()
      expect(context.includedFiles.has('/project/common.yml')).toBe(true)
    })

    it('should resolve multiple local includes', async () => {
      const config: GitLabCI = {
        include: [{ local: 'common.yml' }, { local: 'jobs.yml' }],
        build: { script: ['npm run build'] },
      }

      const commonContent = `
variables:
  NODE_VERSION: "18"
`

      const jobsContent = `
test:
  script: ['npm test']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValueOnce(commonContent).mockReturnValueOnce(jobsContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        variables: { NODE_VERSION: '18' },
        build: { script: ['npm run build'] },
        test: { script: ['npm test'] },
      })
      expect(context.includedFiles.has('/project/common.yml')).toBe(true)
      expect(context.includedFiles.has('/project/jobs.yml')).toBe(true)
    })

    it('should resolve shorthand string includes as local', async () => {
      const config: GitLabCI = {
        include: 'common.yml',
        build: { script: ['npm run build'] },
      }

      const includeContent = `
test:
  script: ['npm test']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(includeContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
        test: { script: ['npm test'] },
      })
      expect(context.includedFiles.has('/project/common.yml')).toBe(true)
    })

    it('should handle nested includes recursively', async () => {
      const config: GitLabCI = {
        include: { local: 'parent.yml' },
        build: { script: ['npm run build'] },
      }

      const parentContent = `
include:
  local: child.yml
variables:
  PARENT_VAR: "parent"
`

      const childContent = `
test:
  script: ['npm test']
variables:
  CHILD_VAR: "child"
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValueOnce(parentContent).mockReturnValueOnce(childContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        variables: {
          PARENT_VAR: 'parent',
          CHILD_VAR: 'child',
        },
        build: { script: ['npm run build'] },
        test: { script: ['npm test'] },
      })
    })

    it('should detect and prevent circular includes', async () => {
      const config: GitLabCI = {
        include: { local: 'circular.yml' },
        build: { script: ['npm run build'] },
      }

      const circularContent = `
include:
  local: circular.yml
test:
  script: ['npm test']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(circularContent)

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      // The first time the file is processed, it adds the test job
      // But the circular reference prevents the second inclusion
      expect(result).toEqual({
        build: { script: ['npm run build'] },
        test: { script: ['npm test'] },
      })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Circular include detected'))

      consoleSpy.mockRestore()
    })

    it('should handle missing local files gracefully', async () => {
      const config: GitLabCI = {
        include: { local: 'missing.yml' },
        build: { script: ['npm run build'] },
      }

      mockExistsSync.mockReturnValue(false)

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
      })
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve local include'),
      )

      consoleSpy.mockRestore()
    })

    it('should skip already processed files without warning', async () => {
      const config: GitLabCI = {
        include: [
          { local: 'common.yml' },
          { local: 'common.yml' }, // Same file included twice
        ],
        build: { script: ['npm run build'] },
      }

      const includeContent = `
test:
  script: ['npm test']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(includeContent)

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
        test: { script: ['npm test'] },
      })
      // Should only be called once for the file, not twice
      expect(mockReadFileSync).toHaveBeenCalledTimes(1)
      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should resolve leading-slash local include relative to repo root, not filesystem root', async () => {
      // GitLab's `include: { local: '/path' }` is repo-root-relative; the
      // linter previously passed the leading-slash path straight to
      // node:path.resolve which discards baseDir, so includes silently failed.
      const config: GitLabCI = {
        include: { local: '/gitlab/jobs.yml' },
        build: { script: ['npm run build'] },
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue("test:\n  script: ['npm test']")

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
        test: { script: ['npm test'] },
      })
      // Resolved path should join baseDir + repo-relative path, NOT be the
      // filesystem-absolute `/gitlab/jobs.yml`.
      expect(context.includedFiles.has('/project/gitlab/jobs.yml')).toBe(true)
      expect(context.includedFiles.has('/gitlab/jobs.yml')).toBe(false)
    })

    it('should resolve leading-slash glob local include relative to repo root', async () => {
      const config: GitLabCI = {
        include: { local: '/gitlab/jobs/*.yml' },
        build: { script: ['npm run build'] },
      }

      // glob() returns absolute paths after node:path.resolve runs on them
      mockGlob.mockResolvedValue(['/project/gitlab/jobs/a.yml', '/project/gitlab/jobs/b.yml'])
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync
        .mockReturnValueOnce("a:\n  script: ['echo a']")
        .mockReturnValueOnce("b:\n  script: ['echo b']")

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
        a: { script: ['echo a'] },
        b: { script: ['echo b'] },
      })
      // Glob should have been called with the repo-rooted pattern
      expect(mockGlob).toHaveBeenCalledWith('/project/gitlab/jobs/*.yml')
    })
  })

  describe('project includes', () => {
    it('should resolve project include successfully', async () => {
      const config: GitLabCI = {
        include: {
          project: 'my-group/my-project',
          file: 'templates/common.yml',
        },
      }

      const projectContent = `
common_job:
  script: ['echo "from project"']
`

      mockExecSync.mockReturnValue(projectContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        common_job: { script: ['echo "from project"'] },
      })
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(
          'glab api projects/my-group%2Fmy-project/repository/files/templates%2Fcommon.yml/raw',
        ),
        expect.objectContaining({
          env: expect.objectContaining({ GITLAB_HOST: 'gitlab.example.com' }),
        }),
      )
      expect(context.remoteJobs.has('common_job')).toBe(true)
    })

    it('should resolve project include with ref', async () => {
      const config: GitLabCI = {
        include: {
          project: 'my-group/my-project',
          file: 'templates/common.yml',
          ref: 'develop',
        },
      }

      const projectContent = `
common_job:
  script: ['echo "from develop branch"']
`

      mockExecSync.mockReturnValue(projectContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        common_job: { script: ['echo "from develop branch"'] },
      })
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('?ref=develop'),
        expect.any(Object),
      )
    })

    it('should resolve project include with multiple files', async () => {
      const config: GitLabCI = {
        include: {
          project: 'my-group/my-project',
          file: ['templates/common.yml', 'templates/build.yml'],
        },
      }

      const commonContent = `common_job:\n  script: ['echo "common"']`
      const buildContent = `build_job:\n  script: ['echo "build"']`

      mockExecSync.mockReturnValueOnce(commonContent).mockReturnValueOnce(buildContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        common_job: { script: ['echo "common"'] },
        build_job: { script: ['echo "build"'] },
      })
      expect(mockExecSync).toHaveBeenCalledTimes(2)
    })

    it('should try multiple GitLab hosts for project includes', async () => {
      const config: GitLabCI = {
        include: {
          project: 'gitlab-org/gitlab', // Official GitLab project
          file: 'lib/gitlab/ci/templates/Security/SAST.gitlab-ci.yml',
        },
      }

      const templateContent = `
sast:
  script: ['echo "security scan"']
`

      // First call (gitlab.com) fails, second call (gitlab.example.com) succeeds
      mockExecSync
        .mockImplementationOnce(() => {
          throw new Error('404 Not Found')
        })
        .mockReturnValueOnce(templateContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        sast: { script: ['echo "security scan"'] },
      })
      expect(mockExecSync).toHaveBeenCalledTimes(2)
      // First call should be to gitlab.com (official projects try gitlab.com first)
      expect(mockExecSync).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({
          env: expect.objectContaining({ GITLAB_HOST: 'gitlab.com' }),
        }),
      )
    })

    it('should fall back to curl for gitlab.com public repos', async () => {
      const config: GitLabCI = {
        include: {
          project: 'gitlab-org/gitlab',
          file: 'lib/gitlab/ci/templates/Security/SAST.gitlab-ci.yml',
        },
      }

      const templateContent = `
sast:
  script: ['echo "security scan"']
`

      // glab command fails, curl succeeds
      mockExecSync
        .mockImplementationOnce(() => {
          throw new Error('glab auth error')
        })
        .mockReturnValueOnce(templateContent) // curl fallback

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        sast: { script: ['echo "security scan"'] },
      })
      expect(mockExecSync).toHaveBeenCalledTimes(2)
      expect(mockExecSync).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('curl -s "https://gitlab.com/api/v4/projects/'),
        expect.any(Object),
      )
    })

    it('should handle project include failures gracefully', async () => {
      const config: GitLabCI = {
        include: {
          project: 'non-existent/project',
          file: 'missing.yml',
        },
        build: { script: ['npm run build'] },
      }

      mockExecSync.mockImplementation(() => {
        throw new Error('Project not found')
      })

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
      })
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve project include'),
      )

      consoleSpy.mockRestore()
    })
  })

  describe('remote includes', () => {
    it('should resolve remote include successfully', async () => {
      const config: GitLabCI = {
        include: {
          remote: 'https://example.com/ci/common.yml',
        },
      }

      const remoteContent = `
remote_job:
  script: ['echo "from remote"']
`

      mockExecSync.mockReturnValue(remoteContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        remote_job: { script: ['echo "from remote"'] },
      })
      expect(mockExecSync).toHaveBeenCalledWith(
        'curl -s "https://example.com/ci/common.yml"',
        expect.objectContaining({ encoding: 'utf8' }),
      )
      expect(context.remoteJobs.has('remote_job')).toBe(true)
    })

    it('should handle remote include failures gracefully', async () => {
      const config: GitLabCI = {
        include: {
          remote: 'https://example.com/missing.yml',
        },
        build: { script: ['npm run build'] },
      }

      mockExecSync.mockImplementation(() => {
        throw new Error('curl failed')
      })

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
      })
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve remote include'),
      )

      consoleSpy.mockRestore()
    })
  })

  describe('template includes', () => {
    it('should resolve template include successfully', async () => {
      const config: GitLabCI = {
        include: {
          template: 'Security/SAST.gitlab-ci.yml',
        },
      }

      const templateContent = `
sast:
  stage: test
  script: ['echo "sast scan"']
`

      mockExecSync.mockReturnValue(templateContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        sast: {
          stage: 'test',
          script: ['echo "sast scan"'],
        },
      })
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(
          'gitlab-org%2Fgitlab/repository/files/lib%2Fgitlab%2Fci%2Ftemplates%2FSecurity%2FSAST.gitlab-ci.yml/raw?ref=master',
        ),
        expect.any(Object),
      )
      expect(context.remoteJobs.has('sast')).toBe(true)
    })

    it('should handle template include failures gracefully', async () => {
      const config: GitLabCI = {
        include: {
          template: 'NonExistent/Template.yml',
        },
        build: { script: ['npm run build'] },
      }

      mockExecSync.mockImplementation(() => {
        throw new Error('Template not found')
      })

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
      })
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve template include'),
      )

      consoleSpy.mockRestore()
    })
  })

  describe('config merging', () => {
    it('should merge variables correctly', async () => {
      const config: GitLabCI = {
        variables: {
          EXISTING_VAR: 'existing',
          OVERRIDE_VAR: 'original',
        },
        include: { local: 'vars.yml' },
      }

      const includeContent = `
variables:
  NEW_VAR: 'new'
  OVERRIDE_VAR: 'overridden'
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(includeContent)

      const result = await resolver.resolve(config)

      expect(result.variables).toEqual({
        EXISTING_VAR: 'existing',
        OVERRIDE_VAR: 'overridden',
        NEW_VAR: 'new',
      })
    })

    it('should merge stages correctly', async () => {
      const config: GitLabCI = {
        stages: ['build', 'test'],
        include: { local: 'stages.yml' },
      }

      const includeContent = `
stages: ['test', 'deploy', 'notify']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(includeContent)

      const result = await resolver.resolve(config)

      expect(result.stages).toEqual(['build', 'test', 'deploy', 'notify'])
    })

    it('should merge job definitions with main config taking precedence', async () => {
      const config: GitLabCI = {
        build: {
          script: ['npm run build'],
          stage: 'build',
        },
        include: { local: 'jobs.yml' },
      }

      const includeContent = `
build:
  script: ['yarn build']
  artifacts:
    paths: ['dist/']
test:
  script: ['npm test']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(includeContent)

      const result = await resolver.resolve(config)

      // Main config's values take precedence over included values
      // but included values fill in missing properties
      expect(result['build']).toEqual({
        script: ['npm run build'], // main config wins
        stage: 'build', // from main config
        artifacts: {
          // from include (not in main config)
          paths: ['dist/'],
        },
      })
      expect(result['test']).toEqual({
        script: ['npm test'],
      })
    })

    it('should track remote jobs correctly', async () => {
      const config: GitLabCI = {
        include: [{ local: 'local.yml' }, { remote: 'https://example.com/remote.yml' }],
      }

      const localContent = `
local_job:
  script: ['echo "local"']
`

      const remoteContent = `
remote_job:
  script: ['echo "remote"']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(localContent)
      mockExecSync.mockReturnValue(remoteContent)

      await resolver.resolve(config)

      expect(context.remoteJobs.has('local_job')).toBe(false)
      expect(context.remoteJobs.has('remote_job')).toBe(true)
    })
  })

  describe('!reference tag handling', () => {
    it('should parse !reference tags correctly', async () => {
      const config: GitLabCI = {
        include: { local: 'references.yml' },
      }

      const includeContent = `
.shared_script:
  script:
    - echo "shared command"
    - npm install

build:
  script:
    - !reference [.shared_script, script]
    - npm run build
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(includeContent)

      const result = await resolver.resolve(config)

      // Check that the build job has the expected reference structure
      expect(result['build']?.script).toEqual([
        expect.objectContaining({
          __gitlab_reference: true,
          job: '.shared_script',
          section: 'script',
        }),
        'npm run build',
      ])
    })

    it('should handle complex !reference tags', async () => {
      const config: GitLabCI = {
        include: { local: 'complex-ref.yml' },
      }

      const includeContent = `
.template:
  before_script:
    - echo "setup"
  script:
    - echo "main script"

build:
  before_script: !reference [.template, before_script]
  script:
    - !reference [.template, script, 0]
    - echo "additional command"
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(includeContent)

      const result = await resolver.resolve(config)

      expect(result['build']?.before_script).toEqual(
        expect.objectContaining({
          __gitlab_reference: true,
          job: '.template',
          section: 'before_script',
        }),
      )
    })
  })

  describe('error handling and edge cases', () => {
    it('should handle empty include content', async () => {
      const config: GitLabCI = {
        include: { local: 'empty.yml' },
        build: { script: ['npm run build'] },
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('')

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
      })
    })

    it('should handle invalid YAML in includes', async () => {
      const config: GitLabCI = {
        include: { local: 'invalid.yml' },
        build: { script: ['npm run build'] },
      }

      const invalidYaml = `
jobs:
  - invalid yaml structure
    missing colon
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(invalidYaml)

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      // The YAML parser is more forgiving than expected, it parses this as valid YAML
      // So we'll get the parsed content
      expect(result).toEqual({
        build: { script: ['npm run build'] },
        jobs: ['invalid yaml structure missing colon'],
      })

      consoleSpy.mockRestore()
    })

    it('should handle malformed include objects', async () => {
      const config: GitLabCI = {
        include: {
          // Missing required properties
          project: 'test/project',
          // Missing 'file' property
        } as any,
        build: { script: ['npm run build'] },
      }

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
      })
      // The actual warning comes from the loadInclude method returning null
      // without throwing an error, so no warning is logged at this level

      consoleSpy.mockRestore()
    })

    it('should handle deep include nesting', async () => {
      const config: GitLabCI = {
        include: { local: 'level1.yml' },
      }

      const level1Content = `
include: { local: 'level2.yml' }
level1_job: { script: ['echo level1'] }
`

      const level2Content = `
include: { local: 'level3.yml' }
level2_job: { script: ['echo level2'] }
`

      const level3Content = `
level3_job: { script: ['echo level3'] }
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync
        .mockReturnValueOnce(level1Content)
        .mockReturnValueOnce(level2Content)
        .mockReturnValueOnce(level3Content)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        level1_job: { script: ['echo level1'] },
        level2_job: { script: ['echo level2'] },
        level3_job: { script: ['echo level3'] },
      })
    })
  })

  describe('glob expansion', () => {
    it('should expand glob patterns and merge YAML keys correctly', async () => {
      const config: GitLabCI = {
        variables: {
          MAIN_VAR: 'main',
        },
        include: '.gitlab-ci/*.yml',
        build: { script: ['npm run build'] },
      }

      const file1Content = `
variables:
  FILE1_VAR: 'from-file1'
  SHARED_VAR: 'file1-value'

stages:
  - prepare
  - build

file1_job:
  script: ['echo "from file1"']
`

      const file2Content = `
variables:
  FILE2_VAR: 'from-file2'
  SHARED_VAR: 'file2-value'

stages:
  - build
  - deploy

defaults:
  image: node:18

file2_job:
  script: ['echo "from file2"']
`

      // Mock glob to return two matching files
      mockGlob.mockResolvedValue(['/project/.gitlab-ci/file1.yml', '/project/.gitlab-ci/file2.yml'])

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValueOnce(file1Content).mockReturnValueOnce(file2Content)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        variables: {
          MAIN_VAR: 'main',
          FILE1_VAR: 'from-file1',
          FILE2_VAR: 'from-file2',
          SHARED_VAR: 'file2-value', // Last file wins
        },
        stages: ['prepare', 'build', 'deploy'], // Unique stages merged
        defaults: {
          image: 'node:18', // From file2
        },
        build: { script: ['npm run build'] },
        file1_job: { script: ['echo "from file1"'] },
        file2_job: { script: ['echo "from file2"'] },
      })

      expect(mockGlob).toHaveBeenCalledWith('/project/.gitlab-ci/*.yml')
      expect(mockReadFileSync).toHaveBeenCalledTimes(2)
    })

    it('should resolve nested includes within glob-matched files', async () => {
      const config: GitLabCI = {
        include: '.gitlab-ci/*.yml',
        build: { script: ['npm run build'] },
      }

      // File matched by glob that itself has an include (e.g., a component include)
      const deployFileContent = `
include:
  - component: gitlab.example.com/acme/ci-components/ecs-deploy@1.0.0
    inputs:
      job-name: deploy-prod
`

      const testFileContent = `
test_job:
  script: ['npm test']
`

      // The component template that should be fetched and resolved
      const componentTemplate = `
spec:
  inputs:
    job-name:
      default: deploy
---
$[[ inputs.job-name ]]:
  stage: deploy
  script: ['echo deploying']
`

      mockGlob.mockResolvedValue(['/project/.gitlab-ci/deploy.yml', '/project/.gitlab-ci/test.yml'])

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValueOnce(deployFileContent).mockReturnValueOnce(testFileContent)

      // Mock the glab API call for the component template
      mockExecSync.mockReturnValueOnce(componentTemplate)

      const result = await resolver.resolve(config)

      // The deploy job from the component should be present
      expect(result['deploy-prod']).toEqual({
        stage: 'deploy',
        script: ['echo deploying'],
      })
      // The test job from the non-include file should also be present
      expect(result['test_job']).toEqual({
        script: ['npm test'],
      })
      expect(result['build']).toEqual({
        script: ['npm run build'],
      })
    })

    it('should resolve multiple component includes with different inputs from the same glob-matched file', async () => {
      const config: GitLabCI = {
        include: '.gitlab-ci/*.yml',
        build: { script: ['npm run build'] },
      }

      // File matched by glob that has TWO component includes with different inputs
      const deployFileContent = `
include:
  - component: gitlab.example.com/acme/ci-components/ecs-deploy@1.0.0
    inputs:
      job-name: deploy-prod-main
  - component: gitlab.example.com/acme/ci-components/ecs-deploy@1.0.0
    inputs:
      job-name: deploy-prod-branches
`

      const componentTemplate = `
spec:
  inputs:
    job-name:
      default: deploy
---
$[[ inputs.job-name ]]:
  stage: deploy
  script: ['echo deploying']
`

      mockGlob.mockResolvedValue(['/project/.gitlab-ci/deploy.yml'])
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValueOnce(deployFileContent)

      // Mock TWO glab API calls — one per component include
      mockExecSync.mockReturnValueOnce(componentTemplate).mockReturnValueOnce(componentTemplate)

      const result = await resolver.resolve(config)

      // Both deploy jobs should be present (not deduplicated)
      expect(result['deploy-prod-main']).toEqual({
        stage: 'deploy',
        script: ['echo deploying'],
      })
      expect(result['deploy-prod-branches']).toEqual({
        stage: 'deploy',
        script: ['echo deploying'],
      })
    })

    it('should handle empty glob matches', async () => {
      const config: GitLabCI = {
        include: '.gitlab-ci/*.yml',
        build: { script: ['npm run build'] },
      }

      mockGlob.mockResolvedValue([]) // No matching files

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
      })

      // Should warn about failed include resolution
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve local include'),
      )

      consoleSpy.mockRestore()
    })

    it('should handle single file without glob characters as before', async () => {
      const config: GitLabCI = {
        include: 'single-file.yml',
        build: { script: ['npm run build'] },
      }

      const singleFileContent = `
test_job:
  script: ['npm test']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(singleFileContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
        test_job: { script: ['npm test'] },
      })

      // Should not call glob for non-glob patterns
      expect(mockGlob).not.toHaveBeenCalled()
      expect(mockReadFileSync).toHaveBeenCalledTimes(1)
    })

    it('should handle circular includes in glob expansion', async () => {
      const config: GitLabCI = {
        include: 'ci/*.yml',
      }

      mockGlob.mockResolvedValue([
        '/project/.gitlab-ci.yml', // This would be the current file
        '/project/ci/other.yml',
      ])

      context.includeStack = ['/project/.gitlab-ci.yml'] // Simulate current file in stack

      const otherContent = `
other_job:
  script: ['echo "other"']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(otherContent)

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        other_job: { script: ['echo "other"'] },
      })

      // Should warn about circular include for the main file
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Circular include detected'))

      consoleSpy.mockRestore()
    })

    it('should handle glob expansion errors gracefully', async () => {
      const config: GitLabCI = {
        include: '.gitlab-ci/*.yml',
        build: { script: ['npm run build'] },
      }

      mockGlob.mockRejectedValue(new Error('Permission denied'))

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to expand glob pattern'),
      )

      consoleSpy.mockRestore()
    })

    it('should skip already processed files in glob expansion', async () => {
      const config: GitLabCI = {
        include: 'ci/*.yml',
      }

      mockGlob.mockResolvedValue(['/project/ci/file1.yml', '/project/ci/file2.yml'])

      // Simulate file1 already being processed
      context.includedFiles.add('/project/ci/file1.yml')

      const file2Content = `
file2_job:
  script: ['echo "file2"']
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(file2Content)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        file2_job: { script: ['echo "file2"'] },
      })

      // Should only read the non-processed file
      expect(mockReadFileSync).toHaveBeenCalledTimes(1)
      expect(mockReadFileSync).toHaveBeenCalledWith('/project/ci/file2.yml', 'utf8')
    })
  })

  describe('component includes', () => {
    it('should fall back to single-file template form (templates/<c>.yml) when directory form 404s', async () => {
      // Per https://docs.gitlab.com/ee/ci/components/#directory-structure
      // GitLab supports two layouts:
      //   directory: templates/<component>/template.yml
      //   single-file: templates/<component>.yml
      // The linter must try the directory form first, then fall back.
      const config: GitLabCI = {
        include: {
          component: 'gitlab.example.com/acme/ci-components/eks@3.8.4',
          inputs: { 'job-name': 'deploy', 'service-name': 'common-api' },
        },
      }

      const singleFileTemplate = `
spec:
  inputs:
    job-name:
      type: string
      default: 'deploy'
    service-name:
      type: string
---
$[[ inputs.job-name ]]:
  script:
    - echo "Deploying $[[ inputs.service-name ]]"
`

      // fetchComponentTemplate retries each templateFile path: first with
      // ?ref=<version>, then without ref as fallback. The linter calls
      // fetchComponentTemplate twice (directory form, then single-file form),
      // so we have up to 4 execSync invocations to mock.
      //   1) templates/eks/template.yml?ref=3.8.4   → throw (404 directory)
      //   2) templates/eks/template.yml             → throw (still 404)
      //   3) templates/eks.yml?ref=3.8.4            → return content
      const throw404 = () => {
        throw Object.assign(new Error('404'), { status: 1 })
      }
      mockExecSync.mockImplementationOnce(throw404)
      mockExecSync.mockImplementationOnce(throw404)
      mockExecSync.mockReturnValueOnce(singleFileTemplate)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        deploy: {
          script: ['echo "Deploying common-api"'],
        },
      })
      // Directory form is tried first.
      expect(mockExecSync).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('templates%2Feks%2Ftemplate.yml'),
        expect.anything(),
      )
      // Single-file form is the eventual hit (3rd call after the two
      // directory-form attempts both fail).
      expect(mockExecSync).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('templates%2Feks.yml'),
        expect.anything(),
      )
    })

    it('should resolve component include with default inputs', async () => {
      const config: GitLabCI = {
        include: {
          component: '$CI_SERVER_FQDN/acme/ci-components/code-review@1.0.0',
        },
      }

      const componentContent = `
spec:
  inputs:
    job-name:
      type: string
      default: 'code-review'
    stage:
      type: string
      default: 'review'
---
$[[ inputs.job-name ]]:
  stage: $[[ inputs.stage ]]
  script:
    - echo "Running AI code review"
`

      mockExecSync.mockReturnValue(componentContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        'code-review': {
          stage: 'review',
          script: ['echo "Running AI code review"'],
        },
      })
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(
          'glab api projects/acme%2Fci-components/repository/files/templates%2Fcode-review%2Ftemplate.yml/raw?ref=1.0.0',
        ),
        expect.objectContaining({
          env: expect.objectContaining({ GITLAB_HOST: 'gitlab.example.com' }),
        }),
      )
      expect(context.remoteJobs.has('code-review')).toBe(true)
    })

    it('should resolve component include with custom inputs', async () => {
      const config: GitLabCI = {
        include: {
          component: 'gitlab.example.com/acme/ci-components/code-review@1.0.0',
          inputs: {
            'job-name': 'my-review-job',
            stage: 'test',
          },
        },
      }

      const componentContent = `
spec:
  inputs:
    job-name:
      type: string
      default: 'code-review'
    stage:
      type: string
      default: 'review'
---
$[[ inputs.job-name ]]:
  stage: $[[ inputs.stage ]]
  script:
    - echo "Running AI code review"
`

      mockExecSync.mockReturnValue(componentContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        'my-review-job': {
          stage: 'test',
          script: ['echo "Running AI code review"'],
        },
      })
    })

    it('should not double-quote input values when placeholder is already inside double quotes', async () => {
      // Regression: input values starting with { (e.g. "{yy}.{M}.{patch}") were wrapped in
      // extra quotes by quoteForYaml, producing `""{yy}.{M}.{patch}""` when the template
      // already had `"$[[ inputs.x ]]"`, causing a YAML parse error.
      const config: GitLabCI = {
        include: {
          component: 'gitlab.example.com/acme/ci-components/ecs-deploy@1.0.0',
          inputs: {
            'job-name': 'deploy-prod',
            'version-template': '{yy}.{M}.{patch}',
          },
        },
      }

      const componentContent = `
spec:
  inputs:
    job-name:
      default: deploy
    version-template:
      default: '{yy}.{patch}'
---
$[[ inputs.job-name ]]:
  stage: deploy
  variables:
    VERSION_TEMPLATE: "$[[ inputs.version-template ]]"
  script: ['echo deploying']
`

      mockExecSync.mockReturnValue(componentContent)

      const result = await resolver.resolve(config)

      expect(result['deploy-prod']).toEqual({
        stage: 'deploy',
        variables: { VERSION_TEMPLATE: '{yy}.{M}.{patch}' },
        script: ['echo deploying'],
      })
    })

    it('should replace $CI_SERVER_FQDN with gitlabHost', async () => {
      context.gitlabHost = 'custom.gitlab.com'
      resolver = new IncludeResolver(context)

      const config: GitLabCI = {
        include: {
          component: '$CI_SERVER_FQDN/org/project/component@v1',
        },
      }

      const componentContent = `
spec:
  inputs:
    name:
      default: 'test'
---
$[[ inputs.name ]]:
  script: ['echo hello']
`

      mockExecSync.mockReturnValue(componentContent)

      await resolver.resolve(config)

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          env: expect.objectContaining({ GITLAB_HOST: 'custom.gitlab.com' }),
        }),
      )
    })

    it('should handle component without spec block', async () => {
      const config: GitLabCI = {
        include: {
          component: 'gitlab.example.com/org/project/simple@v1',
          inputs: {
            name: 'my-job',
          },
        },
      }

      // No spec block, no --- separator
      const componentContent = `
$[[ inputs.name ]]:
  script:
    - echo "simple job"
`

      mockExecSync.mockReturnValue(componentContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        'my-job': {
          script: ['echo "simple job"'],
        },
      })
    })

    it('should handle array inputs correctly', async () => {
      const config: GitLabCI = {
        include: {
          component: 'gitlab.example.com/org/project/with-arrays@v1',
          inputs: {
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }, { if: '$CI_MERGE_REQUEST_ID' }],
          },
        },
      }

      const componentContent = `
spec:
  inputs:
    rules:
      type: array
---
test-job:
  rules: $[[ inputs.rules ]]
  script:
    - echo "test"
`

      mockExecSync.mockReturnValue(componentContent)

      const result = await resolver.resolve(config)

      expect(result['test-job']?.rules).toEqual([
        { if: '$CI_COMMIT_BRANCH == "main"' },
        { if: '$CI_MERGE_REQUEST_ID' },
      ])
    })

    it('should warn on undefined inputs', async () => {
      const config: GitLabCI = {
        include: {
          component: 'gitlab.example.com/org/project/component@v1',
        },
      }

      const componentContent = `
spec:
  inputs:
    required-input:
      type: string
---
$[[ inputs.required-input ]]:
  script: ['echo $[[ inputs.missing-input ]]']
`

      mockExecSync.mockReturnValue(componentContent)

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      await resolver.resolve(config)

      // Undefined inputs are left unresolved
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Undefined input 'required-input'"),
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Undefined input 'missing-input'"),
      )

      consoleSpy.mockRestore()
    })

    it('should handle component without subpath (templates/template.yml)', async () => {
      const config: GitLabCI = {
        include: {
          component: 'gitlab.example.com/org/project@v1',
        },
      }

      const componentContent = `
spec:
  inputs:
    job-name:
      default: 'default-job'
---
$[[ inputs.job-name ]]:
  script: ['echo "root template"']
`

      mockExecSync.mockReturnValue(componentContent)

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        'default-job': {
          script: ['echo "root template"'],
        },
      })

      // Should request templates/template.yml, not templates/<component>/template.yml
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('templates%2Ftemplate.yml'),
        expect.any(Object),
      )
    })

    it('should skip already processed component includes', async () => {
      const config: GitLabCI = {
        include: [
          { component: 'gitlab.example.com/org/project/comp@v1' },
          { component: 'gitlab.example.com/org/project/comp@v1' }, // Same component
        ],
      }

      const componentContent = `
spec:
  inputs:
    name:
      default: 'job'
---
$[[ inputs.name ]]:
  script: ['echo test']
`

      mockExecSync.mockReturnValue(componentContent)

      await resolver.resolve(config)

      // Should only be called once
      expect(mockExecSync).toHaveBeenCalledTimes(1)
    })

    it('should handle component fetch failures gracefully', async () => {
      const config: GitLabCI = {
        include: {
          component: 'gitlab.example.com/org/missing/component@v1',
        },
        build: { script: ['npm run build'] },
      }

      mockExecSync.mockImplementation(() => {
        throw new Error('404 Not Found')
      })

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
      })
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unable to fetch component template'),
      )

      consoleSpy.mockRestore()
    })

    it('should handle invalid component path gracefully', async () => {
      const config: GitLabCI = {
        include: {
          component: 'invalid-path-no-at-sign',
        },
        build: { script: ['npm run build'] },
      }

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      const result = await resolver.resolve(config)

      expect(result).toEqual({
        build: { script: ['npm run build'] },
      })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid component path'))

      consoleSpy.mockRestore()
    })

    it('should handle gitlab.com host for public components', async () => {
      const config: GitLabCI = {
        include: {
          component: 'gitlab.com/components/sast/sast@v1',
        },
      }

      const componentContent = `
spec:
  inputs:
    stage:
      default: 'test'
---
sast:
  stage: $[[ inputs.stage ]]
  script: ['echo "sast scan"']
`

      mockExecSync.mockReturnValue(componentContent)

      await resolver.resolve(config)

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          env: expect.objectContaining({ GITLAB_HOST: 'gitlab.com' }),
        }),
      )
    })

    it('should escape newlines and tabs in multi-line input values', async () => {
      // Regression: components like terraform@main carry HCL fragments
      // (containing literal newlines) as input values. Without escaping the
      // newlines on interpolation, the synthesized template contained raw
      // newlines inside an unquoted YAML scalar, breaking YAML parsing
      // ("Implicit keys need to be on a single line").
      const multiLineHcl = 'terraform {\n  backend "s3" {\n    bucket = "x"\n  }\n}'
      const config: GitLabCI = {
        include: {
          component: 'gitlab.example.com/acme/ci-components/terraform@1',
          inputs: {
            'terraform-overrides': multiLineHcl,
          },
        },
      }

      const componentContent = `
spec:
  inputs:
    terraform-overrides:
      type: string
      default: ''
---
plan:
  variables:
    TF_OVERRIDES: $[[ inputs.terraform-overrides ]]
  script: ['terraform plan']
`

      mockExecSync.mockReturnValue(componentContent)

      // Should not throw during YAML parse — the newlines must be escaped.
      const result = await resolver.resolve(config)

      // Job is present and the variable round-trips back to the original
      // multi-line string after YAML decode.
      expect((result as Record<string, any>).plan).toBeDefined()
      expect((result as Record<string, any>).plan.variables.TF_OVERRIDES).toBe(multiLineHcl)
    })

    it('should consume `| filter` syntax in placeholders and substitute the unfiltered input', async () => {
      // Regression: GitLab supports `$[[ inputs.X | expand_vars ]]` and
      // `$[[ inputs.X | truncate(0, 5) ]]`. The linter previously didn't
      // match these (regex stopped at the input name) so the entire
      // placeholder was left literal — visible in scenarios as e.g.
      // `terraform:alert:qa$[[inputs.terraform-job-suffix | expand_vars]]`.
      // Now: regex consumes the filter chain, scenarios show the
      // unfiltered value (e.g. `terraform:alert:qa-$EPH_ENV_ID`).
      const config: GitLabCI = {
        include: {
          component: 'gitlab.example.com/acme/ci-components/terraform@1',
          inputs: {
            'job-suffix': '-$EPH_ENV_ID',
            'long-name': 'abcdefghij',
          },
        },
      }

      const componentContent = `
spec:
  inputs:
    job-suffix:
      type: string
      default: ''
    long-name:
      type: string
      default: ''
---
terraform:alert:qa$[[ inputs.job-suffix | expand_vars ]]:
  script: ['echo alert']
terraform:tag$[[ inputs.long-name | truncate(0, 5) ]]:
  script: ['echo tag']
`

      mockExecSync.mockReturnValue(componentContent)

      const result = (await resolver.resolve(config)) as Record<string, unknown>

      // Filter is consumed; unfiltered input value is substituted as a
      // plain string (no expand_vars, no truncate executed here).
      expect(result['terraform:alert:qa-$EPH_ENV_ID']).toBeDefined()
      expect(result['terraform:tagabcdefghij']).toBeDefined()
      // And the original literal placeholders are gone.
      expect(result['terraform:alert:qa$[[ inputs.job-suffix | expand_vars ]]']).toBeUndefined()
      expect(result['terraform:tag$[[ inputs.long-name | truncate(0, 5) ]]']).toBeUndefined()
    })
  })

  describe('getGlabEnv auth health check', () => {
    it('should cache result per host', async () => {
      resetGlabHostCache()
      // Auth check succeeds for all hosts (getGlabEnv uses execFileSync)
      mockExecFileSync.mockReturnValue('' as any)
      // glab api calls use execSync
      mockExecSync.mockReturnValue('' as any)

      const config: GitLabCI = {
        include: [
          { project: 'group/project-a', file: 'ci/a.yml' },
          { project: 'group/project-b', file: 'ci/b.yml' },
        ],
      }

      await resolver.resolve(config)

      // Auth status calls should be cached per unique host — not called once per include.
      const authCalls = mockExecFileSync.mock.calls.filter(
        ([cmd, args]) => cmd === 'glab' && Array.isArray(args) && args[0] === 'auth',
      )
      // Each unique host should be checked at most once (cached after first success)
      const hostsChecked = authCalls.map(([, args]) => {
        const a = args as string[]
        const idx = a.indexOf('--hostname')
        return idx >= 0 ? a[idx + 1] : 'default'
      })
      const uniqueHosts = new Set(hostsChecked)
      expect(authCalls.length).toBe(uniqueHosts.size)
    })

    it('should fall back to default auth when GITLAB_HOST auth fails', async () => {
      resetGlabHostCache()
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const remoteContent = `remote_job:\n  script: ['echo "remote"']`

      // execFileSync is used for auth checks
      mockExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'glab' && args?.[0] === 'auth') {
          // Auth with explicit host fails
          if (args?.includes('--hostname')) {
            throw new Error('not authenticated')
          }
          // Default auth succeeds
          return '' as any
        }
        return '' as any
      })

      // execSync is still used for glab api calls
      mockExecSync.mockImplementation((command: string) => {
        if (typeof command === 'string' && command.includes('glab api')) {
          return remoteContent as any
        }
        return '' as any
      })

      const config: GitLabCI = {
        include: { project: 'group/project', file: 'ci/config.yml' },
      }

      await resolver.resolve(config)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('using default glab auth'),
      )

      // The glab api call should NOT have GITLAB_HOST set
      const apiCalls = mockExecSync.mock.calls.filter(
        ([cmd]) => typeof cmd === 'string' && cmd.includes('glab api'),
      )
      expect(apiCalls.length).toBeGreaterThan(0)

      // Verify GITLAB_HOST is absent from the env of the API call
      const apiCallEnv = (apiCalls[0]![1] as { env?: Record<string, string> })?.env
      expect(apiCallEnv).toBeDefined()
      expect(apiCallEnv).not.toMatchObject({ GITLAB_HOST: expect.anything() })

      consoleWarnSpy.mockRestore()
    })

    it('should warn when both auth methods fail', async () => {
      resetGlabHostCache()
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // execFileSync is used for auth checks — both fail
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not authenticated')
      })

      // execSync for glab api will still be attempted
      mockExecSync.mockReturnValue('' as any)

      const config: GitLabCI = {
        include: { project: 'group/project', file: 'ci/config.yml' },
      }

      await resolver.resolve(config)

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('will not be resolved'))
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('glab auth login'))

      consoleWarnSpy.mockRestore()
    })

    it('should not cache auth failures so retries work after user fixes auth', async () => {
      resetGlabHostCache()
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      let callCount = 0
      mockExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'glab' && args?.[0] === 'auth') {
          callCount++
          if (callCount <= 2) {
            // First attempt: both auth methods fail
            throw new Error('not authenticated')
          }
          // Second attempt: auth succeeds (user fixed it)
          return '' as any
        }
        return '' as any
      })
      mockExecSync.mockReturnValue('' as any)

      const config: GitLabCI = {
        include: { project: 'group/project', file: 'ci/config.yml' },
      }

      await resolver.resolve(config)

      // Auth failure was not cached, so second resolve triggers another auth check
      const resolver2 = new IncludeResolver(context)
      await resolver2.resolve(config)

      // Auth should have been attempted more than once (not cached from failure)
      expect(callCount).toBeGreaterThan(2)

      consoleWarnSpy.mockRestore()
    })

    it('should set GITLAB_HOST in env when auth succeeds for explicit host', () => {
      resetGlabHostCache()
      mockExecFileSync.mockReturnValue('' as any)

      const env = getGlabEnv('gitlab.example.com')

      expect(env['GITLAB_HOST']).toBe('gitlab.example.com')
      // Verify execFileSync was called with the right args
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'glab',
        ['auth', 'status', '--hostname', 'gitlab.example.com'],
        { stdio: 'pipe' },
      )
    })
  })

  describe('include rules (per-scenario evaluation)', () => {
    it('should include all entries when no evaluation context is set, even if include.rules exist', async () => {
      const config: GitLabCI = {
        include: {
          local: 'qa.yml',
          rules: [{ if: '$EPH_ENV_ID != null' }],
        },
        build: { script: ['npm run build'] },
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`qa-job:\n  script: ['echo qa']\n`)

      const result = await resolver.resolve(config)

      expect(result['qa-job']).toBeDefined()
      expect(context.includedFiles.has('/project/qa.yml')).toBe(true)
    })

    it('should include when an include rule matches the evaluation context', async () => {
      context.evaluationContext = { variables: { EPH_ENV_ID: 'eph-123' } }
      const config: GitLabCI = {
        include: {
          local: 'qa.yml',
          rules: [{ if: '$EPH_ENV_ID != null' }],
        },
        build: { script: ['npm run build'] },
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`qa-job:\n  script: ['echo qa']\n`)

      const result = await resolver.resolve(config)

      expect(result['qa-job']).toBeDefined()
      expect(context.includedFiles.has('/project/qa.yml')).toBe(true)
    })

    it('should skip the include when no rule matches the evaluation context', async () => {
      context.evaluationContext = { variables: { EPH_ENV_ID: null } }
      const config: GitLabCI = {
        include: {
          local: 'qa.yml',
          rules: [{ if: '$EPH_ENV_ID != null' }],
        },
        build: { script: ['npm run build'] },
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`qa-job:\n  script: ['echo qa']\n`)

      const result = await resolver.resolve(config)

      expect(result['qa-job']).toBeUndefined()
      expect(result.build).toBeDefined()
      // The file must not have been processed
      expect(context.includedFiles.has('/project/qa.yml')).toBe(false)
      expect(mockReadFileSync).not.toHaveBeenCalled()
    })

    it('should skip when the matching rule has when: never', async () => {
      context.evaluationContext = { variables: { CI_COMMIT_BRANCH: 'main' } }
      const config: GitLabCI = {
        include: {
          local: 'qa.yml',
          rules: [
            { if: '$CI_COMMIT_BRANCH == "main"', when: 'never' },
            { if: '$CI_COMMIT_BRANCH != null' },
          ],
        },
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`qa-job:\n  script: ['echo qa']\n`)

      const result = await resolver.resolve(config)

      expect(result['qa-job']).toBeUndefined()
      expect(context.includedFiles.has('/project/qa.yml')).toBe(false)
    })

    it('should honor first-match semantics across multiple rules', async () => {
      context.evaluationContext = { variables: { CI_PIPELINE_SOURCE: 'merge_request_event' } }
      const config: GitLabCI = {
        include: {
          local: 'mr.yml',
          rules: [
            { if: '$CI_PIPELINE_SOURCE == "schedule"', when: 'never' },
            { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
            { if: '$CI_PIPELINE_SOURCE == "push"' },
          ],
        },
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`mr-job:\n  script: ['echo mr']\n`)

      const result = await resolver.resolve(config)

      expect(result['mr-job']).toBeDefined()
    })

    it('should evaluate rules independently per include in a mixed array', async () => {
      context.evaluationContext = { variables: { EPH_ENV_ID: null } }
      const config: GitLabCI = {
        include: [
          {
            local: 'always.yml',
          },
          {
            local: 'qa.yml',
            rules: [{ if: '$EPH_ENV_ID != null' }],
          },
        ],
      }

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValueOnce(`always-job:\n  script: ['echo always']\n`)

      const result = await resolver.resolve(config)

      expect(result['always-job']).toBeDefined()
      expect(result['qa-job']).toBeUndefined()
      expect(mockReadFileSync).toHaveBeenCalledTimes(1)
    })
  })
})
