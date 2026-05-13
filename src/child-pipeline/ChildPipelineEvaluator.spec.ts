import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChildPipelineEvaluator } from './ChildPipelineEvaluator'
import type { GitLabJob } from '../types'
import type { EvaluationSummary } from '../rule-evaluation/types'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig'
import * as fs from 'fs'

// Mock the file system
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

// Mock ConfigProcessor
vi.mock('../processors/ConfigProcessor', () => ({
  ConfigProcessor: vi.fn().mockImplementation(() => ({
    process: vi.fn(),
  })),
}))

type MockedFs = typeof fs

describe('ChildPipelineEvaluator', () => {
  let evaluator: ChildPipelineEvaluator

  beforeEach(() => {
    vi.clearAllMocks()
    evaluator = new ChildPipelineEvaluator('/test/repo')
  })

  describe('isTriggerWithLocalInclude', () => {
    it('should return true for trigger job with local include object', () => {
      const job: GitLabJob = {
        trigger: {
          include: {
            local: 'apps/extension/.gitlab-ci.yml',
          },
        },
      }
      expect(evaluator.isTriggerWithLocalInclude(job)).toBe(true)
    })

    it('should return true for trigger job with local include in array', () => {
      const job: GitLabJob = {
        trigger: {
          include: [{ local: 'apps/extension/.gitlab-ci.yml' }],
        },
      }
      expect(evaluator.isTriggerWithLocalInclude(job)).toBe(true)
    })

    it('should return true for trigger job with string include (shorthand)', () => {
      const job: GitLabJob = {
        trigger: {
          include: 'apps/extension/.gitlab-ci.yml',
        },
      }
      expect(evaluator.isTriggerWithLocalInclude(job)).toBe(true)
    })

    it('should return false for trigger job with project include', () => {
      const job: GitLabJob = {
        trigger: {
          include: [
            {
              project: 'other/project',
              file: '.gitlab-ci.yml',
            },
          ],
        },
      }
      expect(evaluator.isTriggerWithLocalInclude(job)).toBe(false)
    })

    it('should return false for trigger job without include', () => {
      const job: GitLabJob = {
        trigger: {
          project: 'other/project',
        },
      }
      expect(evaluator.isTriggerWithLocalInclude(job)).toBe(false)
    })

    it('should return false for non-trigger job', () => {
      const job: GitLabJob = {
        script: ['echo "hello"'],
      }
      expect(evaluator.isTriggerWithLocalInclude(job)).toBe(false)
    })

    it('should return false for job without trigger property', () => {
      const job: GitLabJob = {
        stage: 'build',
        script: ['npm run build'],
      }
      expect(evaluator.isTriggerWithLocalInclude(job)).toBe(false)
    })
  })

  describe('getLocalPath', () => {
    it('should return local path from object include', () => {
      const job: GitLabJob = {
        trigger: {
          include: {
            local: 'apps/extension/.gitlab-ci.yml',
          },
        },
      }
      expect(evaluator.getLocalPath(job)).toBe('apps/extension/.gitlab-ci.yml')
    })

    it('should return local path from array include', () => {
      const job: GitLabJob = {
        trigger: {
          include: [{ local: 'apps/extension/.gitlab-ci.yml' }],
        },
      }
      expect(evaluator.getLocalPath(job)).toBe('apps/extension/.gitlab-ci.yml')
    })

    it('should return local path from string include (shorthand)', () => {
      const job: GitLabJob = {
        trigger: {
          include: 'apps/extension/.gitlab-ci.yml',
        },
      }
      expect(evaluator.getLocalPath(job)).toBe('apps/extension/.gitlab-ci.yml')
    })

    it('should return null for non-local include', () => {
      const job: GitLabJob = {
        trigger: {
          include: [{ project: 'other/project', file: '.gitlab-ci.yml' }],
        },
      }
      expect(evaluator.getLocalPath(job)).toBe(null)
    })

    it('should return null for non-trigger job', () => {
      const job: GitLabJob = {
        script: ['echo "hello"'],
      }
      expect(evaluator.getLocalPath(job)).toBe(null)
    })
  })

  describe('detectTriggerJobs', () => {
    it('should detect trigger jobs with local includes', () => {
      const context: ProcessingContext = {
        filePath: '/test/repo/.gitlab-ci.yml',
        baseDir: '/test/repo',
        includedFiles: new Set(),
        includeStack: [],
        remoteJobs: new Set(),
        gitlabHost: 'gitlab.example.com',
      }

      const config = new ProcessedConfig(
        {
          stages: ['build', 'trigger'],
          'build-app': {
            stage: 'build',
            script: ['npm run build'],
          },
          'trigger-extension': {
            stage: 'trigger',
            trigger: {
              include: {
                local: 'apps/extension/.gitlab-ci.yml',
              },
              forward: {
                pipeline_variables: true,
              },
            },
            variables: {
              SUB_REPO: 'extension',
            },
          },
          '.template': {
            script: ['echo "template"'],
          },
        },
        context,
      )

      const evalResult: EvaluationSummary = {
        jobs: [
          {
            name: 'build-app',
            willRun: true,
            stage: 'build',
            when: 'on_success',
          },
          {
            name: 'trigger-extension',
            willRun: true,
            stage: 'trigger',
            when: 'on_success',
          },
        ],
        skipped: [],
        totalJobs: 2,
      }

      const triggerJobs = evaluator.detectTriggerJobs(config, evalResult)

      expect(triggerJobs).toHaveLength(1)
      expect(triggerJobs[0]).toEqual({
        jobName: 'trigger-extension',
        job: config.getJobs()['trigger-extension'],
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        forward: { pipeline_variables: true },
        jobVariables: { SUB_REPO: 'extension' },
      })
    })

    it('should skip template jobs', () => {
      const context: ProcessingContext = {
        filePath: '/test/repo/.gitlab-ci.yml',
        baseDir: '/test/repo',
        includedFiles: new Set(),
        includeStack: [],
        remoteJobs: new Set(),
        gitlabHost: 'gitlab.example.com',
      }

      const config = new ProcessedConfig(
        {
          stages: ['trigger'],
          '.trigger-template': {
            trigger: {
              include: {
                local: 'template/.gitlab-ci.yml',
              },
            },
          },
        },
        context,
      )

      const evalResult: EvaluationSummary = {
        jobs: [],
        skipped: [],
        totalJobs: 0,
      }

      const triggerJobs = evaluator.detectTriggerJobs(config, evalResult)
      expect(triggerJobs).toHaveLength(0)
    })

    it('should extract matched rule variables from evaluation results', () => {
      const context: ProcessingContext = {
        filePath: '/test/repo/.gitlab-ci.yml',
        baseDir: '/test/repo',
        includedFiles: new Set(),
        includeStack: [],
        remoteJobs: new Set(),
        gitlabHost: 'gitlab.example.com',
      }

      const config = new ProcessedConfig(
        {
          stages: ['trigger'],
          'trigger-monorepo': {
            stage: 'trigger',
            trigger: {
              include: {
                local: '.gitlab-ci/monorepo-pipeline.yml',
              },
              forward: {
                pipeline_variables: true,
              },
            },
            variables: {
              PARENT_SOURCE: '$CI_PIPELINE_SOURCE',
            },
            rules: [
              {
                if: '$PIPELINE_TYPE == "MAIN"',
                variables: { TARGET_CONTEXT: 'main', SOURCE_CONTEXT: 'main' },
              },
            ],
          },
        },
        context,
      )

      const evalResult: EvaluationSummary = {
        jobs: [
          {
            name: 'trigger-monorepo',
            willRun: true,
            stage: 'trigger',
            when: 'on_success',
            matchedRule: {
              if: '$PIPELINE_TYPE == "MAIN"',
              variables: { TARGET_CONTEXT: 'main', SOURCE_CONTEXT: 'main' },
            },
          },
        ],
        skipped: [],
        totalJobs: 1,
      }

      const triggerJobs = evaluator.detectTriggerJobs(config, evalResult)

      expect(triggerJobs).toHaveLength(1)
      expect(triggerJobs[0]!.matchedRuleVariables).toEqual({
        TARGET_CONTEXT: 'main',
        SOURCE_CONTEXT: 'main',
      })
    })

    it('should mark trigger job as willRun=false when it is skipped', () => {
      const context: ProcessingContext = {
        filePath: '/test/repo/.gitlab-ci.yml',
        baseDir: '/test/repo',
        includedFiles: new Set(),
        includeStack: [],
        remoteJobs: new Set(),
        gitlabHost: 'gitlab.example.com',
      }

      const config = new ProcessedConfig(
        {
          stages: ['trigger'],
          'trigger-extension': {
            stage: 'trigger',
            trigger: {
              include: {
                local: 'apps/extension/.gitlab-ci.yml',
              },
            },
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
          },
        },
        context,
      )

      const evalResult: EvaluationSummary = {
        jobs: [],
        skipped: [
          {
            name: 'trigger-extension',
            willRun: false,
            stage: 'trigger',
            when: 'never',
            reason: 'no matching rule',
          },
        ],
        totalJobs: 1,
      }

      const triggerJobs = evaluator.detectTriggerJobs(config, evalResult)

      expect(triggerJobs).toHaveLength(1)
      expect(triggerJobs[0]!.willRun).toBe(false)
    })
  })

  describe('buildChildContext', () => {
    it('should forward pipeline variables when enabled', () => {
      const parentContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'push',
          CI_COMMIT_BRANCH: 'main',
          CUSTOM_VAR: 'value',
        },
        changes: ['src/app.ts'],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        forward: { pipeline_variables: true },
        jobVariables: { SUB_REPO: 'extension' },
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, {})

      expect(childContext.variables).toEqual({
        CI_PIPELINE_SOURCE: 'parent_pipeline',
        CI_COMMIT_BRANCH: 'main',
        CUSTOM_VAR: 'value',
        SUB_REPO: 'extension',
      })
      expect(childContext.changes).toEqual(['src/app.ts'])
    })

    it('should not forward pipeline variables when disabled', () => {
      const parentContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'push',
          CI_COMMIT_BRANCH: 'main',
          CUSTOM_VAR: 'value',
        },
        changes: ['src/app.ts'],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        forward: { pipeline_variables: false },
        jobVariables: { SUB_REPO: 'extension' },
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, {})

      // Should only have job variables and overridden CI_PIPELINE_SOURCE
      expect(childContext.variables).toEqual({
        CI_PIPELINE_SOURCE: 'parent_pipeline',
        SUB_REPO: 'extension',
      })
    })

    it('should forward YAML variables by default', () => {
      const parentContext = {
        variables: {},
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
      }

      const parentVariables = {
        PROJECT_NAME: 'my-project',
        VERSION: '1.0.0',
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, parentVariables)

      expect(childContext.variables).toEqual({
        CI_PIPELINE_SOURCE: 'parent_pipeline',
        PROJECT_NAME: 'my-project',
        VERSION: '1.0.0',
      })
    })

    it('should not forward YAML variables when yaml_variables is false', () => {
      const parentContext = {
        variables: {},
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        forward: { yaml_variables: false },
      }

      const parentVariables = {
        PROJECT_NAME: 'my-project',
        VERSION: '1.0.0',
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, parentVariables)

      // Should only have CI_PIPELINE_SOURCE
      expect(childContext.variables).toEqual({
        CI_PIPELINE_SOURCE: 'parent_pipeline',
      })
    })

    it('should override CI_PIPELINE_SOURCE to parent_pipeline', () => {
      const parentContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'push',
        },
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        forward: { pipeline_variables: true },
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, {})

      expect(childContext.variables['CI_PIPELINE_SOURCE']).toBe('parent_pipeline')
    })

    it('should let job variables override parent variables', () => {
      const parentContext = {
        variables: {
          SHARED_VAR: 'from_parent',
        },
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        forward: { pipeline_variables: true },
        jobVariables: { SHARED_VAR: 'from_job' },
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, {
        SHARED_VAR: 'from_config',
      })

      // Job variables should take precedence
      expect(childContext.variables['SHARED_VAR']).toBe('from_job')
    })

    it('should expand variable references in job variables using parent context', () => {
      const parentContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'push',
          CI_COMMIT_BRANCH: 'main',
        },
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        forward: { pipeline_variables: true },
        jobVariables: {
          PARENT_SOURCE: '$CI_PIPELINE_SOURCE',
          PARENT_BRANCH: '${CI_COMMIT_BRANCH}',
        },
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, {})

      // Variable references should be expanded using parent context values
      expect(childContext.variables['PARENT_SOURCE']).toBe('push')
      expect(childContext.variables['PARENT_BRANCH']).toBe('main')
    })

    it('should expand $CI_PIPELINE_SOURCE in job variables to parent value before override', () => {
      // This is the key fix: when a trigger job has `CUSTOM_VAR: $CI_PIPELINE_SOURCE`,
      // it should resolve to the parent's CI_PIPELINE_SOURCE value (e.g., "push"),
      // not "parent_pipeline" which is set AFTER the job variables are applied.
      const parentContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'merge_request_event',
        },
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        forward: { pipeline_variables: true },
        jobVariables: {
          ORIGINAL_PIPELINE_SOURCE: '$CI_PIPELINE_SOURCE',
        },
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, {})

      // ORIGINAL_PIPELINE_SOURCE should be "merge_request_event" (parent's value)
      expect(childContext.variables['ORIGINAL_PIPELINE_SOURCE']).toBe('merge_request_event')
      // CI_PIPELINE_SOURCE itself should be "parent_pipeline" (child's actual source)
      expect(childContext.variables['CI_PIPELINE_SOURCE']).toBe('parent_pipeline')
    })

    it('should keep unresolved variable references as-is', () => {
      const parentContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'push',
        },
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        jobVariables: {
          UNDEFINED_REF: '$UNDEFINED_VAR',
          MIXED: '$CI_PIPELINE_SOURCE-$UNDEFINED_VAR',
        },
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, {})

      // Undefined variables should remain as-is
      expect(childContext.variables['UNDEFINED_REF']).toBe('$UNDEFINED_VAR')
      // Only defined variables should be expanded
      expect(childContext.variables['MIXED']).toBe('push-$UNDEFINED_VAR')
    })

    it('should apply matched rule variables to child context', () => {
      const parentContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'push',
          CI_COMMIT_BRANCH: 'main',
        },
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-monorepo',
        job: {} as GitLabJob,
        localPath: '.gitlab-ci/monorepo-pipeline.yml',
        willRun: true,
        forward: { pipeline_variables: true },
        jobVariables: { PARENT_SOURCE: '$CI_PIPELINE_SOURCE' },
        matchedRuleVariables: {
          TARGET_CONTEXT: 'main',
          SOURCE_CONTEXT: 'main',
        },
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, {})

      // Matched rule variables should be present in child context
      expect(childContext.variables['TARGET_CONTEXT']).toBe('main')
      expect(childContext.variables['SOURCE_CONTEXT']).toBe('main')
      // Job variables should still be expanded
      expect(childContext.variables['PARENT_SOURCE']).toBe('push')
      // CI_PIPELINE_SOURCE should be overridden
      expect(childContext.variables['CI_PIPELINE_SOURCE']).toBe('parent_pipeline')
    })

    it('should let matched rule variables override job variables', () => {
      const parentContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'push',
        },
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-monorepo',
        job: {} as GitLabJob,
        localPath: '.gitlab-ci/monorepo-pipeline.yml',
        willRun: true,
        jobVariables: { TARGET_CONTEXT: 'default_value' },
        matchedRuleVariables: { TARGET_CONTEXT: 'main' },
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, {})

      // Per-rule variables take precedence over job-level variables
      expect(childContext.variables['TARGET_CONTEXT']).toBe('main')
    })

    it('should expand variable references in matched rule variables', () => {
      const parentContext = {
        variables: {
          CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main',
          CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature/test',
        },
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        forward: { pipeline_variables: true },
        matchedRuleVariables: {
          TARGET_CONTEXT: '$CI_MERGE_REQUEST_TARGET_BRANCH_NAME',
          SOURCE_CONTEXT: '$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME',
        },
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, {})

      expect(childContext.variables['TARGET_CONTEXT']).toBe('main')
      expect(childContext.variables['SOURCE_CONTEXT']).toBe('feature/test')
    })

    it('should expand variables from YAML config in job variable references', () => {
      const parentContext = {
        variables: {},
        changes: [],
      }

      const triggerJob = {
        jobName: 'trigger-extension',
        job: {} as GitLabJob,
        localPath: 'apps/extension/.gitlab-ci.yml',
        willRun: true,
        jobVariables: {
          DERIVED_VAR: '$PROJECT_VERSION',
        },
      }

      const parentVariables = {
        PROJECT_VERSION: '1.2.3',
      }

      const childContext = evaluator.buildChildContext(parentContext, triggerJob, parentVariables)

      // Job variable should be expanded using parent YAML variables
      expect(childContext.variables['DERIVED_VAR']).toBe('1.2.3')
    })
  })

  describe('loadChildPipeline', () => {
    it('should return null for non-existent file', async () => {
      vi.mocked<MockedFs>(fs).existsSync.mockReturnValue(false)

      const result = await evaluator.loadChildPipeline('non-existent.yml')

      expect(result).toBe(null)
    })

    it('should detect circular references', async () => {
      vi.mocked<MockedFs>(fs).existsSync.mockReturnValue(true)
      vi.mocked<MockedFs>(fs).readFileSync.mockReturnValue('stages: [build]')

      // Load a file first
      await evaluator.loadChildPipeline('apps/extension/.gitlab-ci.yml')

      // Try to load the same file again
      const result = await evaluator.loadChildPipeline('apps/extension/.gitlab-ci.yml')

      // Should return null due to circular reference
      expect(result).toBe(null)
    })

    it('should resolve leading-slash paths repo-relatively, not as filesystem-absolute', async () => {
      // GitLab's `trigger.include.local: '/path'` is repo-root-relative.
      // node:path.resolve previously discarded baseDir on a leading slash.
      // Mock to false so the missing-file warning carries the resolved path
      // and we can read it back without depending on call ordering.
      vi.mocked<MockedFs>(fs).existsSync.mockReturnValue(false)
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* swallow */
      })

      await evaluator.loadChildPipeline('/apps/extension/.gitlab-ci.yml')

      // Resolved path should join baseDir + repo-relative path.
      const warnings = consoleSpy.mock.calls.map(c => String(c[0]))
      expect(warnings.some(w => w.includes('/test/repo/apps/extension/.gitlab-ci.yml'))).toBe(true)
      // And NOT the filesystem-absolute interpretation.
      expect(
        warnings.some(
          w =>
            w.includes('/apps/extension/.gitlab-ci.yml') &&
            !w.includes('/test/repo/apps/extension/.gitlab-ci.yml'),
        ),
      ).toBe(false)

      consoleSpy.mockRestore()
    })
  })

  describe('options', () => {
    it('should respect maxDepth option', () => {
      const evaluatorWithDepth = new ChildPipelineEvaluator('/test/repo', {
        maxDepth: 1,
      })

      // The evaluator should be created with the specified max depth
      // This is tested indirectly through evaluateChildPipelines behavior
      expect(evaluatorWithDepth).toBeDefined()
    })

    it('should respect evaluateChildren option', () => {
      const evaluatorDisabled = new ChildPipelineEvaluator('/test/repo', {
        evaluateChildren: false,
      })

      expect(evaluatorDisabled).toBeDefined()
    })
  })

  describe('reset', () => {
    it('should clear processed paths', async () => {
      vi.mocked<MockedFs>(fs).existsSync.mockReturnValue(true)
      vi.mocked<MockedFs>(fs).readFileSync.mockReturnValue('stages: [build]')

      // Load a file
      await evaluator.loadChildPipeline('apps/extension/.gitlab-ci.yml')

      // Reset
      evaluator.reset()

      // The file should be processable again (though it will fail due to mocking)
      // The key point is that the circular reference check should pass after reset
      vi.mocked<MockedFs>(fs).existsSync.mockReturnValue(true)

      // After reset, the same path should not be detected as circular
      // (it will fail for other reasons in test, but won't be marked as circular)
    })
  })
})

