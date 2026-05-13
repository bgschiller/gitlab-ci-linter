import { assert, describe, expect, it } from 'vitest'
import { checkManualJobs } from './checkManualJobs'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig'
import type { GitLabCI } from '../types'

describe('checkManualJobs', () => {
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

  describe('manual jobs with when: manual', () => {
    it('should NOT warn about manual job with top-level when: manual (implicit allow_failure)', () => {
      const config: GitLabCI = {
        'deploy:manual': {
          script: ['echo "deploying"'],
          when: 'manual',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      // GitLab implicitly sets allow_failure: true when when: manual is at job level
      expect(issues).toHaveLength(0)
    })

    it('should not warn about manual job with allow_failure: true', () => {
      const config: GitLabCI = {
        'deploy:manual': {
          script: ['echo "deploying"'],
          when: 'manual',
          allow_failure: true,
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should NOT warn about multiple manual jobs with top-level when: manual', () => {
      const config: GitLabCI = {
        'deploy:staging': {
          script: ['echo "staging"'],
          when: 'manual',
        },
        'deploy:production': {
          script: ['echo "production"'],
          when: 'manual',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      // Both jobs have top-level when: manual which implicitly sets allow_failure: true
      expect(issues).toHaveLength(0)
    })

    it('should NOT warn about job with top-level when: manual and rules with when: manual (issue scenario)', () => {
      // This reproduces the scenario from allow_failure_issue.md
      const config: GitLabCI = {
        'qa:tf apply': {
          script: ['terraform apply -input=false "plan.tfplan"'],
          when: 'manual',
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "schedule"',
              when: 'never',
            },
            {
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      // Should not warn because top-level when: manual implicitly sets allow_failure: true
      expect(issues).toHaveLength(0)
    })

    it('should warn about job with top-level when: manual but explicit allow_failure: false', () => {
      const config: GitLabCI = {
        'deploy:manual-explicit-false': {
          script: ['echo "deploying"'],
          when: 'manual',
          allow_failure: false,
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      // Should warn because explicit allow_failure: false overrides the implicit allow_failure: true
      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message:
          "Job 'deploy:manual-explicit-false' is manual with explicit allow_failure: false, which may stall the pipeline",
        location: 'deploy:manual-explicit-false',
      })
    })
  })

  describe('manual rules', () => {
    it('should warn about rule with when: manual without allow_failure', () => {
      const config: GitLabCI = {
        'deploy:conditional': {
          script: ['echo "deploying"'],
          rules: [
            {
              if: '$DEPLOY_ENABLED == "true"',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message:
          'Job \'deploy:conditional\' has manual rule without allow_failure: true, which may stall the pipeline when if: $DEPLOY_ENABLED == "true"',
        location: 'deploy:conditional',
      })
    })

    it('should not warn about rule with when: manual and allow_failure on rule', () => {
      const config: GitLabCI = {
        'deploy:conditional': {
          script: ['echo "deploying"'],
          rules: [
            {
              if: '$DEPLOY_ENABLED == "true"',
              when: 'manual',
              allow_failure: true,
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not warn about rule with when: manual and allow_failure on job level', () => {
      const config: GitLabCI = {
        'deploy:conditional': {
          script: ['echo "deploying"'],
          allow_failure: true,
          rules: [
            {
              if: '$DEPLOY_ENABLED == "true"',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle multiple rules with different when values', () => {
      const config: GitLabCI = {
        'deploy:complex': {
          script: ['echo "deploying"'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == "main"',
              when: 'on_success',
            },
            {
              if: '$MANUAL_DEPLOY == "true"',
              when: 'manual',
            },
            {
              if: '$NEVER_DEPLOY == "true"',
              when: 'never',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      const issue = issues[0]
      assert(issue)

      expect(issue.message).toContain('has manual rule without allow_failure')
    })
  })

  describe('main branch only rules', () => {
    it('should not warn about main branch only manual rule with $CI_COMMIT_BRANCH', () => {
      const config: GitLabCI = {
        'deploy:production': {
          script: ['echo "deploying to production"'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not warn about main branch only manual rule with $CI_COMMIT_REF_NAME', () => {
      const config: GitLabCI = {
        'deploy:production': {
          script: ['echo "deploying to production"'],
          rules: [
            {
              if: '$CI_COMMIT_REF_NAME == $CI_DEFAULT_BRANCH',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not warn about main branch only manual rule with quotes', () => {
      const config: GitLabCI = {
        'deploy:production': {
          script: ['echo "deploying to production"'],
          rules: [
            {
              if: '"$CI_COMMIT_BRANCH" == "$CI_DEFAULT_BRANCH"',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not warn about main branch only manual rule with single quotes', () => {
      const config: GitLabCI = {
        'deploy:production': {
          script: ['echo "deploying to production"'],
          rules: [
            {
              if: "'$CI_COMMIT_BRANCH' == '$CI_DEFAULT_BRANCH'",
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not warn about main branch only manual rule with extra spacing', () => {
      const config: GitLabCI = {
        'deploy:production': {
          script: ['echo "deploying to production"'],
          rules: [
            {
              if: '  $CI_COMMIT_BRANCH   ==   $CI_DEFAULT_BRANCH  ',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should warn about manual rule with different branch condition', () => {
      const config: GitLabCI = {
        'deploy:feature': {
          script: ['echo "deploying feature"'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == "feature-branch"',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      const issue = issues[0]
      assert(issue)

      expect(issue.message).toContain('has manual rule without allow_failure')
    })

    it('should warn about manual rule without if condition', () => {
      const config: GitLabCI = {
        'deploy:always': {
          script: ['echo "deploying"'],
          rules: [
            {
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      const issue = issues[0]
      assert(issue)

      expect(issue.message).toContain('has manual rule without allow_failure')
    })

    it('should warn about manual rule with non-string if condition', () => {
      const config: GitLabCI = {
        'deploy:complex': {
          script: ['echo "deploying"'],
          rules: [
            {
              if: null as any,
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      const issue = issues[0]
      assert(issue)

      expect(issue.message).toContain('has manual rule without allow_failure')
    })
  })

  describe('mixed scenarios', () => {
    it('should NOT warn about job with both when: manual and manual rule', () => {
      const config: GitLabCI = {
        'deploy:mixed': {
          script: ['echo "deploying"'],
          when: 'manual',
          rules: [
            {
              if: '$DEPLOY_ENABLED == "true"',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      // Top-level when: manual implicitly sets allow_failure: true which covers the rule too
      expect(issues).toHaveLength(0)
    })

    it('should still warn about manual rules when job does NOT have top-level when: manual', () => {
      const config: GitLabCI = {
        'deploy:conditional': {
          script: ['echo "deploying"'],
          rules: [
            {
              if: '$DEPLOY_ENABLED == "true"',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      const issue = issues[0]
      assert(issue)

      expect(issue.message).toContain('has manual rule without allow_failure')
    })

    it('should not warn when job-level allow_failure covers both job and rule', () => {
      const config: GitLabCI = {
        'deploy:mixed': {
          script: ['echo "deploying"'],
          when: 'manual',
          allow_failure: true,
          rules: [
            {
              if: '$DEPLOY_ENABLED == "true"',
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle jobs without rules or when properties', () => {
      const config: GitLabCI = {
        'build:app': {
          script: ['npm run build'],
        },
        'test:unit': {
          script: ['npm test'],
          when: 'on_success',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle empty rules array', () => {
      const config: GitLabCI = {
        'deploy:empty': {
          script: ['echo "deploying"'],
          rules: [],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle complex real-world scenario', () => {
      const config: GitLabCI = {
        'deploy:staging': {
          script: ['kubectl apply -f staging.yml'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == "develop"',
              when: 'manual',
            },
          ],
        },
        'deploy:production': {
          script: ['kubectl apply -f production.yml'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
              when: 'manual',
            },
          ],
        },
        'deploy:hotfix': {
          script: ['kubectl apply -f hotfix.yml'],
          when: 'manual',
          allow_failure: true,
        },
        'deploy:feature': {
          script: ['kubectl apply -f feature.yml'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH =~ /^feature\\/.*/',
              when: 'manual',
              allow_failure: true,
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)
      const issue = issues[0]
      assert(issue)

      expect(issue.location).toBe('deploy:staging')
      expect(issue.message).toContain('has manual rule without allow_failure')
    })
  })

  describe('condition extraction', () => {
    it('should include changes conditions in warning message', () => {
      const config: GitLabCI = {
        'deploy:app': {
          script: ['echo "deploying app"'],
          rules: [
            {
              changes: ['apps/myapp/**/*', 'libs/shared/**/*'],
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message:
          "Job 'deploy:app' has manual rule without allow_failure: true, which may stall the pipeline when changes: apps/myapp/**/*, libs/shared/**/*",
        location: 'deploy:app',
      })
    })

    it('should combine multiple condition types in warning message', () => {
      const config: GitLabCI = {
        'deploy:conditional': {
          script: ['echo "deploying"'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH != $CI_DEFAULT_BRANCH',
              changes: ['apps/myapp/**/*'],
              when: 'manual',
            },
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkManualJobs(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain(
        'when if: $CI_COMMIT_BRANCH != $CI_DEFAULT_BRANCH and changes: apps/myapp/**/*',
      )
    })
  })
})
