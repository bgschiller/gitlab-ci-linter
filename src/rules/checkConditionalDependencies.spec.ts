import { assert, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { checkConditionalDependencies } from './checkConditionalDependencies.js'
import { ProcessedConfig } from '../ProcessedConfig.js'

describe('checkConditionalDependencies', () => {
  function createConfig(yamlContent: string): ProcessedConfig {
    const parsed = parse(yamlContent)
    const context = {
      filePath: '/project/.gitlab-ci.yml',
      baseDir: '/project',
      includedFiles: new Set<string>(),
      includeStack: [],
      remoteJobs: new Set<string>(),
      gitlabHost: 'gitlab.example.com',
    }
    return new ProcessedConfig(parsed, context)
  }

  it('should not flag dependencies without change-based rules', () => {
    const yaml = `
build:
  script: echo "building"

test:
  script: echo "testing"
  needs: [build]
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(0)
  })

  it('should not flag dependencies with matching change patterns', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/**/*"

test-frontend:
  script: echo "testing frontend"
  needs: [build-frontend]
  rules:
    - changes:
        - "frontend/**/*"
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(0)
  })

  it('should flag problematic conditional dependency with single change pattern', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/**/*"

deploy:
  script: echo "deploying"
  needs: [build-frontend]
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)

    expect(issues).toHaveLength(1)
    const issue = issues[0]
    assert(issue)
    expect(issue.severity).toBe('error')
    expect(issue.message).toContain("Job 'deploy' needs 'build-frontend' job")
    expect(issue.message).toContain('only runs when there are changes to: frontend/**/*')
    expect(issue.message).toContain("Consider adding 'changes: [frontend/**/*]' to 'deploy' rules")
    expect(issue.message).toContain("or use 'needs: [{job: build-frontend, optional: true}]'")
    expect(issue.location).toBe('deploy')
  })

  it('should flag problematic conditional dependency with multiple change patterns', () => {
    const yaml = `
build-backend:
  script: echo "building backend"
  rules:
    - changes:
        - "backend/**/*"
        - "shared/**/*"

deploy:
  script: echo "deploying"
  needs: [build-backend]
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)

    expect(issues).toHaveLength(1)
    const issue = issues[0]
    assert(issue)
    expect(issue.severity).toBe('error')
    expect(issue.message).toContain(
      'only runs when there are changes to: backend/**/*, shared/**/*',
    )
    expect(issue.message).toContain("Consider adding the same change patterns to 'deploy' rules")
  })

  it('should not flag when dependent job has never rule preventing execution', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/**/*"

test-frontend:
  script: echo "testing frontend"
  needs: [build-frontend]
  rules:
    - when: never
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(0)
  })

  it('should not flag when dependent job has overlapping change patterns', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/src"

test-frontend:
  script: echo "testing frontend"
  needs: [build-frontend]
  rules:
    - changes:
        - "frontend"  # This overlaps with dependency's pattern (frontend/src contains frontend)
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(0)
  })

  it('should handle dependencies field in addition to needs', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/**/*"

deploy:
  script: echo "deploying"
  dependencies: [build-frontend]
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    const issue = issues[0]
    assert(issue)

    expect(issues).toHaveLength(1)
    expect(issue.message).toContain("Job 'deploy' needs 'build-frontend' job")
  })

  it('should handle needs with job objects', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/**/*"

deploy:
  script: echo "deploying"
  needs:
    - job: build-frontend
      artifacts: true
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)

    expect(issues).toHaveLength(1)
    const issue = issues[0]
    assert(issue)
    expect(issue.message).toContain("Job 'deploy' needs 'build-frontend' job")
  })

  it('should skip template jobs as dependents (starting with dot)', () => {
    const yaml = `
build:
  script: echo "building"
  rules:
    - changes:
        - "src/**/*"

.deploy-template:
  script: echo "deploying"
  needs: [build]
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(0) // Template job as dependent is skipped
  })

  it('should flag when regular job depends on template job with changes rules', () => {
    const yaml = `
.build-template:
  script: echo "building"
  rules:
    - changes:
        - "src/**/*"

deploy:
  script: echo "deploying"
  needs: [.build-template]
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(1) // Regular job depending on template with changes should be flagged
    const issue = issues[0]
    assert(issue)
    expect(issue.message).toContain("Job 'deploy' needs '.build-template' job")
  })

  it('should skip non-existent dependencies', () => {
    const yaml = `
deploy:
  script: echo "deploying"
  needs: [non-existent-job]
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(0)
  })

  it('should flag when dependent job has no rules but depends on conditional job', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/**/*"

deploy:
  script: echo "deploying"
  needs: [build-frontend]
  # No rules - runs by default even without frontend changes
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(1) // Issue because deploy can run without frontend changes but depends on build-frontend
    const issue = issues[0]
    assert(issue)
    expect(issue.message).toContain("Job 'deploy' needs 'build-frontend' job")
  })

  it('should flag when all dependent job rules require specific changes that dont overlap', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/**/*"

deploy:
  script: echo "deploying"
  needs: [build-frontend]
  rules:
    - changes:
        - "backend/**/*"  # Different changes pattern
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)

    expect(issues).toHaveLength(1)
    const issue = issues[0]
    assert(issue)
    expect(issue.message).toContain("Job 'deploy' needs 'build-frontend' job")
  })

  it('should deduplicate dependencies from needs and dependencies fields', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/**/*"

deploy:
  script: echo "deploying"
  needs: [build-frontend]
  dependencies: [build-frontend]  # Duplicate dependency
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)

    expect(issues).toHaveLength(1) // Only one issue despite duplicate dependency
    const issue = issues[0]
    assert(issue)
    expect(issue.message).toContain("Job 'deploy' needs 'build-frontend' job")
  })

  it('should handle complex scenario with multiple dependencies', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/**/*"

build-backend:
  script: echo "building backend"
  # No rules - always runs

test-integration:
  script: echo "integration tests"
  needs: [build-frontend, build-backend]
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)

    expect(issues).toHaveLength(1) // Only flags the conditional dependency (build-frontend)
    const issue = issues[0]
    assert(issue)
    expect(issue.message).toContain("Job 'test-integration' needs 'build-frontend' job")
  })

  it('should handle duplicate change patterns in dependency job rules', () => {
    const yaml = `
build-frontend:
  script: echo "building frontend"
  rules:
    - changes:
        - "frontend/**/*"
        - "shared/**/*"
    - changes:
        - "frontend/**/*"  # Duplicate pattern
        - "common/**/*"

deploy:
  script: echo "deploying"
  needs: [build-frontend]
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)

    expect(issues).toHaveLength(1)
    // Should contain all unique patterns
    const issue = issues[0]
    assert(issue)
    expect(issue.message).toContain('frontend/**/*')
    expect(issue.message).toContain('shared/**/*')
    expect(issue.message).toContain('common/**/*')
  })

  it('should not flag manual jobs depending on jobs with conditional rules', () => {
    const yaml = `
plan:
  script: terraform plan
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
      when: never
    - when: always
      changes:
        - terraform/qa/**/*
    - when: manual

apply:
  script: terraform apply
  when: manual
  needs: [plan]
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
      when: never
    - when: manual
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(0)
  })

  it('should not flag jobs that have both conditional and fallback rules', () => {
    const yaml = `
# This is similar to a conditional fallback scenario:
# windows-build has changes rules but also a fallback rule
windows-build:
  script: echo "building on windows"
  rules:
    - changes:
        - "packages/app/**/*"
        - ".gitlab/**/*"
      allow_failure: true
    - when: always  # fallback rule - always runs

windows-test:
  script: echo "testing on windows"
  needs: [windows-build]
  rules:
    - when: always
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(0) // Should not flag because windows-build has fallback rule
  })

  it('should flag jobs that only have conditional rules with no fallback', () => {
    const yaml = `
# This job ONLY runs with changes - no fallback
windows-build:
  script: echo "building on windows"
  rules:
    - changes:
        - "packages/app/**/*"
        - ".gitlab/**/*"

windows-test:
  script: echo "testing on windows"
  needs: [windows-build]
  rules:
    - when: always
`
    const config = createConfig(yaml)
    const issues = checkConditionalDependencies(config)
    expect(issues).toHaveLength(1) // Should flag because windows-build has no fallback rule
    const issue = issues[0]
    assert(issue)
    expect(issue.message).toContain("Job 'windows-test' needs 'windows-build' job")
  })
})
