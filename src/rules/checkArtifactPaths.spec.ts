import { assert, describe, expect, it } from 'vitest'
import { checkArtifactPaths } from './checkArtifactPaths'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig'
import { type GitLabCI } from '../types'

describe('checkArtifactPaths', () => {
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

  describe('expire_in validation', () => {
    it('should detect invalid expire_in format', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
          artifacts: {
            paths: ['dist/'],
            expire_in: 'invalid-format',
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message:
          "Job 'build:app' has invalid artifact expire_in value 'invalid-format'. Expected format: number + unit (e.g., '1 day', '2 weeks', '30 mins', 'never')",
        location: 'build:app',
      })
    })

    it('should accept valid expire_in formats', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
          artifacts: {
            paths: ['dist/'],
            expire_in: '1 day',
          },
        },
        'test:unit': {
          script: ['npm test'],
          artifacts: {
            paths: ['coverage/'],
            expire_in: '2 weeks',
          },
        },
        'build:docs': {
          script: ['make docs'],
          artifacts: {
            paths: ['docs/'],
            expire_in: '30 mins',
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should accept "never" as valid expire_in but warn about storage', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
          artifacts: {
            paths: ['dist/'],
            expire_in: 'never',
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message:
          "Job 'build:app' has artifacts that never expire. Consider setting an expiration to manage storage costs",
        location: 'build:app',
      })
    })

    it('should accept various time unit formats', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '1 second' },
        },
        job2: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '5 minutes' },
        },
        job3: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '2 hours' },
        },
        job4: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '3 days' },
        },
        job5: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '1 month' },
        },
        job6: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '2 years' },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should accept abbreviated time unit formats', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '30 mins' },
        },
        job2: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '2 hrs' },
        },
        job3: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '5 secs' },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should accept year/month abbreviations (yrs, mos)', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '5 yrs' },
        },
        job2: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '1 yr' },
        },
        job3: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '6 mos' },
        },
        job4: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '1 mo' },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should accept single-letter abbreviations (h, d, s)', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '2h' },
        },
        job2: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '7d' },
        },
        job3: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '30s' },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should accept bare numbers (interpreted as seconds)', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '42' },
        },
        job2: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '3600' },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should accept combined time units', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '3 mins 4 sec' },
        },
        job2: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '2 hrs 20 min' },
        },
        job3: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '6 mos 1 day' },
        },
        job4: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '3 weeks and 2 days' },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should accept condensed time formats', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '2h20min' },
        },
        job2: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '1d12h' },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })

  describe('paths validation', () => {
    it('should warn about empty paths array', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
          artifacts: {
            paths: [],
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message:
          "Job 'build:app' has empty artifacts.paths array. Consider removing the artifacts configuration or specifying paths",
        location: 'build:app',
      })
    })

    it('should warn about overly broad artifact paths', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
          artifacts: {
            paths: ['/', '*', '**/*', '**', '.', './'],
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(6)
      for (const issue of issues) {
        expect(issue.severity).toBe('warning')
        expect(issue.message).toContain('potentially overly broad artifact path')
        expect(issue.location).toBe('build:app')
      }
    })

    it('should warn about large directory patterns', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
          artifacts: {
            paths: [
              'node_modules/',
              'node_modules/**',
              '.git/',
              '.git/**',
              'vendor/',
              'vendor/**',
              '.cache/',
              '.cache/**',
              'tmp/',
              'tmp/**',
              'logs/',
              'logs/**',
            ],
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(12)
      for (const issue of issues) {
        expect(issue.severity).toBe('warning')
        expect(issue.message).toContain('potentially overly broad artifact path')
      }
    })

    it('should warn about overly broad glob patterns', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
          artifacts: {
            paths: [
              '**/*.log',
              '**/*.tmp',
              '**/*.temp',
              '**/node_modules/**',
              '**/vendor/**',
              '**/.git/**',
              '**/.cache/**',
            ],
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(7)
      for (const issue of issues) {
        expect(issue.severity).toBe('warning')
        expect(issue.message).toContain('potentially overly broad artifact path')
      }
    })

    it('should warn about patterns with too many wildcards', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
          artifacts: {
            paths: ['**/**/***/**'],
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)
      const issue = issues[0]
      assert(issue)

      expect(issue.severity).toBe('warning')
      expect(issue.message).toContain('potentially overly broad artifact path')
    })

    it('should allow reasonable artifact paths', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
          artifacts: {
            paths: [
              'dist/',
              'build/lib/',
              'target/release/myapp',
              'output/*.jar',
              'docs/_build/html/',
              'coverage/lcov-report/',
              'reports/junit.xml',
            ],
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })

  describe('mixed scenarios', () => {
    it('should handle multiple issues in single job', () => {
      const config: GitLabCI = {
        'problematic:job': {
          script: ['echo test'],
          artifacts: {
            paths: ['**/*'],
            expire_in: 'invalid-time',
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(2)
      expect(issues.find(i => i.severity === 'error')).toBeDefined()
      expect(issues.find(i => i.severity === 'warning')).toBeDefined()
    })

    it('should handle jobs without artifacts', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
        },
        'test:unit': {
          script: ['npm test'],
          artifacts: {
            paths: ['coverage/'],
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle complex real-world scenario', () => {
      const config: GitLabCI = {
        'build:frontend': {
          script: ['npm run build'],
          artifacts: {
            paths: ['dist/'],
            expire_in: '1 week',
          },
        },
        'test:backend': {
          script: ['go test ./...'],
          artifacts: {
            paths: ['coverage.html'],
            reports: {
              junit: 'report.xml',
            },
            expire_in: '3 days',
          },
        },
        'deploy:staging': {
          script: ['kubectl apply -f staging.yml'],
          artifacts: {
            paths: [],
            expire_in: '1 hour',
          },
        },
        'backup:everything': {
          script: ['tar -czf backup.tar.gz .'],
          artifacts: {
            paths: ['**/*'],
            expire_in: 'never',
          },
        },
        'invalid:job': {
          script: ['echo test'],
          artifacts: {
            expire_in: 'wrong-format',
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(4)

      // Empty paths warning
      expect(
        issues.find(
          i => i.location === 'deploy:staging' && i.message.includes('empty artifacts.paths'),
        ),
      ).toBeDefined()

      // Overly broad path warning
      expect(
        issues.find(i => i.location === 'backup:everything' && i.message.includes('overly broad')),
      ).toBeDefined()

      // Never expires warning
      expect(
        issues.find(i => i.location === 'backup:everything' && i.message.includes('never expire')),
      ).toBeDefined()

      // Invalid expire_in error
      expect(issues.find(i => i.location === 'invalid:job' && i.severity === 'error')).toBeDefined()
    })

    it('should handle artifacts with both valid and problematic paths', () => {
      const config: GitLabCI = {
        'mixed:artifacts': {
          script: ['build everything'],
          artifacts: {
            paths: [
              'dist/', // Good
              'reports/*.xml', // Good
              '**/*', // Bad - too broad
              'build/output/', // Good
              'node_modules/**', // Bad - large directory
            ],
            expire_in: '1 day',
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(2)
      expect(issues[0]?.message).toContain('overly broad artifact path')
      expect(issues[1]?.message).toContain('overly broad artifact path')
    })
  })

  describe('edge cases', () => {
    it('should handle empty config', () => {
      const config: GitLabCI = {}

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle jobs with null artifacts', () => {
      const config: GitLabCI = {
        'test:job': {
          script: ['echo test'],
          artifacts: null as any,
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle artifacts with undefined paths', () => {
      const config: GitLabCI = {
        'test:job': {
          script: ['echo test'],
          artifacts: {
            paths: undefined as any,
            expire_in: '1 day',
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle expire_in with extra whitespace', () => {
      const config: GitLabCI = {
        'test:job': {
          script: ['echo test'],
          artifacts: {
            paths: ['dist/'],
            expire_in: '  1 day  ',
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle case insensitive time units', () => {
      const config: GitLabCI = {
        job1: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '1 DAY' },
        },
        job2: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '2 Hours' },
        },
        job3: {
          script: ['echo test'],
          artifacts: { paths: ['dist/'], expire_in: '30 MINS' },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkArtifactPaths(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })
})
