import { describe, expect, it } from 'vitest'
import { checkJobStageAssignments } from './checkJobStageAssignments'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig'
import { type GitLabCI } from '../types'

describe('checkJobStageAssignments', () => {
  const createMockContext = (overrides?: Partial<ProcessingContext>): ProcessingContext => ({
    filePath: '.gitlab-ci.yml',
    baseDir: '/project',
    includedFiles: new Set(),
    includeStack: [],
    remoteJobs: new Set(),
    gitlabHost: 'gitlab.example.com',
    ...overrides,
  })

  const createProcessedConfig = (
    config: GitLabCI,
    contextOverrides?: Partial<ProcessingContext>,
  ): ProcessedConfig => {
    return new ProcessedConfig(config, createMockContext(contextOverrides))
  }

  describe('default stages', () => {
    it('should allow jobs in default GitLab stages', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
          stage: 'build',
        },
        'test:unit': {
          script: ['npm test'],
          stage: 'test',
        },
        'deploy:prod': {
          script: ['npm run deploy'],
          stage: 'deploy',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should allow jobs in .pre and .post stages', () => {
      const config: GitLabCI = {
        setup: {
          script: ['echo "setup"'],
          stage: '.pre',
        },
        cleanup: {
          script: ['echo "cleanup"'],
          stage: '.post',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should allow jobs without explicit stage (defaults to test)', () => {
      const config: GitLabCI = {
        'test:unit': {
          script: ['npm test'],
          // No stage specified - should default to 'test'
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should report error for job with invalid stage', () => {
      const config: GitLabCI = {
        'invalid:job': {
          script: ['echo "invalid"'],
          stage: 'custom-stage',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message:
          "Job 'invalid:job' references undefined stage 'custom-stage'. Available stages: .pre, build, test, deploy, .post",
        location: 'invalid:job',
      })
    })
  })

  describe('declared stages', () => {
    it('should allow jobs in custom declared stages', () => {
      const config: GitLabCI = {
        stages: ['prepare', 'build', 'test', 'release'],
        'prep:env': {
          script: ['echo "preparing"'],
          stage: 'prepare',
        },
        'build:app': {
          script: ['npm run build'],
          stage: 'build',
        },
        'release:prod': {
          script: ['npm run release'],
          stage: 'release',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should always allow .pre and .post stages even when custom stages declared', () => {
      const config: GitLabCI = {
        stages: ['custom1', 'custom2'],
        setup: {
          script: ['echo "setup"'],
          stage: '.pre',
        },
        'custom:job': {
          script: ['echo "custom"'],
          stage: 'custom1',
        },
        cleanup: {
          script: ['echo "cleanup"'],
          stage: '.post',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should report error for job using default stage when custom stages declared', () => {
      const config: GitLabCI = {
        stages: ['prepare', 'package', 'release'],
        'build:app': {
          script: ['npm run build'],
          stage: 'build', // 'build' is not in declared stages
        },
        'prep:env': {
          script: ['echo "preparing"'],
          stage: 'prepare',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message:
          "Job 'build:app' references undefined stage 'build'. Available stages: .pre, prepare, package, release, .post",
        location: 'build:app',
      })
    })

    it('should report error for job using completely invalid stage', () => {
      const config: GitLabCI = {
        stages: ['alpha', 'beta', 'gamma'],
        'invalid:job': {
          script: ['echo "invalid"'],
          stage: 'nonexistent',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message:
          "Job 'invalid:job' references undefined stage 'nonexistent'. Available stages: .pre, alpha, beta, gamma, .post",
        location: 'invalid:job',
      })
    })
  })

  describe('multiple jobs with mixed validity', () => {
    it('should report multiple errors for multiple invalid stage assignments', () => {
      const config: GitLabCI = {
        stages: ['compile', 'verify'],
        'valid:job': {
          script: ['echo "valid"'],
          stage: 'compile',
        },
        'invalid:job1': {
          script: ['echo "invalid1"'],
          stage: 'build', // Not in declared stages
        },
        'invalid:job2': {
          script: ['echo "invalid2"'],
          stage: 'nonexistent', // Completely invalid
        },
        'another:valid': {
          script: ['echo "valid"'],
          stage: '.pre', // Always valid
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(2)

      const job1Issue = issues.find(issue => issue.location === 'invalid:job1')
      const job2Issue = issues.find(issue => issue.location === 'invalid:job2')

      expect(job1Issue).toEqual({
        severity: 'error',
        message:
          "Job 'invalid:job1' references undefined stage 'build'. Available stages: .pre, compile, verify, .post",
        location: 'invalid:job1',
      })

      expect(job2Issue).toEqual({
        severity: 'error',
        message:
          "Job 'invalid:job2' references undefined stage 'nonexistent'. Available stages: .pre, compile, verify, .post",
        location: 'invalid:job2',
      })
    })
  })

  describe('edge cases', () => {
    it('should handle empty config without errors', () => {
      const config: GitLabCI = {}

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle config with only template jobs', () => {
      const config: GitLabCI = {
        '.template:job': {
          script: ['echo "template"'],
          stage: 'build',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle declared stages with same names as default stages', () => {
      const config: GitLabCI = {
        stages: ['build', 'test', 'deploy'], // Same as some default stages
        'build:app': {
          script: ['npm run build'],
          stage: 'build',
        },
        'test:unit': {
          script: ['npm test'],
          stage: 'test',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle empty stages array', () => {
      const config: GitLabCI = {
        stages: [],
        'test:job': {
          script: ['echo "test"'],
          stage: 'test', // Should be allowed as default stage
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkJobStageAssignments(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })
})
