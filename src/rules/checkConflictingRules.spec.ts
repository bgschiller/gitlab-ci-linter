import { assert, describe, expect, it } from 'vitest'
import { checkConflictingRules } from './checkConflictingRules'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig'
import { type GitLabCI } from '../types'

describe('checkConflictingRules', () => {
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

  describe('contradictory conditions', () => {
    it('should detect contradictory branch conditions in single rule', () => {
      const config: GitLabCI = {
        'contradictory:job': {
          script: ['echo "contradiction"'],
          rules: [
            {
              if: '$CI_COMMIT_REF_NAME == "main" && $CI_COMMIT_REF_NAME != "main"',
              when: 'on_success',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message: "Job 'contradictory:job' has contradictory conditions in a single rule",
        location: 'contradictory:job',
      })
    })

    it('should not flag non-contradictory conditions', () => {
      const config: GitLabCI = {
        'normal:job': {
          script: ['echo "normal"'],
          rules: [
            {
              if: '$CI_COMMIT_REF_NAME == "main"',
              when: 'on_success',
            },
            {
              if: '$CI_COMMIT_REF_NAME != "main"',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })

  describe('restrictive rule patterns', () => {
    it('should warn about very specific change patterns', () => {
      const config: GitLabCI = {
        'specific:job': {
          script: ['echo "very specific"'],
          rules: [
            {
              changes: ['src/components/ui/buttons/primary/styles.css'],
              when: 'on_success',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'info',
        message: "Job 'specific:job' has very specific change patterns - it may rarely run",
        location: 'specific:job',
      })
    })

    it('should not warn about moderately specific change patterns', () => {
      const config: GitLabCI = {
        'moderate:job': {
          script: ['echo "moderate"'],
          rules: [
            {
              changes: ['src/components/*.js'],
              when: 'on_success',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not warn about multiple change patterns', () => {
      const config: GitLabCI = {
        'multiple:job': {
          script: ['echo "multiple patterns"'],
          rules: [
            {
              changes: [
                'src/components/ui/buttons/primary/styles.css',
                'src/components/ui/buttons/secondary/styles.css',
              ],
              when: 'on_success',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })

  describe('problematic exists patterns', () => {
    it('should warn about parent directory references', () => {
      const config: GitLabCI = {
        'parent:job': {
          script: ['echo "parent ref"'],
          rules: [
            {
              exists: ['../config/settings.yml'],
              when: 'on_success',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message:
          "Job 'parent:job' has potentially problematic exists patterns: ../config/settings.yml",
        location: 'parent:job',
      })
    })

    it('should warn about absolute paths', () => {
      const config: GitLabCI = {
        'absolute:job': {
          script: ['echo "absolute path"'],
          rules: [
            {
              exists: ['/etc/config.yml'],
              when: 'on_success',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message: "Job 'absolute:job' has potentially problematic exists patterns: /etc/config.yml",
        location: 'absolute:job',
      })
    })

    it('should warn about complex wildcard patterns', () => {
      const config: GitLabCI = {
        'wildcard:job': {
          script: ['echo "complex wildcard"'],
          rules: [
            {
              exists: ['src/**/**/config.yml'],
              when: 'on_success',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message:
          "Job 'wildcard:job' has potentially problematic exists patterns: src/**/**/config.yml",
        location: 'wildcard:job',
      })
    })

    it('should warn about multiple problematic exists patterns', () => {
      const config: GitLabCI = {
        'multiple:problems': {
          script: ['echo "multiple problems"'],
          rules: [
            {
              exists: ['../config.yml', '/etc/settings.yml'],
              when: 'on_success',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      expect(issue.message).toContain(
        'has potentially problematic exists patterns: ../config.yml, /etc/settings.yml',
      )
    })

    it('should not warn about normal exists patterns', () => {
      const config: GitLabCI = {
        'normal:exists': {
          script: ['echo "normal exists"'],
          rules: [
            {
              exists: ['config.yml', 'src/config/*.yml'],
              when: 'on_success',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })

  describe('mixed scenarios', () => {
    it('should handle multiple rule types and issues', () => {
      const config: GitLabCI = {
        'complex:job': {
          script: ['echo "complex"'],
          rules: [
            {
              if: '$CI_COMMIT_REF_NAME == "main" && $CI_COMMIT_REF_NAME != "main"',
              when: 'never',
            },
            {
              exists: ['../parent.yml'],
              when: 'never',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(2)

      // Contradictory conditions error
      expect(issues.some(issue => issue.message.includes('has contradictory conditions'))).toBe(
        true,
      )

      // Problematic exists warning
      expect(
        issues.some(issue => issue.message.includes('has potentially problematic exists patterns')),
      ).toBe(true)
    })

    it('should handle jobs without rules', () => {
      const config: GitLabCI = {
        'no:rules': {
          script: ['echo "no rules"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle jobs with empty rules array', () => {
      const config: GitLabCI = {
        'empty:rules': {
          script: ['echo "empty rules"'],
          rules: [],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle complex real-world scenario', () => {
      const config: GitLabCI = {
        'deploy:production': {
          script: ['kubectl apply -f production.yml'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
              when: 'manual',
            },
          ],
        },
        'deploy:never': {
          script: ['echo "never runs"'],
          rules: [{ when: 'never' }],
        },
        '.template:base': {
          script: ['echo "template"'],
          rules: [{ when: 'never' }],
        },
        'test:specific': {
          script: ['npm test'],
          rules: [
            {
              changes: ['src/components/ui/forms/validation/email.js'],
              exists: ['../external-config.yml'],
              when: 'on_success',
            },
          ],
        },
        'remote:job': {
          script: ['echo "remote"'],
          rules: [{ when: 'never' }],
        },
      }

      const processedConfig = createProcessedConfig(config, {
        remoteJobs: new Set(['remote:job']),
      })
      const issues = checkConflictingRules(processedConfig)

      // Should find issues for 'test:specific' only (two issues: specific changes + problematic exists)
      // Template and remote jobs should be skipped
      // Production deploy is fine (normal manual rule)
      // deploy:never no longer triggers warnings (unconditional never rule removed)
      expect(issues).toHaveLength(2)

      const locations = issues.map(issue => issue.location)
      expect(locations).toContain('test:specific') // appears twice: specific changes + problematic exists
      expect(locations).not.toContain('deploy:never')
      expect(locations).not.toContain('.template:base')
      expect(locations).not.toContain('remote:job')
      expect(locations).not.toContain('deploy:production')
    })
  })

  describe('job-level when with rules', () => {
    it('should warn when job-level when is used as default for rules without when', () => {
      const config: GitLabCI = {
        'manual:job': {
          script: ['echo "manual"'],
          when: 'manual',
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'info',
        message:
          "Job 'manual:job' has 'when: manual' at job level with 1/1 rule(s) that don't specify 'when:'. " +
          "These rules will use 'manual' as default instead of 'on_success'.",
        location: 'manual:job',
      })
    })

    it('should not warn when job-level when is on_success (the default)', () => {
      const config: GitLabCI = {
        'default:job': {
          script: ['echo "default"'],
          when: 'on_success',
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not warn when all rules specify their own when', () => {
      const config: GitLabCI = {
        'explicit:job': {
          script: ['echo "explicit"'],
          when: 'manual',
          rules: [
            { if: '$CI_COMMIT_BRANCH == "main"', when: 'on_success' },
            { if: '$CI_COMMIT_BRANCH == "develop"', when: 'manual' },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should warn with correct count for mixed rules', () => {
      const config: GitLabCI = {
        'mixed:job': {
          script: ['echo "mixed"'],
          when: 'manual',
          rules: [
            { if: '$CI_PIPELINE_SOURCE == "schedule"', when: 'on_success' },
            { if: '$CI_COMMIT_BRANCH == "main"' }, // No when
            { if: '$CI_COMMIT_BRANCH == "develop"' }, // No when
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain("2/3 rule(s) that don't specify 'when:'")
    })

    it('should not warn when job has no job-level when', () => {
      const config: GitLabCI = {
        'no:when': {
          script: ['echo "no when"'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should warn for when: always at job level', () => {
      const config: GitLabCI = {
        'always:job': {
          script: ['echo "always"'],
          when: 'always',
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain("'when: always' at job level")
    })

    it('should warn for when: delayed at job level', () => {
      const config: GitLabCI = {
        'delayed:job': {
          script: ['echo "delayed"'],
          when: 'delayed',
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkConflictingRules(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain("'when: delayed' at job level")
    })
  })
})
