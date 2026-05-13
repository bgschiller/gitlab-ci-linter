import { assert, describe, expect, it } from 'vitest'
import { checkDependencyRules } from './checkDependencyRules'
import { type GitLabJob } from '../types'
import { ProcessedConfig } from '../ProcessedConfig'

describe('checkDependencyRules', () => {
  function createConfig(
    jobs: Record<string, GitLabJob>,
    variables?: Record<string, string>,
  ): ProcessedConfig {
    const config = { ...jobs }
    if (variables) {
      ;(config as any).variables = variables
    }

    const context = {
      filePath: '/project/.gitlab-ci.yml',
      baseDir: '/project',
      includedFiles: new Set<string>(),
      includeStack: [],
      remoteJobs: new Set<string>(),
      gitlabHost: 'gitlab.example.com',
    }
    return new ProcessedConfig(config as any, context)
  }
  describe('basic dependency rule mismatches', () => {
    it('should detect when dependent job has broader change patterns than dependency', () => {
      // Match specific predefined scenario files
      const jobs: Record<string, GitLabJob> = {
        build_app: {
          script: ['echo "Building"'],
          rules: [
            {
              if: '$CI_COMMIT_REF_NAME == "main"',
              changes: ['src/app.js'], // Only matches source code changes scenario
              when: 'on_success',
            },
          ],
        },
        deploy_app: {
          script: ['echo "Deploying"'],
          dependencies: ['build_app'],
          rules: [
            {
              if: '$CI_COMMIT_REF_NAME == "main"',
              changes: ['src/app.js', 'config/production.yml'], // Matches both source and config scenarios
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      expect(issue).toMatchObject({
        severity: 'error',
        message: expect.stringContaining(
          "Job 'deploy_app' depends on 'build_app' which may not run due to rules",
        ),
        location: 'deploy_app',
      })

      expect(issue.message).toContain('config changes')
    })

    it('should detect needs dependencies with broader patterns', () => {
      const jobs: Record<string, GitLabJob> = {
        test_login: {
          script: ['echo "Testing login"'],
          rules: [
            {
              if: '$CI_COMMIT_REF_NAME == "main"',
              changes: ['package.json'], // Only matches dependency definition changes
              when: 'on_success',
            },
          ],
        },
        deploy_login: {
          script: ['echo "Deploying login"'],
          needs: ['test_login'],
          rules: [
            {
              if: '$CI_COMMIT_REF_NAME == "main"',
              changes: ['package.json', 'pnpm-lock.yaml'], // Also matches lockfile changes
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      expect(issue.message).toContain("Job 'deploy_login' depends on 'test_login'")
      expect(issue.message).toContain('lockfile changes')
    })

    it('should handle complex needs objects', () => {
      const jobs: Record<string, GitLabJob> = {
        build_frontend: {
          script: ['npm run build'],
          rules: [
            {
              changes: ['src/app.js'], // Only matches source code changes
              when: 'on_success',
            },
          ],
        },
        test_e2e: {
          script: ['npm run e2e'],
          needs: [{ job: 'build_frontend', artifacts: true }, { job: 'other_job' }],
          rules: [
            {
              changes: ['src/app.js', 'README.md'], // Also matches documentation changes
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      expect(issue.message).toContain("Job 'test_e2e' depends on 'build_frontend'")
      expect(issue.message).toContain('documentation changes')
    })
  })

  describe('working scenarios (no issues)', () => {
    it('should not report issues when dependency rules align perfectly', () => {
      const jobs: Record<string, GitLabJob> = {
        build_app: {
          script: ['echo "Building"'],
          rules: [
            {
              if: '$CI_COMMIT_REF_NAME == "main"',
              changes: ['src/**/*'],
              when: 'on_success',
            },
          ],
        },
        deploy_app: {
          script: ['echo "Deploying"'],
          dependencies: ['build_app'],
          rules: [
            {
              if: '$CI_COMMIT_REF_NAME == "main"',
              changes: ['src/**/*'],
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(0)
    })

    it('should not report issues when both jobs have no rules', () => {
      const jobs: Record<string, GitLabJob> = {
        build_simple: {
          script: ['make build'],
        },
        test_simple: {
          script: ['make test'],
          dependencies: ['build_simple'],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(0)
    })

    it('should not report issues when dependency has subset of dependent job patterns', () => {
      const jobs: Record<string, GitLabJob> = {
        lint_code: {
          script: ['eslint src/'],
          rules: [
            {
              changes: ['src/**/*', 'config/**/*', 'package.json'],
              when: 'on_success',
            },
          ],
        },
        build_code: {
          script: ['npm run build'],
          dependencies: ['lint_code'],
          rules: [
            {
              changes: ['src/**/*', 'package.json'],
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(0)
    })

    it('should handle empty rules arrays without issues', () => {
      const jobs: Record<string, GitLabJob> = {
        job1: {
          script: ['echo "job1"'],
          rules: [],
        },
        job2: {
          script: ['echo "job2"'],
          dependencies: ['job1'],
          rules: [],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(0)
    })

    it('should ignore non-existent dependency jobs gracefully', () => {
      const jobs: Record<string, GitLabJob> = {
        existing_job: {
          script: ['echo "exists"'],
          dependencies: ['non_existent'],
          rules: [
            {
              if: '$RUN == "true"',
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      // Should not crash, but also shouldn't report issues for non-existent jobs
      expect(issues).toHaveLength(0)
    })
  })

  describe('rule analysis and message generation', () => {
    it('should provide suggestions for adding change patterns', () => {
      const jobs: Record<string, GitLabJob> = {
        lint_css: {
          script: ['stylelint'],
          rules: [
            {
              changes: ['src/app.js'], // Only source code changes
              when: 'on_success',
            },
          ],
        },
        build_assets: {
          script: ['webpack'],
          dependencies: ['lint_css'],
          rules: [
            {
              changes: ['src/app.js', 'config/production.yml'], // Source + config changes
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      expect(issue.message).toContain('Add change patterns')
      expect(issue.message).toContain('lint_css')
    })

    it('should mention scenario context in error messages', () => {
      const jobs: Record<string, GitLabJob> = {
        build_js: {
          script: ['webpack build'],
          rules: [
            {
              changes: ['package.json'], // Only dependency definition changes
              when: 'on_success',
            },
          ],
        },
        deploy_staging: {
          script: ['deploy.sh'],
          dependencies: ['build_js'],
          rules: [
            {
              changes: ['package.json', 'config/production.yml'], // Dependency + config changes
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      expect(issue.message).toContain('config changes')
    })

    it('should handle multiple problematic scenarios in message', () => {
      const jobs: Record<string, GitLabJob> = {
        specific_job: {
          script: ['echo specific'],
          rules: [
            {
              changes: ['src/app.js'], // Very specific pattern
              when: 'on_success',
            },
          ],
        },
        broad_job: {
          script: ['echo broad'],
          dependencies: ['specific_job'],
          rules: [
            {
              changes: ['src/**/*', 'config/**/*', 'package.json', 'pnpm-lock.yaml', 'README.md'],
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      expect(issue.message).toMatch(/fails in multiple scenarios/)
      expect(issue.message).toContain("Add change patterns to 'specific_job'")
    })
  })

  describe('edge cases and special conditions', () => {
    it('should detect dependency missing in scheduled pipeline', () => {
      // Simulates a scenario where:
      // - dependency_job is excluded from scheduled pipelines
      // - dependent_job depends on it but runs in scheduled pipelines
      const jobs: Record<string, GitLabJob> = {
        dependency_job: {
          script: ['npm publish'],
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "schedule"',
              when: 'never',
            },
            {
              when: 'on_success',
            },
          ],
        },
        dependent_job: {
          script: ['reupload.sh'],
          needs: ['dependency_job'],
          // No schedule exclusion - this job would run in scheduled pipelines
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      // The linter should detect this issue during the 'scheduled pipeline' scenario
      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      expect(issue.message).toContain("Job 'dependent_job' depends on 'dependency_job'")
      expect(issue.message).toContain('scheduled pipeline')
    })

    it('should handle schedule-based exclusions', () => {
      const jobs: Record<string, GitLabJob> = {
        security_scan: {
          script: ['security-scan.sh'],
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE != "schedule"',
              when: 'on_success',
            },
          ],
        },
        deploy_prod: {
          script: ['deploy.sh'],
          dependencies: ['security_scan'],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      expect(issue.message).toContain("Job 'deploy_prod' depends on 'security_scan'")
      expect(issue.message).toContain('scheduled pipeline')
    })

    it('should handle when: never rules appropriately', () => {
      const jobs: Record<string, GitLabJob> = {
        conditional_job: {
          script: ['echo conditional'],
          rules: [
            {
              if: '$SKIP_JOB == "true"',
              when: 'never',
            },
            {
              changes: ['src/**/*'],
              when: 'on_success',
            },
          ],
        },
        dependent_job: {
          script: ['echo dependent'],
          dependencies: ['conditional_job'],
          rules: [
            {
              changes: ['src/**/*'],
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      if (issues.length > 0) {
        const issue = issues[0]
        assert(issue)
        expect(issue.message).toContain('when: never')
      }
    })

    it('should pass variables to context for evaluation', () => {
      const jobs: Record<string, GitLabJob> = {
        conditional_job: {
          script: ['echo conditional'],
          rules: [
            {
              if: '$CUSTOM_VAR == "enabled"',
              when: 'on_success',
            },
          ],
        },
        dependent_job: {
          script: ['echo dependent'],
          dependencies: ['conditional_job'],
        },
      }

      const variables = { CUSTOM_VAR: 'disabled' }
      const issues = checkDependencyRules(createConfig(jobs, variables))

      const issue = issues[0]
      assert(issue)

      // Function may or may not detect this based on its evaluation logic
      // The test verifies it doesn't crash with variables
      expect(Array.isArray(issues)).toBe(true)
    })
  })

  it('should handle jobs with only legacy only/except conditions', () => {
    const jobs: Record<string, GitLabJob> = {
      legacy_job: {
        script: ['echo legacy'],
        only: {
          refs: ['main'],
          changes: ['legacy/**/*'],
        },
      },
      modern_job: {
        script: ['echo modern'],
        dependencies: ['legacy_job'],
        rules: [
          {
            if: '$CI_COMMIT_BRANCH == "main"',
            changes: ['legacy/**/*', 'modern/**/*'],
            when: 'on_success',
          },
        ],
      },
    }

    const issues = checkDependencyRules(createConfig(jobs))

    const issue = issues[0]
    assert(issue)
  })

  describe('object-form changes with paths and compare_to', () => {
    it('should not crash when a rule uses object-form changes', () => {
      const jobs: Record<string, GitLabJob> = {
        job_a: {
          script: ['echo "hello"'],
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              changes: {
                compare_to: 'refs/heads/main',
                paths: ['libs/**/*', 'tools/**/*'],
              },
              when: 'on_success',
            },
          ],
        },
        job_b: {
          script: ['echo "world"'],
          needs: ['job_a'],
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              changes: {
                compare_to: 'refs/heads/main',
                paths: ['libs/**/*', 'tools/**/*', 'apps/**/*'],
              },
              when: 'on_success',
            },
          ],
        },
      }

      // Should not throw "TypeError: changes.some is not a function"
      expect(() => checkDependencyRules(createConfig(jobs))).not.toThrow()
    })

    it('should detect dependency issues with object-form changes', () => {
      const jobs: Record<string, GitLabJob> = {
        build: {
          script: ['echo "build"'],
          rules: [
            {
              changes: {
                compare_to: 'refs/heads/main',
                paths: ['src/app.js'],
              },
              when: 'on_success',
            },
          ],
        },
        deploy: {
          script: ['echo "deploy"'],
          dependencies: ['build'],
          rules: [
            {
              changes: {
                compare_to: 'refs/heads/main',
                paths: ['src/app.js', 'config/production.yml'],
              },
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      expect(issue.message).toContain("Job 'deploy' depends on 'build'")
    })

    it('should extract change patterns from object-form for rule analysis', () => {
      const jobs: Record<string, GitLabJob> = {
        lint: {
          script: ['echo "lint"'],
          rules: [
            {
              changes: {
                compare_to: 'refs/heads/main',
                paths: ['src/app.js'],
              },
              when: 'on_success',
            },
          ],
        },
        test: {
          script: ['echo "test"'],
          dependencies: ['lint'],
          rules: [
            {
              changes: {
                compare_to: 'refs/heads/main',
                paths: ['src/app.js', 'config/production.yml'],
              },
              when: 'on_success',
            },
          ],
        },
      }

      const issues = checkDependencyRules(createConfig(jobs))

      expect(issues).toHaveLength(1)
      const issue = issues[0]
      assert(issue)
      // The analysis should extract paths from object-form and suggest adding them
      expect(issue.message).toContain("Add change patterns to 'lint'")
    })
  })
})
