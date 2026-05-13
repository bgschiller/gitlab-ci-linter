import { describe, expect, it } from 'vitest'
import { checkCircularDependencies } from './checkCircularDependencies'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig'
import { type GitLabCI } from '../types'

describe('checkCircularDependencies', () => {
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

  describe('simple circular dependencies', () => {
    it('should detect simple circular dependency with dependencies field', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo "job1"'],
          dependencies: ['job2'],
        },
        job2: {
          script: ['echo "job2"'],
          dependencies: ['job1'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message: 'Circular dependency detected: job1 → job2 → job1',
        location: 'job1',
      })
    })

    it('should detect simple circular dependency with needs field', () => {
      const config: GitLabCI = {
        build: {
          script: ['echo "build"'],
          needs: ['test'],
        },
        test: {
          script: ['echo "test"'],
          needs: ['build'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message: 'Circular dependency detected: build → test → build',
        location: 'build',
      })
    })

    it('should detect circular dependency with needs object format', () => {
      const config: GitLabCI = {
        deploy: {
          script: ['echo "deploy"'],
          needs: [{ job: 'package', artifacts: true }],
        },
        package: {
          script: ['echo "package"'],
          needs: [{ job: 'deploy', artifacts: false }],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message: 'Circular dependency detected: deploy → package → deploy',
        location: 'deploy',
      })
    })

    it('should detect self-referencing job', () => {
      const config: GitLabCI = {
        recursive: {
          script: ['echo "recursive"'],
          dependencies: ['recursive'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message: 'Circular dependency detected: recursive → recursive',
        location: 'recursive',
      })
    })
  })

  describe('complex circular dependencies', () => {
    it('should detect circular dependency in a chain of three jobs', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo "job1"'],
          dependencies: ['job2'],
        },
        job2: {
          script: ['echo "job2"'],
          dependencies: ['job3'],
        },
        job3: {
          script: ['echo "job3"'],
          dependencies: ['job1'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message: 'Circular dependency detected: job1 → job2 → job3 → job1',
        location: 'job1',
      })
    })

    it('should detect circular dependency in longer chain', () => {
      const config: GitLabCI = {
        a: {
          script: ['echo "a"'],
          needs: ['b'],
        },
        b: {
          script: ['echo "b"'],
          needs: ['c'],
        },
        c: {
          script: ['echo "c"'],
          needs: ['d'],
        },
        d: {
          script: ['echo "d"'],
          needs: ['e'],
        },
        e: {
          script: ['echo "e"'],
          needs: ['a'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message: 'Circular dependency detected: a → b → c → d → e → a',
        location: 'a',
      })
    })

    it('should detect multiple separate circular dependencies', () => {
      const config: GitLabCI = {
        // First cycle
        job1: {
          script: ['echo "job1"'],
          dependencies: ['job2'],
        },
        job2: {
          script: ['echo "job2"'],
          dependencies: ['job1'],
        },
        // Second cycle
        job3: {
          script: ['echo "job3"'],
          needs: ['job4'],
        },
        job4: {
          script: ['echo "job4"'],
          needs: ['job3'],
        },
        // Independent job
        job5: {
          script: ['echo "job5"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(2)

      const cycles = issues.map(issue => issue.message)
      expect(cycles).toContain('Circular dependency detected: job1 → job2 → job1')
      expect(cycles).toContain('Circular dependency detected: job3 → job4 → job3')
    })

    it('should detect cycle with mixed dependencies and needs', () => {
      const config: GitLabCI = {
        build: {
          script: ['echo "build"'],
          dependencies: ['test'],
        },
        test: {
          script: ['echo "test"'],
          needs: ['deploy'],
        },
        deploy: {
          script: ['echo "deploy"'],
          dependencies: ['build'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message: 'Circular dependency detected: build → test → deploy → build',
        location: 'build',
      })
    })
  })

  describe('no circular dependencies', () => {
    it('should not detect issues in linear dependency chain', () => {
      const config: GitLabCI = {
        build: {
          script: ['echo "build"'],
        },
        test: {
          script: ['echo "test"'],
          dependencies: ['build'],
        },
        deploy: {
          script: ['echo "deploy"'],
          dependencies: ['test'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not detect issues in diamond dependency pattern', () => {
      const config: GitLabCI = {
        build: {
          script: ['echo "build"'],
        },
        test1: {
          script: ['echo "test1"'],
          dependencies: ['build'],
        },
        test2: {
          script: ['echo "test2"'],
          dependencies: ['build'],
        },
        deploy: {
          script: ['echo "deploy"'],
          dependencies: ['test1', 'test2'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not detect issues when jobs have no dependencies', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo "job1"'],
        },
        job2: {
          script: ['echo "job2"'],
        },
        job3: {
          script: ['echo "job3"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not detect issues with complex branching dependencies', () => {
      const config: GitLabCI = {
        'build:frontend': {
          script: ['npm run build'],
        },
        'build:backend': {
          script: ['npm run build:server'],
        },
        'test:unit': {
          script: ['npm test'],
          needs: ['build:frontend', 'build:backend'],
        },
        'test:integration': {
          script: ['npm run test:integration'],
          dependencies: ['build:frontend', 'build:backend'],
        },
        'test:e2e': {
          script: ['npm run test:e2e'],
          needs: ['test:unit'],
        },
        'deploy:staging': {
          script: ['deploy staging'],
          dependencies: ['test:unit', 'test:integration'],
        },
        'deploy:production': {
          script: ['deploy production'],
          needs: ['test:e2e', 'deploy:staging'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('should ignore dependencies that reference non-existent jobs', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo "job1"'],
          dependencies: ['non-existent-job'],
        },
        job2: {
          script: ['echo "job2"'],
          needs: ['another-non-existent-job'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle empty dependencies arrays', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo "job1"'],
          dependencies: [],
        },
        job2: {
          script: ['echo "job2"'],
          needs: [],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle mixed string and object needs', () => {
      const config: GitLabCI = {
        build: {
          script: ['echo "build"'],
        },
        test: {
          script: ['echo "test"'],
          needs: ['build', { job: 'lint', artifacts: false }],
        },
        lint: {
          script: ['echo "lint"'],
        },
        deploy: {
          script: ['echo "deploy"'],
          needs: ['test'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle needs with invalid job references', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo "job1"'],
          needs: [
            { job: '', artifacts: true }, // empty job name
            { job: null as any, artifacts: false }, // null job name
            { artifacts: true } as any, // missing job field
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle single need as object instead of array', () => {
      const config: GitLabCI = {
        build: {
          script: ['echo "build"'],
        },
        test: {
          script: ['echo "test"'],
          needs: { job: 'build', artifacts: true } as any,
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should detect cycle even when some dependencies are non-existent', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo "job1"'],
          dependencies: ['job2', 'non-existent'],
        },
        job2: {
          script: ['echo "job2"'],
          dependencies: ['job3', 'also-non-existent'],
        },
        job3: {
          script: ['echo "job3"'],
          dependencies: ['job1'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message: 'Circular dependency detected: job1 → job2 → job3 → job1',
        location: 'job1',
      })
    })
  })

  describe('real-world scenarios', () => {
    it('should handle typical CI/CD pipeline without cycles', () => {
      const config: GitLabCI = {
        'install:deps': {
          script: ['npm ci'],
          stage: 'build',
        },
        'build:app': {
          script: ['npm run build'],
          stage: 'build',
          needs: ['install:deps'],
        },
        'test:unit': {
          script: ['npm run test:unit'],
          stage: 'test',
          needs: ['install:deps'],
        },
        'test:integration': {
          script: ['npm run test:integration'],
          stage: 'test',
          needs: ['build:app'],
        },
        'test:e2e': {
          script: ['npm run test:e2e'],
          stage: 'test',
          needs: ['build:app'],
        },
        'security:scan': {
          script: ['npm audit'],
          stage: 'test',
          needs: ['install:deps'],
        },
        'deploy:staging': {
          script: ['kubectl apply -f staging.yml'],
          stage: 'deploy',
          dependencies: ['test:unit', 'test:integration', 'security:scan'],
        },
        'deploy:production': {
          script: ['kubectl apply -f production.yml'],
          stage: 'deploy',
          when: 'manual',
          needs: ['deploy:staging', 'test:e2e'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should detect problematic cycle in complex pipeline', () => {
      const config: GitLabCI = {
        build: {
          script: ['npm run build'],
          stage: 'build',
        },
        'test:unit': {
          script: ['npm test'],
          stage: 'test',
          needs: ['build'],
        },
        'test:integration': {
          script: ['npm run test:integration'],
          stage: 'test',
          needs: ['build', 'deploy:review'], // Problematic: depends on deploy
        },
        'deploy:review': {
          script: ['deploy to review environment'],
          stage: 'deploy',
          dependencies: ['test:unit', 'test:integration'], // Circular: depends on integration tests
        },
        'deploy:production': {
          script: ['deploy to production'],
          stage: 'deploy',
          when: 'manual',
          needs: ['test:unit'], // Fixed: only depends on test:unit, not deploy:review
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkCircularDependencies(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message:
          'Circular dependency detected: test:integration → deploy:review → test:integration',
        location: 'test:integration',
      })
    })
  })
})
