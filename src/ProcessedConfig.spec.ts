import { describe, expect, it } from 'vitest'
import { ProcessedConfig, type ProcessingContext } from './ProcessedConfig'
import type { GitLabCI } from './types'

describe('ProcessedConfig', () => {
  const createMockContext = (overrides?: Partial<ProcessingContext>): ProcessingContext => ({
    filePath: '.gitlab-ci.yml',
    baseDir: '/project',
    includedFiles: new Set(),
    includeStack: [],
    remoteJobs: new Set(),
    gitlabHost: 'gitlab.example.com',
    ...overrides,
  })

  describe('getJobs()', () => {
    it('should extract jobs excluding reserved keys', () => {
      const config: GitLabCI = {
        stages: ['build', 'test'],
        variables: { NODE_ENV: 'test' },
        workflow: { rules: [] },
        include: [],
        'build:app': {
          script: ['npm run build'],
        },
        'test:unit': {
          script: ['npm test'],
        },
      }

      const processedConfig = new ProcessedConfig(config, createMockContext())
      const jobs = processedConfig.getJobs()

      expect(jobs).toEqual({
        'build:app': { script: ['npm run build'] },
        'test:unit': { script: ['npm test'] },
      })

      // Should not include reserved keys
      expect('stages' in jobs).toBe(false)
      expect('variables' in jobs).toBe(false)
      expect('workflow' in jobs).toBe(false)
      expect('include' in jobs).toBe(false)
    })

    it('should handle config with no jobs', () => {
      const config: GitLabCI = {
        stages: ['build'],
        variables: { ENV: 'test' },
      }

      const processedConfig = new ProcessedConfig(config, createMockContext())
      const jobs = processedConfig.getJobs()

      expect(jobs).toEqual({})
    })

    it('should ignore non-object values', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['build'],
        },
        'some-string': 'not a job' as any,
        'some-number': 42 as any,
        'some-null': null as any,
      }

      const processedConfig = new ProcessedConfig(config, createMockContext())
      const jobs = processedConfig.getJobs()

      expect(jobs).toEqual({
        'build:app': { script: ['build'] },
      })
    })

    it('should include template jobs (starting with .)', () => {
      const config: GitLabCI = {
        '.template': {
          script: ['echo "template"'],
        },
        'actual-job': {
          extends: '.template',
          script: ['echo "job"'],
        },
      }

      const processedConfig = new ProcessedConfig(config, createMockContext())
      const jobs = processedConfig.getJobs()

      expect(jobs).toEqual({
        '.template': { script: ['echo "template"'] },
        'actual-job': {
          extends: '.template',
          script: ['echo "job"'],
        },
      })
    })

    it('should exclude all top-level GitLab CI reserved keywords', () => {
      const config: GitLabCI = {
        stages: ['build', 'test'],
        variables: { NODE_ENV: 'test' },
        workflow: { rules: [] },
        include: [],
        default: {
          image: 'node:18',
          before_script: ['npm ci'],
        },
        cache: {
          key: '$CI_COMMIT_REF_SLUG',
          paths: ['node_modules/'],
        },
        image: 'ruby:3.0',
        services: ['postgres:13'],
        before_script: ['echo "global before"'],
        after_script: ['echo "global after"'],
        artifacts: {
          paths: ['dist/'],
          expire_in: '1 week',
        },
        'build:app': {
          script: ['npm run build'],
        },
      }

      const processedConfig = new ProcessedConfig(config, createMockContext())
      const jobs = processedConfig.getJobs()

      // Should only contain the actual job
      expect(Object.keys(jobs)).toEqual(['build:app'])
      expect(jobs['build:app']).toEqual({ script: ['npm run build'] })

      // Verify all reserved keywords are excluded
      expect('stages' in jobs).toBe(false)
      expect('variables' in jobs).toBe(false)
      expect('workflow' in jobs).toBe(false)
      expect('include' in jobs).toBe(false)
      expect('default' in jobs).toBe(false)
      expect('cache' in jobs).toBe(false)
      expect('image' in jobs).toBe(false)
      expect('services' in jobs).toBe(false)
      expect('before_script' in jobs).toBe(false)
      expect('after_script' in jobs).toBe(false)
      expect('artifacts' in jobs).toBe(false)
    })
  })

  describe('getStages()', () => {
    it('should return configured stages', () => {
      const config: GitLabCI = {
        stages: ['prepare', 'build', 'test', 'deploy', 'cleanup'],
      }

      const processedConfig = new ProcessedConfig(config, createMockContext())
      const stages = processedConfig.getStages()

      expect(stages).toEqual(['prepare', 'build', 'test', 'deploy', 'cleanup'])
    })

    it('should return default GitLab stages when no stages configured', () => {
      const config: GitLabCI = {}

      const processedConfig = new ProcessedConfig(config, createMockContext())
      const stages = processedConfig.getStages()

      expect(stages).toEqual(['.pre', 'build', 'test', 'deploy', '.post'])
    })

    it('should return default stages when stages is empty array', () => {
      const config: GitLabCI = {
        stages: [],
      }

      const processedConfig = new ProcessedConfig(config, createMockContext())
      const stages = processedConfig.getStages()

      expect(stages).toEqual([])
    })
  })

  describe('getVariables()', () => {
    it('should return configured variables', () => {
      const config: GitLabCI = {
        variables: {
          NODE_ENV: 'production',
          API_URL: 'https://api.example.com',
          DEBUG: 'false',
        },
      }

      const processedConfig = new ProcessedConfig(config, createMockContext())
      const variables = processedConfig.getVariables()

      expect(variables).toEqual({
        NODE_ENV: 'production',
        API_URL: 'https://api.example.com',
        DEBUG: 'false',
      })
    })

    it('should return empty object when no variables configured', () => {
      const config: GitLabCI = {}

      const processedConfig = new ProcessedConfig(config, createMockContext())
      const variables = processedConfig.getVariables()

      expect(variables).toEqual({})
    })

    it('should return empty object when variables is explicitly null/undefined', () => {
      const config1: GitLabCI = { variables: null as any }
      const config2: GitLabCI = { variables: undefined as any }

      const processedConfig1 = new ProcessedConfig(config1, createMockContext())
      const processedConfig2 = new ProcessedConfig(config2, createMockContext())

      expect(processedConfig1.getVariables()).toEqual({})
      expect(processedConfig2.getVariables()).toEqual({})
    })
  })

  describe('isRemoteJob()', () => {
    it('should return true for remote jobs', () => {
      const context = createMockContext({
        remoteJobs: new Set(['remote-job-1', 'remote-job-2']),
      })
      const processedConfig = new ProcessedConfig({}, context)

      expect(processedConfig.isRemoteJob('remote-job-1')).toBe(true)
      expect(processedConfig.isRemoteJob('remote-job-2')).toBe(true)
    })

    it('should return false for non-remote jobs', () => {
      const context = createMockContext({
        remoteJobs: new Set(['remote-job-1']),
      })
      const processedConfig = new ProcessedConfig({}, context)

      expect(processedConfig.isRemoteJob('local-job')).toBe(false)
      expect(processedConfig.isRemoteJob('another-local-job')).toBe(false)
    })

    it('should return false when no remote jobs exist', () => {
      const context = createMockContext({
        remoteJobs: new Set(),
      })
      const processedConfig = new ProcessedConfig({}, context)

      expect(processedConfig.isRemoteJob('any-job')).toBe(false)
    })

    it('should handle empty string job names', () => {
      const context = createMockContext({
        remoteJobs: new Set(['remote-job']),
      })
      const processedConfig = new ProcessedConfig({}, context)

      expect(processedConfig.isRemoteJob('')).toBe(false)
    })
  })

  describe('getRemoteJobs()', () => {
    it('should return the remote jobs set', () => {
      const remoteJobs = new Set(['job-1', 'job-2', 'job-3'])
      const context = createMockContext({ remoteJobs })
      const processedConfig = new ProcessedConfig({}, context)

      const result = processedConfig.getRemoteJobs()

      expect(result).toBe(remoteJobs) // Same reference
      expect(result).toEqual(new Set(['job-1', 'job-2', 'job-3']))
    })

    it('should return empty set when no remote jobs exist', () => {
      const context = createMockContext({
        remoteJobs: new Set(),
      })
      const processedConfig = new ProcessedConfig({}, context)

      const result = processedConfig.getRemoteJobs()

      expect(result).toEqual(new Set())
    })

    it('should return reference to the same set (not a copy)', () => {
      const remoteJobs = new Set(['job-1'])
      const context = createMockContext({ remoteJobs })
      const processedConfig = new ProcessedConfig({}, context)

      const result = processedConfig.getRemoteJobs()

      // Modify the original set
      remoteJobs.add('job-2')

      // The returned set should also have the new job
      expect(result.has('job-2')).toBe(true)
    })
  })

  describe('integration scenarios', () => {
    it('should work with complete GitLab CI configuration', () => {
      const config: GitLabCI = {
        stages: ['build', 'test', 'deploy'],
        variables: {
          NODE_ENV: 'production',
          DOCKER_DRIVER: 'overlay2',
        },
        workflow: {
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
        '.build-template': {
          image: 'node:18',
          before_script: ['npm install'],
        },
        'build:frontend': {
          extends: '.build-template',
          script: ['npm run build:frontend'],
          stage: 'build',
        },
        'test:unit': {
          script: ['npm test'],
          stage: 'test',
        },
        'deploy:production': {
          script: ['kubectl apply -f deployment.yml'],
          stage: 'deploy',
        },
      }

      const context = createMockContext({
        remoteJobs: new Set(['deploy:production']),
      })

      const processedConfig = new ProcessedConfig(config, context)

      // Test all methods work together
      expect(processedConfig.getStages()).toEqual(['build', 'test', 'deploy'])
      expect(processedConfig.getVariables()).toEqual({
        NODE_ENV: 'production',
        DOCKER_DRIVER: 'overlay2',
      })

      const jobs = processedConfig.getJobs()
      expect(Object.keys(jobs)).toEqual([
        '.build-template',
        'build:frontend',
        'test:unit',
        'deploy:production',
      ])

      expect(processedConfig.isRemoteJob('deploy:production')).toBe(true)
      expect(processedConfig.isRemoteJob('build:frontend')).toBe(false)

      expect(processedConfig.getRemoteJobs()).toEqual(new Set(['deploy:production']))
    })
  })
})
