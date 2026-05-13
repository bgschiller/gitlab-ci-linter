import { describe, expect, it } from 'vitest'
import { checkUnknownKeys } from './checkUnknownKeys'
import { ProcessedConfig } from '../ProcessedConfig'
import type { ProcessingContext } from '../ProcessedConfig'

const dummyContext: ProcessingContext = {
  filePath: 'test.yml',
  baseDir: '.',
  includedFiles: new Set(),
  includeStack: [],
  remoteJobs: new Set(),
  gitlabHost: 'gitlab.example.com',
}

describe('checkUnknownKeys', () => {
  describe('job-level keys', () => {
    it('should not warn for known job keys', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            stage: 'build',
            variables: { FOO: 'bar' },
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
            artifacts: { paths: ['dist/'] },
            needs: ['other-job'],
            when: 'on_success',
            allow_failure: false,
            tags: ['docker'],
            timeout: '1h',
            retry: 2,
            interruptible: true,
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown job keys', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            unknown_key: 'value',
            another_typo: true,
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(2)
      expect(issues[0]!.severity).toBe('warning')
      expect(issues[0]!.message).toContain("Unknown key 'unknown_key'")
      expect(issues[0]!.location).toBe('build-job')
      expect(issues[1]!.message).toContain("Unknown key 'another_typo'")
    })

    it('should detect typos in common keys', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            scrpt: ['typo'], // typo of 'script'
            staeg: 'build', // typo of 'stage'
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(2)
      expect(issues.some(i => i.message.includes("'scrpt'"))).toBe(true)
      expect(issues.some(i => i.message.includes("'staeg'"))).toBe(true)
    })
  })

  describe('rules array keys', () => {
    it('should not warn for known rules keys', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            rules: [
              {
                if: '$CI_COMMIT_BRANCH == "main"',
                when: 'manual',
                allow_failure: true,
                variables: { FOO: 'bar' },
              },
              {
                changes: ['src/**/*'],
                exists: ['Dockerfile'],
              },
            ],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in rules', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            rules: [
              {
                if: '$CI_COMMIT_BRANCH == "main"',
                unknownRule: true,
              },
            ],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknownRule'")
      expect(issues[0]!.location).toBe('build-job.rules[0]')
    })
  })

  describe('only/except keys', () => {
    it('should not warn for known only/except keys', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            only: {
              refs: ['main', 'develop'],
              variables: ['$CI_COMMIT_BRANCH == "main"'],
              changes: ['src/**/*'],
              kubernetes: 'active',
            },
            except: {
              refs: ['staging'],
              variables: ['$SKIP_BUILD == "true"'],
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in only section', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            only: {
              refs: ['main'],
              branches: ['develop'], // not a valid key
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'branches'")
      expect(issues[0]!.location).toBe('build-job.only')
    })

    it('should warn for unknown keys in except section', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            except: {
              refs: ['main'],
              tags: true, // not a valid key in except
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'tags'")
      expect(issues[0]!.location).toBe('build-job.except')
    })
  })

  describe('artifacts keys', () => {
    it('should not warn for known artifacts keys', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            artifacts: {
              paths: ['dist/'],
              expire_in: '1 week',
              when: 'on_success',
              name: 'build-artifacts',
              reports: { junit: 'report.xml' },
              untracked: false,
              exclude: ['*.tmp'],
              expose_as: 'Build Output',
              public: true,
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in artifacts', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            artifacts: {
              paths: ['dist/'],
              unknown_artifact_key: true,
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknown_artifact_key'")
      expect(issues[0]!.location).toBe('build-job.artifacts')
    })
  })

  describe('needs keys', () => {
    it('should not warn for known needs object keys', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            needs: [
              { job: 'other-job', artifacts: true, optional: false },
              {
                job: 'cross-project',
                project: 'group/project',
                ref: 'main',
                pipeline: '$CI_PIPELINE_ID',
              },
            ],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in needs objects', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            needs: [{ job: 'other-job', unknown_need_key: true }],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknown_need_key'")
      expect(issues[0]!.location).toBe('build-job.needs[0]')
    })
  })

  describe('cache keys', () => {
    it('should not warn for known cache keys', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            cache: {
              key: { files: ['package-lock.json'], prefix: 'npm' },
              paths: ['node_modules/'],
              untracked: false,
              when: 'on_success',
              policy: 'pull-push',
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in cache', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            cache: {
              paths: ['node_modules/'],
              unknown_cache_key: true,
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknown_cache_key'")
      expect(issues[0]!.location).toBe('build-job.cache')
    })

    it('should handle array of cache objects', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            cache: [
              { key: 'cache1', paths: ['dist/'] },
              { key: 'cache2', paths: ['build/'], invalid_key: true },
            ],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'invalid_key'")
      expect(issues[0]!.location).toBe('build-job.cache[1]')
    })
  })

  describe('retry keys', () => {
    it('should not warn for known retry keys', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            retry: {
              max: 2,
              when: ['runner_system_failure', 'stuck_or_timeout_failure'],
              exit_codes: [137],
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in retry', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            retry: {
              max: 2,
              unknown_retry_key: true,
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknown_retry_key'")
      expect(issues[0]!.location).toBe('build-job.retry')
    })
  })

  describe('default section', () => {
    it('should not warn for known default keys', () => {
      const config = new ProcessedConfig(
        {
          default: {
            image: 'node:18',
            before_script: ['npm ci'],
            after_script: ['npm run cleanup'],
            tags: ['docker'],
            cache: { paths: ['node_modules/'] },
            artifacts: { paths: ['dist/'] },
            retry: { max: 2 },
            timeout: '1h',
            interruptible: true,
          },
          'build-job': {
            script: ['echo hello'],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in default section', () => {
      const config = new ProcessedConfig(
        {
          default: {
            image: 'node:18',
            unknown_default_key: true,
          },
          'build-job': {
            script: ['echo hello'],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknown_default_key'")
      expect(issues[0]!.location).toBe('default')
    })
  })

  describe('workflow section', () => {
    it('should not warn for known workflow keys', () => {
      const config = new ProcessedConfig(
        {
          workflow: {
            name: 'My Pipeline',
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
          } as any,
          'build-job': {
            script: ['echo hello'],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in workflow section', () => {
      const config = new ProcessedConfig(
        {
          workflow: {
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
            unknown_workflow_key: true,
          } as any,
          'build-job': {
            script: ['echo hello'],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknown_workflow_key'")
      expect(issues[0]!.location).toBe('workflow')
    })

    it('should warn for unknown keys in workflow.rules', () => {
      const config = new ProcessedConfig(
        {
          workflow: {
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"', unknown_rule_key: true } as any],
          },
          'build-job': {
            script: ['echo hello'],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknown_rule_key'")
      expect(issues[0]!.location).toBe('workflow.rules[0]')
    })
  })

  describe('template jobs', () => {
    it('should not check template jobs (starting with dot)', () => {
      const config = new ProcessedConfig(
        {
          '.template': {
            unknown_key: true, // Should not warn - it's a template
          },
          'build-job': {
            extends: '.template',
            script: ['echo hello'],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      // Only the build-job's extends would trigger the check on the resolved job
      // Template jobs themselves are not directly checked
      expect(issues).toHaveLength(0)
    })
  })

  describe('environment keys', () => {
    it('should not warn for known environment keys', () => {
      const config = new ProcessedConfig(
        {
          'deploy-job': {
            script: ['echo deploy'],
            environment: {
              name: 'production',
              url: 'https://example.com',
              on_stop: 'stop-job',
              action: 'start',
              auto_stop_in: '1 week',
              deployment_tier: 'production',
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in environment', () => {
      const config = new ProcessedConfig(
        {
          'deploy-job': {
            script: ['echo deploy'],
            environment: {
              name: 'production',
              unknown_env_key: true,
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknown_env_key'")
      expect(issues[0]!.location).toBe('deploy-job.environment')
    })
  })

  describe('trigger keys', () => {
    it('should not warn for known trigger keys', () => {
      const config = new ProcessedConfig(
        {
          'trigger-job': {
            trigger: {
              project: 'group/project',
              branch: 'main',
              strategy: 'depend',
              forward: { pipeline_variables: true },
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in trigger', () => {
      const config = new ProcessedConfig(
        {
          'trigger-job': {
            trigger: {
              project: 'group/project',
              unknown_trigger_key: true,
            },
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknown_trigger_key'")
      expect(issues[0]!.location).toBe('trigger-job.trigger')
    })
  })

  describe('changes complex form', () => {
    it('should not warn for known changes object keys', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            rules: [
              {
                changes: {
                  paths: ['src/**/*'],
                  compare_to: 'refs/heads/main',
                },
              },
            ],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(0)
    })

    it('should warn for unknown keys in changes object', () => {
      const config = new ProcessedConfig(
        {
          'build-job': {
            script: ['echo hello'],
            rules: [
              {
                changes: {
                  paths: ['src/**/*'],
                  unknown_changes_key: true,
                },
              },
            ],
          },
        },
        dummyContext,
      )

      const issues = checkUnknownKeys(config)

      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toContain("Unknown key 'unknown_changes_key'")
      expect(issues[0]!.location).toBe('build-job.rules[0].changes')
    })
  })
})
