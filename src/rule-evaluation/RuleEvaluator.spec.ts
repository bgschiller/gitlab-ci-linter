import { describe, expect, it } from 'vitest'
import { RuleEvaluator } from './RuleEvaluator'
import { evaluateRule } from './modernRuleEvaluator'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig'
import type { EvaluationContext } from './types'
import type { GitLabCI, GitLabJob, GitLabRule } from '../types'

const mockContext = (filePath = '/path/to/file.yml'): ProcessingContext => ({
  filePath,
  baseDir: '/path/to',
  includedFiles: new Set<string>(),
  includeStack: [],
  remoteJobs: new Set<string>(),
  gitlabHost: 'gitlab.example.com',
})

describe('RuleEvaluator', () => {
  describe('evaluateRule', () => {
    it('should match rule with true if condition', () => {
      const rule: GitLabRule = {
        if: '$CI_COMMIT_BRANCH == "main"',
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should not match rule with false if condition', () => {
      const rule: GitLabRule = {
        if: '$CI_COMMIT_BRANCH == "main"',
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'develop' },
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(false)
      expect(result.conditionDescription).toContain('CI_COMMIT_BRANCH')
    })

    it('should handle null comparisons', () => {
      const rule: GitLabRule = {
        if: '$EPH_ENV_ID != null',
      }
      const context: EvaluationContext = {
        variables: { EPH_ENV_ID: 'test-env' },
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should handle null variable with null comparison', () => {
      const rule: GitLabRule = {
        if: '$EPH_ENV_ID == null',
      }
      const context: EvaluationContext = {
        variables: { EPH_ENV_ID: null },
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should match rule without if condition', () => {
      const rule: GitLabRule = {}
      const context: EvaluationContext = {
        variables: {},
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should handle complex AND conditions', () => {
      const rule: GitLabRule = {
        if: '$CI_COMMIT_BRANCH == "main" && $CI_PIPELINE_SOURCE == "push"',
      }
      const context: EvaluationContext = {
        variables: {
          CI_COMMIT_BRANCH: 'main',
          CI_PIPELINE_SOURCE: 'push',
        },
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should handle OR conditions', () => {
      const rule: GitLabRule = {
        if: '$CI_COMMIT_BRANCH == "main" || $CI_COMMIT_BRANCH == "master"',
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'master' },
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })
  })

  describe('evaluateRule with changes', () => {
    it('should match **/* against files directly in directory (no subdirectory)', () => {
      const rule: GitLabRule = {
        changes: ['src/**/*.ts'],
      }
      const context: EvaluationContext = {
        variables: {},
        changes: ['src/app.ts'],
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should match **/* against files in .gitlab-ci/ directly', () => {
      const rule: GitLabRule = {
        changes: ['.gitlab-ci/**/*'],
      }
      const context: EvaluationContext = {
        variables: {},
        changes: ['.gitlab-ci/monorepo-pipeline.yml'],
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should match **/* against files in nested subdirectories', () => {
      const rule: GitLabRule = {
        changes: ['libs/**/*'],
      }
      const context: EvaluationContext = {
        variables: {},
        changes: ['libs/utils/src/index.ts'],
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should match when changes pattern matches', () => {
      const rule: GitLabRule = {
        changes: ['src/**/*.ts'],
      }
      const context: EvaluationContext = {
        variables: {},
        changes: ['src/app.ts', 'src/utils/helper.ts'],
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should not match when changes pattern does not match', () => {
      const rule: GitLabRule = {
        changes: ['src/**/*.ts'],
      }
      const context: EvaluationContext = {
        variables: {},
        changes: ['docs/README.md', 'package.json'],
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(false)
    })

    it('should not match when no changes provided', () => {
      const rule: GitLabRule = {
        changes: ['src/**/*.ts'],
      }
      const context: EvaluationContext = {
        variables: {},
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(false)
    })

    it('should handle multiple change patterns', () => {
      const rule: GitLabRule = {
        changes: ['*.json', '*.yml'],
      }
      const context: EvaluationContext = {
        variables: {},
        changes: ['config.yml'],
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should match when changes uses complex object form with paths', () => {
      const rule: GitLabRule = {
        changes: {
          compare_to: 'refs/heads/main',
          paths: ['src/**/*.ts', 'libs/**/*.ts'],
        },
      }
      const context: EvaluationContext = {
        variables: {},
        changes: ['src/utils/helper.ts', 'docs/README.md'],
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should not match when changes object paths do not match', () => {
      const rule: GitLabRule = {
        changes: {
          compare_to: 'refs/heads/main',
          paths: ['src/**/*.ts'],
        },
      }
      const context: EvaluationContext = {
        variables: {},
        changes: ['docs/README.md', 'package.json'],
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(false)
      expect(result.conditionDescription).toContain('changes')
    })

    it('should not match when changes object paths is empty', () => {
      const rule: GitLabRule = {
        changes: {
          compare_to: 'refs/heads/main',
          paths: [],
        },
      }
      const context: EvaluationContext = {
        variables: {},
        changes: ['src/app.ts'],
      }

      const result = evaluateRule(rule, context)

      // Empty paths array should match (no patterns to check)
      expect(result.matches).toBe(true)
    })

    it('should handle changes object with only compare_to (no paths)', () => {
      const rule: GitLabRule = {
        changes: {
          compare_to: 'refs/heads/main',
        } as any,
      }
      const context: EvaluationContext = {
        variables: {},
        changes: ['src/app.ts'],
      }

      const result = evaluateRule(rule, context)

      // No paths means no patterns to check, should match
      expect(result.matches).toBe(true)
    })
  })

  describe('evaluateRule with exists', () => {
    it('should match when file exists', () => {
      const rule: GitLabRule = {
        exists: ['Dockerfile'],
      }
      const context: EvaluationContext = {
        variables: {},
        exists: ['Dockerfile', 'package.json'],
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })

    it('should not match when file does not exist', () => {
      const rule: GitLabRule = {
        exists: ['Dockerfile'],
      }
      const context: EvaluationContext = {
        variables: {},
        exists: ['package.json', 'README.md'],
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(false)
    })

    it('should assume files exist when no exists list provided', () => {
      const rule: GitLabRule = {
        exists: ['Dockerfile'],
      }
      const context: EvaluationContext = {
        variables: {},
      }

      const result = evaluateRule(rule, context)

      expect(result.matches).toBe(true)
    })
  })

  describe('evaluateJob', () => {
    it('should run job without rules', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        stage: 'test',
      }
      const context: EvaluationContext = {
        variables: {},
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
      expect(result.name).toBe('my-job')
      expect(result.stage).toBe('test')
      expect(result.when).toBe('on_success')
    })

    it('should use default stage when not specified', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
      }
      const context: EvaluationContext = {
        variables: {},
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.stage).toBe('test')
    })

    it('should not run job with when: never and no rules', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        when: 'never',
      }
      const context: EvaluationContext = {
        variables: {},
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
      expect(result.when).toBe('never')
    })

    it('should run job when rule matches', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        stage: 'build',
        rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('build-job', job, context)

      expect(result.willRun).toBe(true)
      expect(result.matchedRule).toEqual({ if: '$CI_COMMIT_BRANCH == "main"' })
    })

    it('should skip job when no rules match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        stage: 'build',
        rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'develop' },
      }

      const result = RuleEvaluator.evaluateJob('build-job', job, context)

      expect(result.willRun).toBe(false)
      expect(result.reason).toBe('No rules matched')
    })

    it('should handle when: never in rule', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        rules: [{ if: '$CI_COMMIT_BRANCH == "main"', when: 'never' }],
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
      expect(result.when).toBe('never')
    })

    it('should use when from rule', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        rules: [{ if: '$CI_COMMIT_BRANCH == "main"', when: 'manual' }],
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
      expect(result.when).toBe('manual')
    })

    it('should match first applicable rule', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        rules: [
          { if: '$CI_COMMIT_BRANCH == "main"', when: 'always' },
          { if: '$CI_COMMIT_BRANCH == "develop"', when: 'manual' },
        ],
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
      expect(result.when).toBe('always')
    })

    it('should use job-level when as default for rules without explicit when', () => {
      // Bug fix: GitLab uses job-level when as the default for rules that don't specify when
      const job: GitLabJob = {
        script: ['echo hello'],
        when: 'manual',
        rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
      expect(result.when).toBe('manual') // Should use job-level when, not default to on_success
    })

    it('should let rule-level when override job-level when', () => {
      // Rule-level when takes precedence over job-level when
      const job: GitLabJob = {
        script: ['echo hello'],
        when: 'manual',
        rules: [{ if: '$CI_COMMIT_BRANCH == "main"', when: 'on_success' }],
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
      expect(result.when).toBe('on_success') // Rule-level when takes precedence
    })

    it('should handle mixed rules with and without explicit when', () => {
      // Some rules specify when, others should fall back to job-level when
      const job: GitLabJob = {
        script: ['echo hello'],
        when: 'manual',
        rules: [
          { if: '$CI_PIPELINE_SOURCE == "schedule"', when: 'on_success' },
          { if: '$CI_COMMIT_BRANCH == "main"' }, // No when, should use job-level
        ],
      }

      // Test schedule pipeline - should use rule's explicit when: on_success
      const scheduleResult = RuleEvaluator.evaluateJob('my-job', job, {
        variables: { CI_PIPELINE_SOURCE: 'schedule', CI_COMMIT_BRANCH: 'develop' },
      })
      expect(scheduleResult.willRun).toBe(true)
      expect(scheduleResult.when).toBe('on_success')

      // Test push to main - should fall back to job-level when: manual
      const pushResult = RuleEvaluator.evaluateJob('my-job', job, {
        variables: { CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'main' },
      })
      expect(pushResult.willRun).toBe(true)
      expect(pushResult.when).toBe('manual')
    })

    it('should default to on_success when neither rule nor job specifies when', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
      expect(result.when).toBe('on_success') // Default when no job-level or rule-level when
    })
  })

  describe('evaluateJob with only/except (object form)', () => {
    it('should skip job when only refs do not match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: { refs: ['main', 'master'] },
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'develop' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
      expect(result.reason).toContain('not in only refs')
    })

    it('should run job when only refs match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: { refs: ['main', 'master'] },
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
    })

    it('should skip job when except refs match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        except: { refs: ['main', 'master'] },
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
      expect(result.reason).toContain('in except')
    })

    it('should skip job when only.variables does not match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: {
          refs: ['merge_requests'],
          variables: ['$CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "chrome"'],
        },
      }
      const context: EvaluationContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'merge_request_event',
          CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'master',
        },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
      expect(result.reason).toContain('only.variables not matched')
    })

    it('should run job when only.variables matches', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: {
          refs: ['merge_requests'],
          variables: ['$CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "chrome"'],
        },
      }
      const context: EvaluationContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'merge_request_event',
          CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'chrome',
        },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
    })

    it('should run job when any only.variables expression matches (OR logic)', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: {
          refs: ['merge_requests'],
          variables: [
            '$CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "chrome"',
            '$CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "edge"',
          ],
        },
      }
      const context: EvaluationContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'merge_request_event',
          CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'edge',
        },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
    })

    it('should skip job when except.variables matches', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        except: {
          variables: ['$CI_COMMIT_BRANCH == "staging"'],
        },
      }
      const context: EvaluationContext = {
        variables: {
          CI_COMMIT_BRANCH: 'staging',
        },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
      expect(result.reason).toContain('except.variables matched')
    })

    it('should run job when except.variables does not match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        except: {
          variables: ['$CI_COMMIT_BRANCH == "staging"'],
        },
      }
      const context: EvaluationContext = {
        variables: {
          CI_COMMIT_BRANCH: 'main',
        },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
    })

    it('should handle only.refs and only.variables together (AND logic)', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: {
          refs: ['merge_requests'],
          variables: ['$CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "chrome"'],
        },
      }
      // refs match but variables don't
      const context: EvaluationContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'merge_request_event',
          CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main',
        },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
    })
  })

  describe('evaluateJob with only/except (array form)', () => {
    it('should skip job when only array refs do not match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: ['chrome', 'production'] as any,
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
      expect(result.reason).toContain('not in only refs')
    })

    it('should run job when only array refs match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: ['main', 'chrome'] as any,
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
    })

    it('should run job when only contains "branches" keyword', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: ['branches'] as any,
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'feature-x' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
    })

    it('should run job when only contains "merge_requests" and pipeline is MR event', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: ['merge_requests'] as any,
      }
      const context: EvaluationContext = {
        variables: {
          CI_COMMIT_BRANCH: 'feature-branch',
          CI_PIPELINE_SOURCE: 'merge_request_event',
        },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
    })

    it('should skip job when only contains "schedules" but pipeline is not scheduled', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: ['schedules'] as any,
      }
      const context: EvaluationContext = {
        variables: {
          CI_COMMIT_BRANCH: 'main',
          CI_PIPELINE_SOURCE: 'push',
        },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
    })

    it('should skip job when except array refs match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        except: ['chrome', 'main'] as any,
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
      expect(result.reason).toContain('in except')
    })

    it('should run job when except array refs do not match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        except: ['chrome', 'production'] as any,
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
    })

    it('should handle regex patterns in only array', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: ['/^feature-.*/'] as any,
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'feature-new-login' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(true)
    })

    it('should skip job when regex patterns in only do not match', () => {
      const job: GitLabJob = {
        script: ['echo hello'],
        only: ['/^feature-.*/'] as any,
      }
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateJob('my-job', job, context)

      expect(result.willRun).toBe(false)
    })
  })

  describe('evaluateAllJobs', () => {
    it('should evaluate all jobs and return summary', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build', 'test'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
          },
          'test-job': {
            script: ['echo test'],
            stage: 'test',
          },
        },
        mockContext(),
      )
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateAllJobs(config, context)

      expect(result.totalJobs).toBe(2)
      expect(result.jobs.length).toBe(2)
      expect(result.skipped.length).toBe(0)
    })

    it('should skip template jobs', () => {
      const config = new ProcessedConfig(
        {
          stages: ['test'],
          '.template': {
            script: ['echo template'],
          },
          'my-job': {
            script: ['echo job'],
            stage: 'test',
          },
        },
        mockContext(),
      )
      const context: EvaluationContext = {
        variables: {},
      }

      const result = RuleEvaluator.evaluateAllJobs(config, context)

      expect(result.totalJobs).toBe(1)
      expect(result.jobs[0]?.name).toBe('my-job')
    })

    it('should sort jobs by stage order', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build', 'test', 'deploy'],
          'deploy-job': {
            script: ['echo deploy'],
            stage: 'deploy',
          },
          'build-job': {
            script: ['echo build'],
            stage: 'build',
          },
          'test-job': {
            script: ['echo test'],
            stage: 'test',
          },
        },
        mockContext(),
      )
      const context: EvaluationContext = {
        variables: {},
      }

      const result = RuleEvaluator.evaluateAllJobs(config, context)

      expect(result.jobs.map(j => j.name)).toEqual(['build-job', 'test-job', 'deploy-job'])
    })

    it('should separate running and skipped jobs', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build', 'test'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
          },
          'test-job': {
            script: ['echo test'],
            stage: 'test',
          },
        },
        mockContext(),
      )
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'develop' },
      }

      const result = RuleEvaluator.evaluateAllJobs(config, context)

      expect(result.jobs.length).toBe(1)
      expect(result.jobs[0]?.name).toBe('test-job')
      expect(result.skipped.length).toBe(1)
      expect(result.skipped[0]?.name).toBe('build-job')
    })
  })

  describe('workflow variable injection', () => {
    it('should inject variables from matching workflow rule', () => {
      const ciConfig: GitLabCI = {
        workflow: {
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              variables: { PIPELINE_TYPE: 'MR' },
            },
            { if: '$CI_PIPELINE_SOURCE == "push"', variables: { PIPELINE_TYPE: 'PUSH' } },
          ],
        },
        'test-job': {
          script: ['echo test'],
          rules: [{ if: '$PIPELINE_TYPE == "MR"' }],
        },
      }
      const config = new ProcessedConfig(ciConfig, mockContext('/test.yml'))

      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'merge_request_event' },
      }
      const result = RuleEvaluator.evaluateAllJobs(config, context)

      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0]?.name).toBe('test-job')
    })

    it('should skip job when workflow variable does not match job rule', () => {
      const ciConfig: GitLabCI = {
        workflow: {
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              variables: { PIPELINE_TYPE: 'MR' },
            },
            { if: '$CI_PIPELINE_SOURCE == "push"', variables: { PIPELINE_TYPE: 'PUSH' } },
          ],
        },
        'test-job': {
          script: ['echo test'],
          rules: [{ if: '$PIPELINE_TYPE == "MR"' }],
        },
      }
      const config = new ProcessedConfig(ciConfig, mockContext('/test.yml'))

      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push' },
      }
      const result = RuleEvaluator.evaluateAllJobs(config, context)

      // PIPELINE_TYPE is "PUSH", but job rule checks for "MR"
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0]?.name).toBe('test-job')
      expect(result.jobs).toHaveLength(0)
    })

    it('should use first matching workflow rule (first wins)', () => {
      const ciConfig: GitLabCI = {
        workflow: {
          rules: [
            { if: '$CI_PIPELINE_SOURCE == "push"', variables: { PIPELINE_TYPE: 'FIRST' } },
            { if: '$CI_COMMIT_BRANCH == "main"', variables: { PIPELINE_TYPE: 'SECOND' } },
          ],
        },
        'test-job': {
          script: ['echo test'],
          rules: [{ if: '$PIPELINE_TYPE == "FIRST"' }],
        },
      }
      const config = new ProcessedConfig(ciConfig, mockContext('/test.yml'))

      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'main' },
      }
      const result = RuleEvaluator.evaluateAllJobs(config, context)

      // Both rules match, but first wins
      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0]?.name).toBe('test-job')
    })

    it('should not inject variables when no workflow rules match', () => {
      const ciConfig: GitLabCI = {
        workflow: {
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              variables: { PIPELINE_TYPE: 'MR' },
            },
          ],
        },
        'test-job': {
          script: ['echo test'],
          rules: [{ if: '$PIPELINE_TYPE == "MR"' }],
        },
      }
      const config = new ProcessedConfig(ciConfig, mockContext('/test.yml'))

      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'schedule' },
      }
      const result = RuleEvaluator.evaluateAllJobs(config, context)

      // No workflow rule matches, so PIPELINE_TYPE is undefined
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0]?.name).toBe('test-job')
    })

    it('should work when workflow has no variables to inject', () => {
      const ciConfig: GitLabCI = {
        workflow: {
          rules: [{ if: '$CI_PIPELINE_SOURCE == "push"' }], // No variables
        },
        'test-job': {
          script: ['echo test'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      }
      const config = new ProcessedConfig(ciConfig, mockContext('/test.yml'))

      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'main' },
      }
      const result = RuleEvaluator.evaluateAllJobs(config, context)

      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0]?.name).toBe('test-job')
    })

    it('should work without workflow configuration', () => {
      const ciConfig: GitLabCI = {
        'test-job': {
          script: ['echo test'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      }
      const config = new ProcessedConfig(ciConfig, mockContext('/test.yml'))

      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }
      const result = RuleEvaluator.evaluateAllJobs(config, context)

      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0]?.name).toBe('test-job')
    })

    it('should not overwrite existing context variables', () => {
      const ciConfig: GitLabCI = {
        workflow: {
          rules: [{ if: '$CI_PIPELINE_SOURCE == "push"', variables: { MY_VAR: 'FROM_WORKFLOW' } }],
        },
        'test-job': {
          script: ['echo test'],
          rules: [{ if: '$MY_VAR == "FROM_CONTEXT"' }],
        },
      }
      const config = new ProcessedConfig(ciConfig, mockContext('/test.yml'))

      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push', MY_VAR: 'FROM_CONTEXT' },
      }
      const result = RuleEvaluator.evaluateAllJobs(config, context)

      // Workflow variables should overwrite context variables (same as GitLab behavior)
      // The job rule checks MY_VAR == "FROM_CONTEXT", but workflow sets it to "FROM_WORKFLOW"
      expect(result.skipped).toHaveLength(1)
    })

    it('should expand variable references in workflow rule variables', () => {
      // This test verifies the fix for the bug where `PIPELINE_TYPE: $CI_PIPELINE_SOURCE`
      // was not being resolved to the actual value of CI_PIPELINE_SOURCE
      const ciConfig: GitLabCI = {
        workflow: {
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "push"',
              variables: { PIPELINE_TYPE: '$CI_PIPELINE_SOURCE' },
            },
          ],
        },
        'test-job': {
          script: ['echo test'],
          rules: [{ if: '$PIPELINE_TYPE == "push"' }],
        },
      }
      const config = new ProcessedConfig(ciConfig, mockContext('/test.yml'))

      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push' },
      }
      const result = RuleEvaluator.evaluateAllJobs(config, context)

      // PIPELINE_TYPE should be expanded to "push" from $CI_PIPELINE_SOURCE
      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0]?.name).toBe('test-job')
    })

    it('should handle complex variable interpolation in workflow rules', () => {
      const ciConfig: GitLabCI = {
        workflow: {
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              variables: {
                DEPLOY_ENV: '$CI_MERGE_REQUEST_TARGET_BRANCH_NAME',
                COMBINED_VAR: '$CI_PIPELINE_SOURCE-$CI_MERGE_REQUEST_TARGET_BRANCH_NAME',
              },
            },
          ],
        },
        'deploy-job': {
          script: ['echo deploy'],
          rules: [{ if: '$DEPLOY_ENV == "main"' }],
        },
      }
      const config = new ProcessedConfig(ciConfig, mockContext('/test.yml'))

      const context: EvaluationContext = {
        variables: {
          CI_PIPELINE_SOURCE: 'merge_request_event',
          CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main',
        },
      }
      const result = RuleEvaluator.evaluateAllJobs(config, context)

      // DEPLOY_ENV should be expanded to "main"
      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0]?.name).toBe('deploy-job')
    })
  })

  describe('evaluateWorkflowVariables', () => {
    it('should return empty object when no workflow', () => {
      const config = new ProcessedConfig({}, mockContext('/test.yml'))
      const context: EvaluationContext = { variables: {} }

      const result = RuleEvaluator.evaluateWorkflowVariables(config, context)

      expect(result).toEqual({})
    })

    it('should return empty object when workflow has no rules', () => {
      const config = new ProcessedConfig({ workflow: {} }, mockContext('/test.yml'))
      const context: EvaluationContext = { variables: {} }

      const result = RuleEvaluator.evaluateWorkflowVariables(config, context)

      expect(result).toEqual({})
    })

    it('should return variables from first matching rule', () => {
      const config = new ProcessedConfig(
        {
          workflow: {
            rules: [
              { if: '$CI_PIPELINE_SOURCE == "merge_request_event"', variables: { TYPE: 'MR' } },
            ],
          },
        },
        mockContext('/test.yml'),
      )
      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'merge_request_event' },
      }

      const result = RuleEvaluator.evaluateWorkflowVariables(config, context)

      expect(result).toEqual({ TYPE: 'MR' })
    })

    it('should return empty object when rule matches but has no variables', () => {
      const config = new ProcessedConfig(
        {
          workflow: {
            rules: [{ if: '$CI_PIPELINE_SOURCE == "push"' }],
          },
        },
        mockContext('/test.yml'),
      )
      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push' },
      }

      const result = RuleEvaluator.evaluateWorkflowVariables(config, context)

      expect(result).toEqual({})
    })

    it('should expand variable references in workflow rule variables', () => {
      const config = new ProcessedConfig(
        {
          workflow: {
            rules: [
              {
                if: '$CI_PIPELINE_SOURCE == "push"',
                variables: { PIPELINE_TYPE: '$CI_PIPELINE_SOURCE' },
              },
            ],
          },
        },
        mockContext('/test.yml'),
      )
      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push' },
      }

      const result = RuleEvaluator.evaluateWorkflowVariables(config, context)

      expect(result).toEqual({ PIPELINE_TYPE: 'push' })
    })

    it('should expand ${VAR} syntax in workflow rule variables', () => {
      const config = new ProcessedConfig(
        {
          workflow: {
            rules: [
              {
                if: '$CI_COMMIT_BRANCH == "main"',
                variables: { BRANCH_INFO: 'branch-${CI_COMMIT_BRANCH}' },
              },
            ],
          },
        },
        mockContext('/test.yml'),
      )
      const context: EvaluationContext = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateWorkflowVariables(config, context)

      expect(result).toEqual({ BRANCH_INFO: 'branch-main' })
    })

    it('should expand multiple variable references in workflow rule variables', () => {
      const config = new ProcessedConfig(
        {
          workflow: {
            rules: [
              {
                if: '$CI_PIPELINE_SOURCE == "push"',
                variables: {
                  COMBINED: '$CI_PIPELINE_SOURCE-$CI_COMMIT_BRANCH',
                  SOURCE: '$CI_PIPELINE_SOURCE',
                  BRANCH: '$CI_COMMIT_BRANCH',
                },
              },
            ],
          },
        },
        mockContext('/test.yml'),
      )
      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateWorkflowVariables(config, context)

      expect(result).toEqual({
        COMBINED: 'push-main',
        SOURCE: 'push',
        BRANCH: 'main',
      })
    })

    it('should keep undefined variable references as-is', () => {
      const config = new ProcessedConfig(
        {
          workflow: {
            rules: [
              {
                if: '$CI_PIPELINE_SOURCE == "push"',
                variables: { UNDEFINED_REF: '$UNDEFINED_VAR' },
              },
            ],
          },
        },
        mockContext('/test.yml'),
      )
      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push' },
      }

      const result = RuleEvaluator.evaluateWorkflowVariables(config, context)

      expect(result).toEqual({ UNDEFINED_REF: '$UNDEFINED_VAR' })
    })

    it('should coerce non-string rule variable values without crashing', () => {
      // Regression: YAML may parse rule variable values as numbers or
      // booleans (e.g. `KUBERNETES_CPU_REQUEST: 4`). Calling .replace on a
      // number used to throw "value.replace is not a function". The expander
      // now coerces non-strings to their string form so the result honors
      // the declared `Record<string, string>` return type. GitLab rule
      // conditions compare via string equality, so `4` and `"4"` are
      // observationally equivalent.
      const config = new ProcessedConfig(
        {
          workflow: {
            rules: [
              {
                if: '$CI_PIPELINE_SOURCE == "push"',
                variables: {
                  // Cast through unknown to bypass TS type narrowing — the
                  // raw YAML parser does produce these shapes in practice.
                  KUBERNETES_CPU_REQUEST: 4 as unknown as string,
                  ENABLED: true as unknown as string,
                  STRING_VAR: 'hello-$CI_COMMIT_BRANCH',
                },
              },
            ],
          },
        },
        mockContext('/test.yml'),
      )
      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'main' },
      }

      const result = RuleEvaluator.evaluateWorkflowVariables(config, context)

      expect(result.KUBERNETES_CPU_REQUEST).toBe('4')
      expect(result.ENABLED).toBe('true')
      expect(result.STRING_VAR).toBe('hello-main')
    })

    it('should expand null variables to empty string', () => {
      const config = new ProcessedConfig(
        {
          workflow: {
            rules: [
              {
                if: '$CI_PIPELINE_SOURCE == "push"',
                variables: { NULL_REF: 'prefix-$NULL_VAR-suffix' },
              },
            ],
          },
        },
        mockContext('/test.yml'),
      )
      const context: EvaluationContext = {
        variables: { CI_PIPELINE_SOURCE: 'push', NULL_VAR: null },
      }

      const result = RuleEvaluator.evaluateWorkflowVariables(config, context)

      expect(result).toEqual({ NULL_REF: 'prefix--suffix' })
    })
  })
})