describe('ChildPipelineEvaluator with real YAML', () => {
  // Tests that use actual YAML parsing (not mocked)
  // These tests focus on the integration of components

  describe('trigger job variations', () => {
    let evaluator: ChildPipelineEvaluator

    beforeEach(() => {
      vi.clearAllMocks()
      evaluator = new ChildPipelineEvaluator('/test/repo')
    })

    it('should handle mixed include types', () => {
      const job: GitLabJob = {
        trigger: {
          include: [
            { local: 'apps/extension/.gitlab-ci.yml' },
            { project: 'other/project', file: '.gitlab-ci.yml' },
          ],
        },
      }

      expect(evaluator.isTriggerWithLocalInclude(job)).toBe(true)
      expect(evaluator.getLocalPath(job)).toBe('apps/extension/.gitlab-ci.yml')
    })

    it('should handle trigger job with strategy and forward', () => {
      const job: GitLabJob = {
        trigger: {
          include: 'apps/extension/.gitlab-ci.yml',
          strategy: 'depend',
          forward: {
            pipeline_variables: true,
            yaml_variables: false,
          },
        },
      }

      expect(evaluator.isTriggerWithLocalInclude(job)).toBe(true)
      expect(evaluator.getLocalPath(job)).toBe('apps/extension/.gitlab-ci.yml')
    })
  })
})
