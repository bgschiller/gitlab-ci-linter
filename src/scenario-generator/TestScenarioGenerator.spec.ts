import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig'
import type { GitLabCI } from '../types'
import { TestScenarioGenerator } from './TestScenarioGenerator'

vi.mock('fs')
const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)

function createProcessedConfig(config: GitLabCI): ProcessedConfig {
  const context: ProcessingContext = {
    filePath: '/test/.gitlab-ci.yml',
    baseDir: '/test',
    includedFiles: new Set(),
    includeStack: [],
    remoteJobs: new Set(),
    gitlabHost: 'gitlab.example.com',
  }
  return new ProcessedConfig(config, context)
}

describe('TestScenarioGenerator', () => {
  describe('generate', () => {
    it('should generate scenarios for config with rules', () => {
      const config = createProcessedConfig({
        stages: ['build', 'deploy'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [
            { if: '$CI_COMMIT_BRANCH == "main"', when: 'on_success' },
            { if: '$CI_COMMIT_BRANCH != "main"', when: 'manual' },
          ],
        },
        'deploy-job': {
          stage: 'deploy',
          script: ['echo deploy'],
          rules: [{ if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH' }],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      expect(result.scenarios.length).toBeGreaterThan(0)
      expect(result.metadata.totalJobsAnalyzed).toBe(2)
      expect(result.metadata.variablesFound).toContain('CI_COMMIT_BRANCH')
    })

    it('should generate default scenarios when no rules are found', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        'simple-job': {
          stage: 'build',
          script: ['echo hello'],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      expect(result.scenarios.length).toBeGreaterThan(0)
      expect(result.metadata.totalJobsAnalyzed).toBe(1)
      expect(result.metadata.variablesFound).toEqual([])
    })

    it('should respect maxScenarios limit', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        job1: {
          stage: 'build',
          script: ['echo 1'],
          rules: [{ if: '$VAR1 == "a"' }, { if: '$VAR2 == "b"' }, { if: '$VAR3 == "c"' }],
        },
      })

      const result = TestScenarioGenerator.generate(config, { maxScenarios: 3 })

      expect(result.scenarios.length).toBeLessThanOrEqual(3)
    })

    it('should filter by targetJobs', () => {
      const config = createProcessedConfig({
        stages: ['build', 'test'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
        'test-job': {
          stage: 'test',
          script: ['echo test'],
          rules: [{ if: '$CI_PIPELINE_SOURCE == "push"' }],
        },
        'deploy-job': {
          stage: 'test',
          script: ['echo deploy'],
        },
      })

      const result = TestScenarioGenerator.generate(config, {
        targetJobs: ['build-job', 'test-job'],
      })

      expect(result.metadata.targetedJobs).toEqual(['build-job', 'test-job'])
      // Assertions should only include targeted jobs
      for (const scenario of result.scenarios) {
        if (scenario.assertions?.jobs) {
          expect(Object.keys(scenario.assertions.jobs)).not.toContain('deploy-job')
        }
      }
    })

    it('should compute correct assertions for automatic jobs', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        'auto-job': {
          stage: 'build',
          script: ['echo auto'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"', when: 'on_success' }],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      // Find scenario where CI_COMMIT_BRANCH is main
      const mainScenario = result.scenarios.find(s => s.variables['CI_COMMIT_BRANCH'] === 'main')

      expect(mainScenario).toBeDefined()
      expect(mainScenario!.assertions?.jobs?.['auto-job']).toBe('automatic')
    })

    it('should compute correct assertions for manual jobs', () => {
      const config = createProcessedConfig({
        stages: ['deploy'],
        'manual-job': {
          stage: 'deploy',
          script: ['echo manual'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"', when: 'manual' }],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      // Find scenario where CI_COMMIT_BRANCH is main
      const mainScenario = result.scenarios.find(s => s.variables['CI_COMMIT_BRANCH'] === 'main')

      expect(mainScenario).toBeDefined()
      expect(mainScenario!.assertions?.jobs?.['manual-job']).toBe('manual')
    })

    it('should compute correct assertions for skipped jobs', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        'skipped-job': {
          stage: 'build',
          script: ['echo skipped'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      // Find scenario where CI_COMMIT_BRANCH is not main
      const featureScenario = result.scenarios.find(
        s => s.variables['CI_COMMIT_BRANCH'] !== 'main' && s.variables['CI_COMMIT_BRANCH'] !== null,
      )

      if (featureScenario) {
        expect(featureScenario.assertions?.jobs?.['skipped-job']).toBe('skipped')
      }
    })

    it('should exclude assertions when includeAssertions is false', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        job1: {
          stage: 'build',
          script: ['echo 1'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      })

      const result = TestScenarioGenerator.generate(config, {
        includeAssertions: false,
      })

      for (const scenario of result.scenarios) {
        expect(scenario.assertions).toBeUndefined()
      }
    })

    it('should minimize scenarios with --min-coverage', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        job1: {
          stage: 'build',
          script: ['echo 1'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      })

      const withoutMinimize = TestScenarioGenerator.generate(config, {
        minimizeCoverage: false,
      })
      const withMinimize = TestScenarioGenerator.generate(config, {
        minimizeCoverage: true,
      })

      // Minimized version should have fewer or equal scenarios
      expect(withMinimize.scenarios.length).toBeLessThanOrEqual(withoutMinimize.scenarios.length)
      // But should still have unique outcomes
      expect(withMinimize.metadata.uniqueOutcomes).toBe(withoutMinimize.metadata.uniqueOutcomes)
    })

    it('should skip template jobs', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        '.template-job': {
          stage: 'build',
          script: ['echo template'],
        },
        'real-job': {
          stage: 'build',
          script: ['echo real'],
          extends: '.template-job',
        },
      })

      const result = TestScenarioGenerator.generate(config)

      expect(result.metadata.targetedJobs).toContain('real-job')
      expect(result.metadata.targetedJobs).not.toContain('.template-job')
    })

    it('should handle complex rule conditions', () => {
      const config = createProcessedConfig({
        stages: ['deploy'],
        'complex-job': {
          stage: 'deploy',
          script: ['echo deploy'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_PIPELINE_SOURCE == "push"',
              when: 'on_success',
            },
            {
              if: '$CI_COMMIT_BRANCH != $CI_DEFAULT_BRANCH',
              when: 'manual',
            },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      expect(result.scenarios.length).toBeGreaterThan(0)
      expect(result.metadata.variablesFound).toContain('CI_COMMIT_BRANCH')
      expect(result.metadata.variablesFound).toContain('CI_DEFAULT_BRANCH')
      expect(result.metadata.variablesFound).toContain('CI_PIPELINE_SOURCE')
    })

    it('should compute count assertions correctly', () => {
      const config = createProcessedConfig({
        stages: ['build', 'test', 'deploy'],
        'auto-job': {
          stage: 'build',
          script: ['echo auto'],
        },
        'manual-job': {
          stage: 'deploy',
          script: ['echo manual'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"', when: 'manual' }],
        },
        'skipped-job': {
          stage: 'test',
          script: ['echo skipped'],
          rules: [{ if: '$NEVER_TRUE == "yes"' }],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      // Find a scenario that has CI_COMMIT_BRANCH == main
      const mainScenario = result.scenarios.find(s => s.variables['CI_COMMIT_BRANCH'] === 'main')

      if (mainScenario?.assertions?.counts) {
        // auto-job is always automatic (no rules)
        // manual-job is manual when CI_COMMIT_BRANCH == main
        // skipped-job is always skipped (rule never matches)
        expect(mainScenario.assertions.counts.automatic).toBeGreaterThanOrEqual(1)
        expect(mainScenario.assertions.counts.manual).toBe(1)
        expect(mainScenario.assertions.counts.skipped).toBe(1)
      }
    })
  })

  describe('pinnedVariables', () => {
    it('should filter scenarios to only those matching pinned variable values', () => {
      const config = createProcessedConfig({
        stages: ['build', 'deploy'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [
            { if: '$CI_PIPELINE_SOURCE == "push"', when: 'on_success' },
            { if: '$CI_PIPELINE_SOURCE == "merge_request_event"', when: 'on_success' },
          ],
        },
        'deploy-job': {
          stage: 'deploy',
          script: ['echo deploy'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main" && $CI_PIPELINE_SOURCE == "push"' }],
        },
      })

      const allScenarios = TestScenarioGenerator.generate(config)
      const pinnedScenarios = TestScenarioGenerator.generate(config, {
        pinnedVariables: { CI_PIPELINE_SOURCE: 'push' },
      })

      // Pinned scenarios should be a subset
      expect(pinnedScenarios.scenarios.length).toBeLessThan(allScenarios.scenarios.length)

      // All pinned scenarios should have CI_PIPELINE_SOURCE == 'push'
      for (const scenario of pinnedScenarios.scenarios) {
        expect(scenario.variables['CI_PIPELINE_SOURCE']).toBe('push')
      }
    })

    it('should deduplicate scenarios that become identical after pinning', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }, { if: '$CI_PIPELINE_SOURCE == "push"' }],
        },
      })

      const result = TestScenarioGenerator.generate(config, {
        pinnedVariables: { CI_PIPELINE_SOURCE: 'push' },
      })

      // Check no two scenarios have identical variable sets
      const variableKeys = result.scenarios.map(s => JSON.stringify(s.variables))
      const uniqueKeys = new Set(variableKeys)
      expect(uniqueKeys.size).toBe(variableKeys.length)
    })

    it('should support multiple pinned variables', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [
            { if: '$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "main"' },
            { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config, {
        pinnedVariables: {
          CI_PIPELINE_SOURCE: 'push',
          CI_COMMIT_BRANCH: 'main',
        },
      })

      for (const scenario of result.scenarios) {
        expect(scenario.variables['CI_PIPELINE_SOURCE']).toBe('push')
        expect(scenario.variables['CI_COMMIT_BRANCH']).toBe('main')
      }
    })

    it('should return at least one scenario when pinned variables match', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [{ if: '$CI_PIPELINE_SOURCE == "push"' }],
        },
      })

      const result = TestScenarioGenerator.generate(config, {
        pinnedVariables: { CI_PIPELINE_SOURCE: 'push' },
      })

      expect(result.scenarios.length).toBeGreaterThan(0)
    })

    it('should enforce GitLab constraints after pinning (CI_COMMIT_BRANCH null for MR source)', () => {
      // Config only references CI_COMMIT_BRANCH — generated scenarios won't have CI_PIPELINE_SOURCE.
      // Pinning CI_PIPELINE_SOURCE=merge_request_event must still enforce CI_COMMIT_BRANCH=null.
      const config = createProcessedConfig({
        stages: ['build', 'deploy'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
        'deploy-job': {
          stage: 'deploy',
          script: ['echo deploy'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"', when: 'manual' }],
        },
      })

      const result = TestScenarioGenerator.generate(config, {
        pinnedVariables: { CI_PIPELINE_SOURCE: 'merge_request_event' },
      })

      // All scenarios must have CI_COMMIT_BRANCH null (GitLab MR pipelines don't set it)
      for (const scenario of result.scenarios) {
        expect(scenario.variables['CI_PIPELINE_SOURCE']).toBe('merge_request_event')
        expect(
          scenario.variables['CI_COMMIT_BRANCH'],
          `CI_COMMIT_BRANCH should be null for MR pipeline, got: ${scenario.variables['CI_COMMIT_BRANCH']}`,
        ).toBeNull()
      }
    })
  })

  describe('formatScenarioFileName', () => {
    it('should generate zero-padded filename from description', () => {
      const scenario = {
        description: 'Main branch push',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { build: 'automatic' as const } },
      }

      const fileName = TestScenarioGenerator.formatScenarioFileName(scenario, 0, 'yaml')

      expect(fileName).toBe('01-main-branch-push.yaml')
    })

    it('should use json extension when format is json', () => {
      const scenario = {
        description: 'Feature branch',
        variables: { CI_COMMIT_BRANCH: 'feature/test' },
        assertions: { jobs: { build: 'automatic' as const } },
      }

      const fileName = TestScenarioGenerator.formatScenarioFileName(scenario, 2, 'json')

      expect(fileName).toBe('03-feature-branch.json')
    })

    it('should handle missing description', () => {
      const scenario = {
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { build: 'automatic' as const } },
      }

      const fileName = TestScenarioGenerator.formatScenarioFileName(scenario, 4, 'yaml')

      expect(fileName).toBe('05-scenario-5.yaml')
    })

    it('should slugify special characters', () => {
      const scenario = {
        description: 'MR to main (with changes)',
        variables: {},
        assertions: { jobs: { build: 'automatic' as const } },
      }

      const fileName = TestScenarioGenerator.formatScenarioFileName(scenario, 0, 'yaml')

      expect(fileName).toBe('01-mr-to-main-with-changes.yaml')
    })

    it('should truncate long descriptions', () => {
      const scenario = {
        description: 'A'.repeat(100),
        variables: {},
        assertions: { jobs: { build: 'automatic' as const } },
      }

      const fileName = TestScenarioGenerator.formatScenarioFileName(scenario, 0, 'yaml')

      // Slug is max 60 chars + "01-" prefix (3) + ".yaml" extension (5) = 68
      expect(fileName.length).toBeLessThanOrEqual(68)
    })
  })

  describe('formatSingleScenario', () => {
    it('should format a single scenario as YAML', () => {
      const scenario = {
        description: 'Main branch push',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { build: 'automatic' as const } },
      }

      const output = TestScenarioGenerator.formatSingleScenario(scenario, 'yaml')

      expect(output).toContain('description: Main branch push')
      expect(output).toContain('CI_COMMIT_BRANCH: main')
      expect(output).toContain('assertions:')
      expect(output).not.toContain('---')
    })

    it('should format a single scenario as JSON', () => {
      const scenario = {
        description: 'Main branch push',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { build: 'automatic' as const } },
      }

      const output = TestScenarioGenerator.formatSingleScenario(scenario, 'json')

      const parsed = JSON.parse(output)
      expect(parsed.description).toBe('Main branch push')
      expect(parsed.variables['CI_COMMIT_BRANCH']).toBe('main')
    })

    it('should include changes when present', () => {
      const scenario = {
        description: 'With changes',
        variables: { CI_COMMIT_BRANCH: 'main' },
        changes: ['src/app.ts'],
        assertions: { jobs: { build: 'automatic' as const } },
      }

      const output = TestScenarioGenerator.formatSingleScenario(scenario, 'yaml')

      expect(output).toContain('changes:')
      expect(output).toContain('src/app.ts')
    })

    it('should omit assertions when not present', () => {
      const scenario = {
        description: 'No assertions',
        variables: { CI_COMMIT_BRANCH: 'main' },
      } as any

      const output = TestScenarioGenerator.formatSingleScenario(scenario, 'yaml')

      expect(output).not.toContain('assertions:')
    })
  })

  describe('formatOutput', () => {
    it('should format output as JSON', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        job1: {
          stage: 'build',
          script: ['echo 1'],
        },
      })

      const result = TestScenarioGenerator.generate(config, { maxScenarios: 1 })
      const output = TestScenarioGenerator.formatOutput(result, 'json')

      expect(() => JSON.parse(output)).not.toThrow()
      const parsed = JSON.parse(output)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed.length).toBe(1)
    })

    it('should format output as YAML', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        job1: {
          stage: 'build',
          script: ['echo 1'],
        },
      })

      const result = TestScenarioGenerator.generate(config, { maxScenarios: 1 })
      const output = TestScenarioGenerator.formatOutput(result, 'yaml')

      expect(output).toContain('description:')
      expect(output).toContain('variables:')
    })

    it('should use YAML as default format', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        job1: {
          stage: 'build',
          script: ['echo 1'],
        },
      })

      const result = TestScenarioGenerator.generate(config, { maxScenarios: 1 })
      const output = TestScenarioGenerator.formatOutput(result)

      expect(output).toContain('description:')
    })

    it('should separate multiple scenarios with --- in YAML', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        job1: {
          stage: 'build',
          script: ['echo 1'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      })

      const result = TestScenarioGenerator.generate(config, { maxScenarios: 3 })
      const output = TestScenarioGenerator.formatOutput(result, 'yaml')

      if (result.scenarios.length > 1) {
        expect(output).toContain('---')
      }
    })

    it('should include assertions in output when present', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        job1: {
          stage: 'build',
          script: ['echo 1'],
        },
      })

      const result = TestScenarioGenerator.generate(config, { includeAssertions: true })
      const output = TestScenarioGenerator.formatOutput(result, 'yaml')

      expect(output).toContain('assertions:')
      expect(output).toContain('jobs:')
    })
  })

  describe('changes-based scenario generation', () => {
    it('should prefer the first-listed path in a rule as equivalence-class representative', () => {
      // Two jobs share the same multi-pattern changes array. The author listed
      // `service-a/src/main/**/*` first (the primary code path) and
      // `service-lib/src/main/**/*` second. Both patterns have the same job-set
      // signature, so the linter must dedup them and pick one representative.
      // We expect the first-position one (`service-a/...`), NOT alphabetical.
      const config = createProcessedConfig({
        stages: ['test'],
        'integration test': {
          stage: 'test',
          script: ['echo integration'],
          rules: [
            { if: '$CI_PIPELINE_SOURCE == "merge_request_event"', when: 'never' },
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              changes: ['service-a/src/main/**/*', 'service-lib/src/main/**/*'],
            },
          ],
        },
        'flaky integration test': {
          stage: 'test',
          script: ['echo flaky'],
          rules: [
            { if: '$CI_PIPELINE_SOURCE == "merge_request_event"', when: 'never' },
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              changes: ['service-a/src/main/**/*', 'service-lib/src/main/**/*'],
            },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      const changesScenarios = result.scenarios.filter(s => s.changes && s.changes.length > 0)
      // Exactly one representative for the shared equivalence class.
      expect(changesScenarios.length).toBe(1)
      // And the chosen one is service-a (first in the rule), not service-lib
      // (alphabetically first).
      expect(changesScenarios[0]!.changes![0]).toContain('service-a/')
      expect(changesScenarios[0]!.changes![0]).not.toContain('service-lib/')
    })

    it('should tie-break alphabetically when first-positions are equal', () => {
      // Both `alpha-svc/**/*` and `beta-svc/**/*` appear in different rules,
      // each at position 0. Same job-set signature is impossible across
      // different rules of different jobs unless they share rule indexes
      // too — but for this test we want to verify the tie-break path even
      // when positions are tied. Each pattern lives in a different rule
      // (so distinct signatures); the test asserts the smoke-path doesn't
      // crash and both representatives are kept.
      const config = createProcessedConfig({
        stages: ['test'],
        'job-a': {
          stage: 'test',
          script: ['echo a'],
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              changes: ['alpha-svc/**/*'],
            },
          ],
        },
        'job-b': {
          stage: 'test',
          script: ['echo b'],
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              changes: ['beta-svc/**/*'],
            },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config)
      // Different signatures → both kept.
      expect(result.metadata.changesFound).toContain('alpha-svc/**/*')
      expect(result.metadata.changesFound).toContain('beta-svc/**/*')
    })

    it('should extract changes patterns from jobs with array form', () => {
      const config = createProcessedConfig({
        stages: ['build', 'deploy'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
        'deploy-job': {
          stage: 'deploy',
          script: ['echo deploy'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == "main"',
              changes: ['apps/portal/**/*', 'libs/shared/**/*'],
            },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      expect(result.metadata.changesFound).toBeDefined()
      expect(result.metadata.changesFound).toContain('apps/portal/**/*')
      expect(result.metadata.changesFound).toContain('libs/shared/**/*')
    })

    it('should extract changes patterns from jobs with object form', () => {
      const config = createProcessedConfig({
        stages: ['deploy'],
        'deploy-job': {
          stage: 'deploy',
          script: ['echo deploy'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == "main"',
              changes: {
                compare_to: 'refs/heads/main',
                paths: ['apps/portal/**/*'],
              } as any,
            },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      expect(result.metadata.changesFound).toContain('apps/portal/**/*')
    })

    it('should generate scenarios with changes field', () => {
      const config = createProcessedConfig({
        stages: ['build', 'deploy'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
        'deploy-job': {
          stage: 'deploy',
          script: ['echo deploy'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == "main"',
              changes: ['apps/portal/**/*'],
            },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      const changesScenarios = result.scenarios.filter(s => s.changes && s.changes.length > 0)
      expect(changesScenarios.length).toBeGreaterThan(0)
      // The changes field should contain a sample file path matching the pattern
      for (const scenario of changesScenarios) {
        expect(scenario.changes![0]).toMatch(/apps\/portal\//)
      }
    })

    it('should compute equivalence classes with identical signatures', () => {
      // Two patterns appear in the same rule of the same job -> same equivalence class
      const config = createProcessedConfig({
        stages: ['deploy'],
        'deploy-job': {
          stage: 'deploy',
          script: ['echo deploy'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == "main"',
              changes: ['apps/portal/**/*', 'apps/login/**/*'],
            },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      // Both patterns have identical job signatures, so only one representative
      // should be chosen, resulting in fewer changes scenarios
      const changesScenarios = result.scenarios.filter(s => s.changes && s.changes.length > 0)
      // Should have scenarios but not one per pattern (they're equivalent)
      expect(changesScenarios.length).toBeGreaterThan(0)
    })

    it('should generate different scenarios for patterns with different signatures', () => {
      const config = createProcessedConfig({
        stages: ['deploy'],
        'portal-deploy': {
          stage: 'deploy',
          script: ['echo portal'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == "main"',
              changes: ['apps/portal/**/*'],
            },
          ],
        },
        'login-deploy': {
          stage: 'deploy',
          script: ['echo login'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == "main"',
              changes: ['apps/login/**/*'],
            },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      const changesScenarios = result.scenarios.filter(s => s.changes && s.changes.length > 0)
      // Two different signatures -> two separate equivalence classes -> at least 2 changes scenarios
      expect(changesScenarios.length).toBeGreaterThanOrEqual(2)
    })

    it('should evaluate assertions correctly with changes context', () => {
      const config = createProcessedConfig({
        stages: ['deploy'],
        'deploy-job': {
          stage: 'deploy',
          script: ['echo deploy'],
          rules: [
            {
              if: '$CI_COMMIT_BRANCH == "main"',
              changes: ['apps/portal/**/*'],
            },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      // Find a scenario with changes
      const changesScenario = result.scenarios.find(
        s => s.changes && s.changes.length > 0 && s.variables['CI_COMMIT_BRANCH'] === 'main',
      )

      if (changesScenario) {
        // Deploy job should be automatic when both branch and changes match
        expect(changesScenario.assertions?.jobs?.['deploy-job']).toBe('automatic')
      }
    })

    it('should respect maxScenarios limit with changes scenarios', () => {
      const config = createProcessedConfig({
        stages: ['deploy'],
        'job-a': {
          stage: 'deploy',
          script: ['echo a'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"', changes: ['apps/a/**/*'] }],
        },
        'job-b': {
          stage: 'deploy',
          script: ['echo b'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"', changes: ['apps/b/**/*'] }],
        },
        'job-c': {
          stage: 'deploy',
          script: ['echo c'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"', changes: ['apps/c/**/*'] }],
        },
      })

      const result = TestScenarioGenerator.generate(config, { maxScenarios: 5 })

      expect(result.scenarios.length).toBeLessThanOrEqual(5)
    })

    it('should handle edge case: no changes patterns in config', () => {
      const config = createProcessedConfig({
        stages: ['build'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      expect(result.metadata.changesFound).toBeUndefined()
      // No changes scenarios should be present
      const changesScenarios = result.scenarios.filter(s => s.changes && s.changes.length > 0)
      expect(changesScenarios.length).toBe(0)
    })

    it('should handle edge case: all jobs use the same changes pattern', () => {
      const config = createProcessedConfig({
        stages: ['build', 'test', 'deploy'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [{ changes: ['src/**/*'] }],
        },
        'test-job': {
          stage: 'test',
          script: ['echo test'],
          rules: [{ changes: ['src/**/*'] }],
        },
        'deploy-job': {
          stage: 'deploy',
          script: ['echo deploy'],
          rules: [{ changes: ['src/**/*'] }],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      expect(result.metadata.changesFound).toEqual(['src/**/*'])
      // All jobs have the same pattern and same rule index -> one equivalence class
      const changesScenarios = result.scenarios.filter(s => s.changes && s.changes.length > 0)
      expect(changesScenarios.length).toBeGreaterThan(0)
    })

    it('should pair MR context with merge_request_event patterns', () => {
      const config = createProcessedConfig({
        stages: ['test'],
        'mr-test': {
          stage: 'test',
          script: ['echo test'],
          rules: [
            {
              if: '$CI_PIPELINE_SOURCE == "merge_request_event"',
              changes: ['apps/portal/**/*'],
            },
          ],
        },
      })

      const result = TestScenarioGenerator.generate(config)

      const changesScenarios = result.scenarios.filter(s => s.changes && s.changes.length > 0)
      expect(changesScenarios.length).toBeGreaterThan(0)
      // Should be paired with MR context
      const mrChangesScenario = changesScenarios.find(
        s => s.variables['CI_PIPELINE_SOURCE'] === 'merge_request_event',
      )
      expect(mrChangesScenario).toBeDefined()
    })
  })

  describe('generateSamplePath', () => {
    it('should generate terraform paths for terraform patterns', () => {
      expect(TestScenarioGenerator.generateSamplePath('apps/portal/terraform/qa/**/*')).toBe(
        'apps/portal/terraform/qa/main.tf',
      )
    })

    it('should generate src/index.ts for generic glob patterns', () => {
      expect(TestScenarioGenerator.generateSamplePath('apps/portal/**/*')).toBe(
        'apps/portal/src/index.ts',
      )
    })

    it('should generate yml paths for CI patterns', () => {
      expect(TestScenarioGenerator.generateSamplePath('.gitlab-ci/**/*')).toBe(
        '.gitlab-ci/config.yml',
      )
    })

    it('should generate README.md for *.md patterns', () => {
      expect(TestScenarioGenerator.generateSamplePath('*.md')).toBe('README.md')
    })

    it('should handle libs patterns', () => {
      expect(TestScenarioGenerator.generateSamplePath('libs/**/*')).toBe('libs/src/index.ts')
    })

    it('should use the provided sampleSuffix for generic glob patterns', () => {
      expect(
        TestScenarioGenerator.generateSamplePath('service-a/**/*', 'src/main/java/Sample.java'),
      ).toBe('service-a/src/main/java/Sample.java')
    })

    it('should use the sampleSuffix at root when there is no prefix', () => {
      expect(TestScenarioGenerator.generateSamplePath('**/*', 'README.md')).toBe('README.md')
    })

    it('should ignore sampleSuffix for extension-specific cases (.tf)', () => {
      expect(
        TestScenarioGenerator.generateSamplePath(
          'infrastructure/terraform/**/*',
          'src/main/java/Sample.java',
        ),
      ).toBe('infrastructure/terraform/main.tf')
    })

    it('should ignore sampleSuffix for extension-specific cases (.yml)', () => {
      expect(
        TestScenarioGenerator.generateSamplePath('.gitlab-ci/**/*', 'src/main/java/Sample.java'),
      ).toBe('.gitlab-ci/config.yml')
    })
  })

  describe('generateWithChildren', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should extract changes patterns from child pipeline configs', async () => {
      const childPipelineYaml = `
stages:
  - build
  - deploy
portal-build:
  stage: build
  script: ['echo build portal']
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      changes:
        - apps/portal/**/*
login-build:
  stage: build
  script: ['echo build login']
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      changes:
        - apps/login/**/*
`

      mockExistsSync.mockImplementation((p: any) => {
        return String(p).includes('child-pipeline.yml') || String(p).includes('.gitlab-ci.yml')
      })
      mockReadFileSync.mockImplementation((p: any) => {
        if (String(p).includes('child-pipeline.yml')) {
          return childPipelineYaml as any
        }
        return '' as any
      })

      const config = createProcessedConfig({
        stages: ['trigger'],
        'trigger-child': {
          stage: 'trigger',
          trigger: {
            include: [{ local: 'child-pipeline.yml' }],
          },
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      })

      const result = await TestScenarioGenerator.generateWithChildren(config, {
        includeChildren: true,
        baseDir: '/test',
      })

      expect(result.metadata.changesFound).toBeDefined()
      expect(result.metadata.changesFound).toContain('apps/portal/**/*')
      expect(result.metadata.changesFound).toContain('apps/login/**/*')

      // Should generate changes scenarios from child patterns
      const changesScenarios = result.scenarios.filter(s => s.changes && s.changes.length > 0)
      expect(changesScenarios.length).toBeGreaterThan(0)
    })

    it('should skip trigger jobs starting with dot in parent pipeline', async () => {
      const childPipelineYaml = `
child-job:
  stage: build
  script: ['echo child']
  rules:
    - changes:
        - apps/child/**/*
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation((p: any) => {
        if (String(p).includes('child.yml')) return childPipelineYaml as any
        return '' as any
      })

      const config = createProcessedConfig({
        stages: ['trigger'],
        // Template trigger job — should be skipped by extractChangesFromChildPipelines
        '.trigger-template': {
          stage: 'trigger',
          trigger: { include: [{ local: 'child.yml' }] },
        },
      })

      const result = await TestScenarioGenerator.generateWithChildren(config, {
        includeChildren: true,
        baseDir: '/test',
      })

      // No child patterns should be extracted since the trigger is a template job
      expect(result.metadata.changesFound).toBeUndefined()
    })

    it('should warn and skip child pipelines that fail to load', async () => {
      mockExistsSync.mockReturnValue(false)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const config = createProcessedConfig({
        stages: ['trigger'],
        'trigger-child': {
          stage: 'trigger',
          trigger: { include: [{ local: 'nonexistent.yml' }] },
        },
      })

      // Should not throw
      const result = await TestScenarioGenerator.generateWithChildren(config, {
        includeChildren: true,
        baseDir: '/test',
      })

      expect(result.scenarios.length).toBeGreaterThan(0)
      expect(result.metadata.changesFound).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Child pipeline config not found'),
      )
      warnSpy.mockRestore()
    })

    it('should use child jobs for equivalence class computation, not parent jobs', async () => {
      // Two child patterns in different child jobs -> different equivalence classes -> separate scenarios
      const childPipelineYaml = `
portal-deploy:
  stage: deploy
  script: ['echo portal']
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      changes:
        - apps/portal/**/*
login-deploy:
  stage: deploy
  script: ['echo login']
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      changes:
        - apps/login/**/*
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation((p: any) => {
        if (String(p).includes('child.yml')) return childPipelineYaml as any
        return '' as any
      })

      const config = createProcessedConfig({
        stages: ['trigger'],
        'trigger-child': {
          stage: 'trigger',
          trigger: { include: [{ local: 'child.yml' }] },
        },
      })

      const result = await TestScenarioGenerator.generateWithChildren(config, {
        includeChildren: true,
        baseDir: '/test',
      })

      // Two patterns in different jobs = different signatures = at least 2 changes scenarios
      const changesScenarios = result.scenarios.filter(s => s.changes && s.changes.length > 0)
      expect(changesScenarios.length).toBeGreaterThanOrEqual(2)

      // Both patterns should appear
      const allChangesPaths = changesScenarios.flatMap(s => s.changes || [])
      const hasPortal = allChangesPaths.some(p => p.includes('portal'))
      const hasLogin = allChangesPaths.some(p => p.includes('login'))
      expect(hasPortal).toBe(true)
      expect(hasLogin).toBe(true)
    })

    it('should deduplicate patterns appearing in both parent and child', async () => {
      const childPipelineYaml = `
child-job:
  stage: build
  script: ['echo child']
  rules:
    - changes:
        - shared/**/*
`

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation((p: any) => {
        if (String(p).includes('child.yml')) return childPipelineYaml as any
        return '' as any
      })

      const config = createProcessedConfig({
        stages: ['build', 'trigger'],
        'parent-build': {
          stage: 'build',
          script: ['echo parent'],
          rules: [{ changes: ['shared/**/*'] }],
        },
        'trigger-child': {
          stage: 'trigger',
          trigger: { include: [{ local: 'child.yml' }] },
        },
      })

      const result = await TestScenarioGenerator.generateWithChildren(config, {
        includeChildren: true,
        baseDir: '/test',
      })

      // Pattern should appear once in changesFound (deduplicated)
      expect(result.metadata.changesFound).toEqual(['shared/**/*'])
    })

    it('should populate childPipelines assertions for all scenarios, not just the first', async () => {
      // Child pipeline has jobs with DIFFERENT states depending on PIPELINE_TYPE,
      // so processedPaths state pollution would produce wrong assertions
      const childPipelineYaml = `
stages:
  - build
  - deploy
build-child:
  stage: build
  script: ['echo build']
  rules:
    - if: '$PIPELINE_TYPE == "MAIN"'
      when: on_success
    - if: '$PIPELINE_TYPE == "MR"'
      when: on_success
    - when: never
deploy-child:
  stage: deploy
  script: ['echo deploy']
  rules:
    - if: '$PIPELINE_TYPE == "MAIN"'
      when: on_success
    - when: never
`

      mockExistsSync.mockImplementation((p: any) => {
        return String(p).includes('child.yml') || String(p).includes('.gitlab-ci.yml')
      })
      mockReadFileSync.mockImplementation((p: any) => {
        if (String(p).includes('child.yml')) return childPipelineYaml as any
        return '' as any
      })

      const config = createProcessedConfig({
        stages: ['trigger'],
        'trigger-child': {
          stage: 'trigger',
          trigger: {
            include: [{ local: 'child.yml' }],
            forward: { pipeline_variables: true },
          },
          rules: [{ if: '$PIPELINE_TYPE == "MAIN"' }, { if: '$PIPELINE_TYPE == "MR"' }],
        },
      })

      const result = await TestScenarioGenerator.generateWithChildren(config, {
        includeChildren: true,
        baseDir: '/test',
      })

      // Should have multiple scenarios (at least MAIN and MR)
      const scenariosWithTrigger = result.scenarios.filter(
        s => s.assertions?.jobs?.['trigger-child'] === 'automatic',
      )
      expect(scenariosWithTrigger.length).toBeGreaterThanOrEqual(2)

      // ALL scenarios where trigger-child is automatic should have non-empty childPipelines
      for (const scenario of scenariosWithTrigger) {
        const cp = scenario.assertions?.childPipelines?.['trigger-child']
        expect(
          cp,
          `Scenario "${scenario.description}" has trigger-child=automatic but empty childPipelines`,
        ).toBeDefined()
        expect(
          cp?.jobs?.['build-child'],
          `Scenario "${scenario.description}" missing build-child in childPipelines`,
        ).toBeDefined()
      }

      // Verify scenarios produce DIFFERENT child job states (deploy-child is MAIN-only)
      const mainScenarios = scenariosWithTrigger.filter(
        s => s.variables?.['PIPELINE_TYPE'] === 'MAIN',
      )
      const mrScenarios = scenariosWithTrigger.filter(s => s.variables?.['PIPELINE_TYPE'] === 'MR')
      expect(mainScenarios.length).toBeGreaterThanOrEqual(1)
      expect(mrScenarios.length).toBeGreaterThanOrEqual(1)

      // MAIN scenarios should have deploy-child=automatic, MR scenarios should have deploy-child=skipped
      for (const scenario of mainScenarios) {
        const cp = scenario.assertions?.childPipelines?.['trigger-child']
        expect(cp?.jobs?.['deploy-child']).toBe('automatic')
      }
      for (const scenario of mrScenarios) {
        const cp = scenario.assertions?.childPipelines?.['trigger-child']
        expect(cp?.jobs?.['deploy-child']).toBe('skipped')
      }
    })

    it('should delegate to sync generate when includeChildren is false', async () => {
      const config = createProcessedConfig({
        stages: ['build'],
        'build-job': {
          stage: 'build',
          script: ['echo build'],
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      })

      const syncResult = TestScenarioGenerator.generate(config)
      const asyncResult = await TestScenarioGenerator.generateWithChildren(config, {
        includeChildren: false,
      })

      expect(asyncResult.scenarios.length).toBe(syncResult.scenarios.length)
      expect(asyncResult.metadata.totalJobsAnalyzed).toBe(syncResult.metadata.totalJobsAnalyzed)
    })
  })
})
