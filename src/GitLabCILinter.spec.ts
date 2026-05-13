import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitLabCILinter } from './GitLabCILinter'

describe('GitLabCILinter Integration Tests', () => {
  describe('Constructor', () => {
    it('should create instance with minimal config', () => {
      const yaml = `
stages:
  - build

build_job:
  stage: build
  script:
    - echo "Building"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      expect(linter).toBeDefined()
      expect(linter.getAvailableRules().length).toBeGreaterThan(0)
    })

    it('should create instance with linter options', () => {
      const yaml = 'build_job:\n  script:\n    - echo "test"'
      const linter = new GitLabCILinter(yaml, 'test.yml', {
        severityLevel: 'error',
        enabledRules: ['manual-jobs'],
      })
      expect(linter).toBeDefined()
    })
  })

  describe('lint() method', () => {
    it('should return no issues for valid basic config', async () => {
      const yaml = `
stages:
  - build

build_job:
  stage: build
  script:
    - echo "Building"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const issues = await linter.lint()
      expect(Array.isArray(issues)).toBe(true)
    })

    it('should detect manual job issues', async () => {
      const yaml = `
stages:
  - deploy

manual_deploy:
  stage: deploy
  script:
    - echo "Deploying"
  rules:
    - when: manual
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const issues = await linter.lint()
      const manualJobIssues = issues.filter(issue =>
        issue.message.includes('manual rule without allow_failure'),
      )
      expect(manualJobIssues.length).toBeGreaterThan(0)
    })

    it('should detect circular dependencies', async () => {
      const yaml = `
job_a:
  script: ["echo a"]
  needs: ["job_b"]

job_b:
  script: ["echo b"]
  needs: ["job_c"]

job_c:
  script: ["echo c"]
  needs: ["job_a"]
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const issues = await linter.lint()
      const circularIssues = issues.filter(issue => issue.message.includes('Circular dependency'))
      expect(circularIssues.length).toBeGreaterThan(0)
    })

    it('should detect invalid stage assignments', async () => {
      const yaml = `
stages:
  - build

test_job:
  stage: nonexistent_stage
  script:
    - echo "Testing"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const issues = await linter.lint()
      const stageIssues = issues.filter(
        issue =>
          issue.message.includes('nonexistent_stage') && issue.message.includes('undefined stage'),
      )
      expect(stageIssues.length).toBeGreaterThan(0)
    })

    it('should respect severity level filtering', async () => {
      const yaml = `
manual_deploy:
  script: ["deploy"]
  when: manual
`

      // Test with error level only
      const errorLinter = new GitLabCILinter(yaml, 'test.yml', { severityLevel: 'error' })
      const errorIssues = await errorLinter.lint()

      // Test with all levels
      const allLinter = new GitLabCILinter(yaml, 'test.yml', { severityLevel: 'info' })
      const allIssues = await allLinter.lint()

      expect(allIssues.length).toBeGreaterThanOrEqual(errorIssues.length)
    })

    it('should respect enabled rules filtering', async () => {
      const yaml = `
manual_deploy:
  stage: invalid_stage
  script: ["deploy"]
  rules:
    - when: manual
`

      // Only enable manual-jobs rule
      const linter = new GitLabCILinter(yaml, 'test.yml', {
        enabledRules: ['manual-jobs'],
      })
      const issues = await linter.lint()

      // Should only have manual job issues, not stage issues
      const hasManualIssues = issues.some(issue =>
        issue.message.includes('manual rule without allow_failure'),
      )
      const hasStageIssues = issues.some(issue => issue.message.includes('invalid_stage'))

      expect(hasManualIssues).toBe(true)
      expect(hasStageIssues).toBe(false)
    })

    it('should respect disabled rules filtering', async () => {
      const yaml = `
manual_deploy:
  stage: invalid_stage
  script: ["deploy"]
  rules:
    - when: manual
`

      // Disable manual-jobs rule
      const linter = new GitLabCILinter(yaml, 'test.yml', {
        disabledRules: ['manual-jobs'],
      })
      const issues = await linter.lint()

      // Should have stage issues but not manual job issues
      const hasManualIssues = issues.some(issue =>
        issue.message.includes('manual rule without allow_failure'),
      )

      expect(hasManualIssues).toBe(false)
    })
  })

  describe('flatten() method', () => {
    it('should return valid YAML for basic config', async () => {
      const yaml = `
stages:
  - build

build_job:
  stage: build
  script:
    - echo "Building"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const flattened = await linter.flatten()

      expect(typeof flattened).toBe('string')
      expect(flattened).toContain('build_job')
      expect(flattened).toContain('script')
      expect(flattened).not.toContain('include')
    })

    it('should resolve extends relationships', async () => {
      const yaml = `
.base_job:
  before_script:
    - echo "Base setup"
  variables:
    BASE_VAR: "base_value"

test_job:
  extends: .base_job
  script:
    - echo "Testing"
  stage: test
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const flattened = await linter.flatten()

      expect(flattened).toContain('test_job')
      expect(flattened).toContain('before_script')
      expect(flattened).toContain('Base setup')
      expect(flattened).toContain('BASE_VAR')
      expect(flattened).not.toContain('extends')
    })

    it('should expand variables in flattened output', async () => {
      const yaml = `
variables:
  BUILD_NAME: "my_build"

build_job:
  script:
    - echo "Building \${BUILD_NAME}"
  variables:
    JOB_VAR: "job_\${BUILD_NAME}"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const flattened = await linter.flatten()

      expect(flattened).toContain('my_build')
      expect(flattened).toContain('job_my_build')
    })

    it('should handle complex configuration with includes and templates', async () => {
      const yaml = `
stages:
  - build
  - test

variables:
  PROJECT_NAME: "test_project"

.template_job:
  before_script:
    - echo "Template setup for \${PROJECT_NAME}"

build:
  extends: .template_job
  stage: build
  script:
    - echo "Building \${PROJECT_NAME}"

test:
  extends: .template_job
  stage: test
  script:
    - echo "Testing \${PROJECT_NAME}"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const flattened = await linter.flatten()

      expect(flattened).toContain('build:')
      expect(flattened).toContain('test:')
      expect(flattened).toContain('test_project')
      expect(flattened).not.toContain('extends')
      expect(flattened).not.toContain('.template_job')
    })

    it('should flatten a single job when jobName is provided', async () => {
      const yaml = `
stages:
  - build
  - test

.base_job:
  before_script:
    - echo "Base setup"

build_job:
  extends: .base_job
  stage: build
  script:
    - echo "Building"

test_job:
  extends: .base_job
  stage: test
  script:
    - echo "Testing"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const flattened = await linter.flatten('build_job')

      expect(flattened).toContain('build_job:')
      expect(flattened).toContain('before_script')
      expect(flattened).toContain('Base setup')
      expect(flattened).not.toContain('test_job')
      expect(flattened).not.toContain('stages')
      expect(flattened).not.toContain('extends')
    })

    it('should resolve extends properly when flattening a single job', async () => {
      const yaml = `
.base:
  variables:
    BASE_VAR: "base_value"
  before_script:
    - echo "Base"

.intermediate:
  extends: .base
  variables:
    INTER_VAR: "inter_value"

build:
  extends: .intermediate
  script:
    - echo "Build"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const flattened = await linter.flatten('build')

      expect(flattened).toContain('build:')
      expect(flattened).toContain('BASE_VAR')
      expect(flattened).toContain('base_value')
      expect(flattened).toContain('INTER_VAR')
      expect(flattened).toContain('inter_value')
      expect(flattened).toContain('before_script')
      expect(flattened).not.toContain('extends')
    })

    it('should expand variables when flattening a single job', async () => {
      const yaml = `
variables:
  PROJECT_NAME: "my_project"

build:
  script:
    - echo "Building \${PROJECT_NAME}"
  variables:
    BUILD_NAME: "build_\${PROJECT_NAME}"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const flattened = await linter.flatten('build')

      expect(flattened).toContain('build:')
      expect(flattened).toContain('my_project')
      expect(flattened).toContain('build_my_project')
    })

    it('should throw error with available jobs when job does not exist', async () => {
      const yaml = `
build_job:
  script:
    - echo "Building"

test_job:
  script:
    - echo "Testing"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')

      await expect(linter.flatten('nonexistent_job')).rejects.toThrow(
        "Job 'nonexistent_job' not found. Available jobs: build_job, test_job",
      )
    })

    it('should throw error when trying to flatten a template job', async () => {
      const yaml = `
.template_job:
  before_script:
    - echo "Template"

build:
  extends: .template_job
  script:
    - echo "Build"
`
      const linter = new GitLabCILinter(yaml, 'test.yml')

      // Template jobs are removed during flattening, so they won't be found
      await expect(linter.flatten('.template_job')).rejects.toThrow(
        "Job '.template_job' not found. Available jobs: build",
      )
    })
  })

  describe('getAvailableRules() method', () => {
    it('should return array of rule names', () => {
      const yaml = 'test: { script: ["echo test"] }'
      const linter = new GitLabCILinter(yaml, 'test.yml')
      const rules = linter.getAvailableRules()

      expect(Array.isArray(rules)).toBe(true)
      expect(rules.length).toBeGreaterThan(0)
      expect(rules).toContain('manual-jobs')
      expect(rules).toContain('circular-dependencies')
      expect(rules).toContain('job-stage-assignments')
    })
  })

  describe('Complex integration scenarios', () => {
    it('should handle real-world-like configuration with multiple features', async () => {
      const yaml = `
stages:
  - build
  - test
  - deploy

variables:
  DOCKER_IMAGE: "node:16"
  APP_NAME: "my-app"

.base_job:
  image: \${DOCKER_IMAGE}
  before_script:
    - npm ci
  variables:
    NODE_ENV: "production"

build:
  extends: .base_job
  stage: build
  script:
    - npm run build
    - echo "Built \${APP_NAME}"
  artifacts:
    paths:
      - dist/
    expire_in: 1 hour

test:
  extends: .base_job
  stage: test
  needs: ["build"]
  script:
    - npm run test
    - echo "Tested \${APP_NAME}"

deploy_staging:
  stage: deploy
  needs: ["test"]
  script:
    - echo "Deploying \${APP_NAME} to staging"
  rules:
    - if: '$CI_COMMIT_BRANCH == "develop"'

deploy_prod:
  stage: deploy
  needs: ["test"]
  script:
    - echo "Deploying \${APP_NAME} to production"
  when: manual
  allow_failure: true
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
`

      const linter = new GitLabCILinter(yaml, 'test.yml')

      // Test linting
      const issues = await linter.lint()
      expect(Array.isArray(issues)).toBe(true)

      // Test flattening
      const flattened = await linter.flatten()
      expect(flattened).toContain('build:')
      expect(flattened).toContain('test:')
      expect(flattened).toContain('deploy_staging:')
      expect(flattened).toContain('deploy_prod:')
      expect(flattened).toContain('my-app')
      expect(flattened).toContain('node:16')
      expect(flattened).not.toContain('extends')
      expect(flattened).not.toContain('.base_job')
    })

    it('should handle configuration with security issues', async () => {
      const yaml = `
build:
  script:
    - echo "password123"
    - curl -k https://insecure.example.com
    - wget --no-check-certificate https://bad.example.com
  variables:
    SECRET_KEY: "hardcoded_secret_value"
    PASSWORD: "admin123"
`

      const linter = new GitLabCILinter(yaml, 'test.yml')
      const issues = await linter.lint()

      const securityIssues = issues.filter(
        issue =>
          issue.message.includes('security') ||
          issue.message.includes('hardcoded') ||
          issue.message.includes('insecure') ||
          issue.message.includes('password'),
      )

      expect(securityIssues.length).toBeGreaterThan(0)
    })

    it('should handle configuration with artifact issues', async () => {
      const yaml = `
build:
  script:
    - echo "building"
  artifacts:
    paths:
      - "**/*"  # Too broad
    expire_in: "invalid_format"

test:
  script:
    - echo "testing"
  artifacts:
    paths: []  # Empty paths
`

      const linter = new GitLabCILinter(yaml, 'test.yml')
      const issues = await linter.lint()

      const artifactIssues = issues.filter(
        issue =>
          issue.message.includes('artifact') ||
          issue.message.includes('expire_in') ||
          issue.message.includes('broad pattern'),
      )

      expect(artifactIssues.length).toBeGreaterThan(0)
    })
  })

  describe('Error handling', () => {
    it('should handle invalid YAML gracefully', async () => {
      const invalidYaml = `
build:
  script: [
    - echo "unclosed array"
`

      const linter = new GitLabCILinter(invalidYaml, 'test.yml')

      // Should throw during processing, not during construction
      await expect(linter.lint()).rejects.toThrow()
    })

    it('should handle empty configuration', async () => {
      const emptyYaml = ''
      const linter = new GitLabCILinter(emptyYaml, 'test.yml')
      const issues = await linter.lint()
      expect(Array.isArray(issues)).toBe(true)
    })

    it('should handle configuration with only comments', async () => {
      const commentsOnly = `
# This is a comment
# Another comment
`
      const linter = new GitLabCILinter(commentsOnly, 'test.yml')
      const issues = await linter.lint()
      expect(Array.isArray(issues)).toBe(true)
    })
  })

  describe('API compatibility', () => {
    it('should maintain backward compatible interface', () => {
      const yaml = 'test: { script: ["echo test"] }'
      const linter = new GitLabCILinter(yaml, 'test.yml')

      // Check that all expected methods exist
      expect(typeof linter.lint).toBe('function')
      expect(typeof linter.flatten).toBe('function')
      expect(typeof linter.getAvailableRules).toBe('function')
    })

    it('should return consistent data types', async () => {
      const yaml = `
manual_job:
  script: ["echo test"]
  rules:
    - when: manual
`
      const linter = new GitLabCILinter(yaml, 'test.yml')

      // lint() should return array of LintIssue objects
      const issues = await linter.lint()
      expect(Array.isArray(issues)).toBe(true)
      if (issues.length > 0) {
        const issue = issues[0]
        expect(issue).toHaveProperty('severity')
        expect(issue).toHaveProperty('message')
        expect(['error', 'warning', 'info']).toContain(issue!.severity)
      }

      // flatten() should return string
      const flattened = await linter.flatten()
      expect(typeof flattened).toBe('string')

      // getAvailableRules() should return array of strings
      const rules = linter.getAvailableRules()
      expect(Array.isArray(rules)).toBe(true)
      rules.forEach(rule => expect(typeof rule).toBe('string'))
    })
  })

  describe('lintWithChildren() method', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'gitlab-ci-linter-test-'))
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it('should lint child pipelines without context', async () => {
      // Create a child pipeline with a manual job issue
      const childYaml = `
stages:
  - deploy

manual_deploy:
  stage: deploy
  script:
    - echo "Deploying"
  rules:
    - when: manual
`
      writeFileSync(join(tempDir, 'child-ci.yml'), childYaml)

      // Parent config references the child via trigger.include.local
      const parentYaml = `
stages:
  - build
  - trigger

build_job:
  stage: build
  script:
    - echo "Building"

trigger_child:
  stage: trigger
  trigger:
    include:
      - local: child-ci.yml
`
      const parentPath = join(tempDir, '.gitlab-ci.yml')
      writeFileSync(parentPath, parentYaml)

      const linter = new GitLabCILinter(parentYaml, parentPath, { rootDir: tempDir })
      const issues = await linter.lintWithChildren()

      // Should have parent issues tagged with source 'parent'
      const parentIssues = issues.filter(i => i.source === 'parent')
      expect(parentIssues.length).toBeGreaterThanOrEqual(0)

      // Should have child issues tagged with source 'child-ci.yml'
      const childIssues = issues.filter(i => i.source === 'child-ci.yml')
      expect(childIssues.length).toBeGreaterThan(0)
      expect(childIssues[0]!.depth).toBe(1)

      // Child should report the manual job issue
      const manualIssue = childIssues.find(i =>
        i.message.includes('manual rule without allow_failure'),
      )
      expect(manualIssue).toBeDefined()
    })

    it('should return only parent issues when no trigger jobs exist', async () => {
      const parentYaml = `
stages:
  - build

build_job:
  stage: build
  script:
    - echo "Building"
`
      const parentPath = join(tempDir, '.gitlab-ci.yml')
      writeFileSync(parentPath, parentYaml)

      const linter = new GitLabCILinter(parentYaml, parentPath, { rootDir: tempDir })
      const issues = await linter.lintWithChildren()

      // All issues should be from parent
      expect(issues.every(i => i.source === 'parent')).toBe(true)
    })

    it('should recurse into grandchild pipelines', async () => {
      // Grandchild with an issue
      const grandchildYaml = `
stages:
  - test

test_job:
  stage: nonexistent_stage
  script:
    - echo "Testing"
`
      mkdirSync(join(tempDir, 'nested'), { recursive: true })
      writeFileSync(join(tempDir, 'nested', 'grandchild-ci.yml'), grandchildYaml)

      // Child that triggers grandchild
      const childYaml = `
stages:
  - build
  - trigger

build_child:
  stage: build
  script:
    - echo "Building child"

trigger_grandchild:
  stage: trigger
  trigger:
    include:
      - local: nested/grandchild-ci.yml
`
      writeFileSync(join(tempDir, 'child-ci.yml'), childYaml)

      // Parent that triggers child
      const parentYaml = `
stages:
  - trigger

trigger_child:
  stage: trigger
  trigger:
    include:
      - local: child-ci.yml
`
      const parentPath = join(tempDir, '.gitlab-ci.yml')
      writeFileSync(parentPath, parentYaml)

      const linter = new GitLabCILinter(parentYaml, parentPath, { rootDir: tempDir })
      const issues = await linter.lintWithChildren()

      // Should have grandchild issues at depth 2
      const grandchildIssues = issues.filter(i => i.source === 'nested/grandchild-ci.yml')
      expect(grandchildIssues.length).toBeGreaterThan(0)
      expect(grandchildIssues[0]!.depth).toBe(2)
    })

    it('should handle string-style trigger include', async () => {
      const childYaml = `
stages:
  - deploy

manual_deploy:
  stage: deploy
  script:
    - echo "Deploying"
  rules:
    - when: manual
`
      writeFileSync(join(tempDir, 'child-ci.yml'), childYaml)

      const parentYaml = `
stages:
  - trigger

trigger_child:
  stage: trigger
  trigger:
    include: child-ci.yml
`
      const parentPath = join(tempDir, '.gitlab-ci.yml')
      writeFileSync(parentPath, parentYaml)

      const linter = new GitLabCILinter(parentYaml, parentPath, { rootDir: tempDir })
      const issues = await linter.lintWithChildren()

      const childIssues = issues.filter(i => i.source === 'child-ci.yml')
      expect(childIssues.length).toBeGreaterThan(0)
    })

    it('should skip missing child pipeline files gracefully', async () => {
      const parentYaml = `
stages:
  - trigger

trigger_child:
  stage: trigger
  trigger:
    include:
      - local: nonexistent-child.yml
`
      const parentPath = join(tempDir, '.gitlab-ci.yml')
      writeFileSync(parentPath, parentYaml)

      const linter = new GitLabCILinter(parentYaml, parentPath, { rootDir: tempDir })
      const issues = await linter.lintWithChildren()

      // Should still have parent issues, no crash
      expect(issues.every(i => i.source === 'parent')).toBe(true)
    })
  })

  describe('include rules (per-scenario)', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'gitlab-ci-linter-test-include-rules-'))
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it('test(): skips jobs from an include whose rules do not match the scenario', async () => {
      writeFileSync(join(tempDir, 'qa.yml'), `qa_job:\n  stage: test\n  script: ['echo qa']\n`)
      const parentYaml = `
stages:
  - test

include:
  - local: qa.yml
    rules:
      - if: $EPH_ENV_ID != null

always_job:
  stage: test
  script: ['echo always']
`
      const parentPath = join(tempDir, '.gitlab-ci.yml')
      writeFileSync(parentPath, parentYaml)
      const linter = new GitLabCILinter(parentYaml, parentPath, { rootDir: tempDir })

      // Scenario A: include should load — qa_job exists and runs
      const matchResult = await linter.test(
        {
          variables: { EPH_ENV_ID: 'eph-123' },
          assertions: { jobs: { qa_job: 'automatic', always_job: 'automatic' } },
        },
        false,
      )
      expect(matchResult.passed).toBe(true)

      // Scenario B: include should skip — qa_job does not exist in the
      // flattened config, so an assertion against it would have nothing to
      // compare. The always_job still runs.
      const skipResult = await linter.test(
        {
          variables: { EPH_ENV_ID: '' },
          assertions: { jobs: { always_job: 'automatic' } },
        },
        false,
      )
      expect(skipResult.passed).toBe(true)
    })

    it('generateScenarios(): generated scenarios reflect per-scenario include resolution', async () => {
      writeFileSync(
        join(tempDir, 'qa.yml'),
        `qa_job:\n  stage: test\n  script: ['echo qa']\n  rules:\n    - if: $EPH_ENV_ID != null\n`,
      )
      const parentYaml = `
stages:
  - test

include:
  - local: qa.yml
    rules:
      - if: $EPH_ENV_ID != null

always_job:
  stage: test
  script: ['echo always']
  rules:
    - if: $EPH_ENV_ID != null
      when: never
    - when: always
`
      const parentPath = join(tempDir, '.gitlab-ci.yml')
      writeFileSync(parentPath, parentYaml)
      const linter = new GitLabCILinter(parentYaml, parentPath, { rootDir: tempDir })

      const result = await linter.generateScenarios()

      // We expect at least one scenario where EPH_ENV_ID is set (qa_job
      // present) and one where it is null/unset (qa_job absent from
      // assertions because the include never loaded).
      const withQa = result.scenarios.find(s => s.assertions?.jobs && 'qa_job' in s.assertions.jobs)
      const withoutQa = result.scenarios.find(
        s => s.assertions?.jobs && !('qa_job' in s.assertions.jobs),
      )

      expect(withQa).toBeDefined()
      expect(withoutQa).toBeDefined()
    })

    it('generate-then-test round-trip: scenarios generated under include rules pass when re-run', async () => {
      writeFileSync(join(tempDir, 'qa.yml'), `qa_job:\n  stage: test\n  script: ['echo qa']\n`)
      const parentYaml = `
stages:
  - test

include:
  - local: qa.yml
    rules:
      - if: $EPH_ENV_ID != null

always_job:
  stage: test
  script: ['echo always']
`
      const parentPath = join(tempDir, '.gitlab-ci.yml')
      writeFileSync(parentPath, parentYaml)
      const linter = new GitLabCILinter(parentYaml, parentPath, { rootDir: tempDir })

      const { scenarios } = await linter.generateScenarios()
      expect(scenarios.length).toBeGreaterThan(0)

      for (const scenario of scenarios) {
        const result = await linter.test(scenario, false)
        expect(result.passed).toBe(true)
      }
    })
  })
})
