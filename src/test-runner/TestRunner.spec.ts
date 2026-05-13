import { describe, expect, it } from 'vitest'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig'
import { TestRunner } from './TestRunner'
import type { TestScenario } from './types'

const mockContext = (filePath = '/path/to/file.yml'): ProcessingContext => ({
  filePath,
  baseDir: '/path/to',
  includedFiles: new Set<string>(),
  includeStack: [],
  remoteJobs: new Set<string>(),
  gitlabHost: 'gitlab.example.com',
})

describe('TestRunner', () => {
  describe('runTest', () => {
    it('should pass when all assertions match', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build', 'test', 'deploy'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
          },
          'test-job': {
            script: ['echo test'],
            stage: 'test',
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
          },
          'deploy-job': {
            script: ['echo deploy'],
            stage: 'deploy',
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"', when: 'manual' }],
          },
        },
        mockContext(),
      )

      const scenario: TestScenario = {
        description: 'Main branch push',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: {
          jobs: {
            'build-job': 'automatic',
            'test-job': 'automatic',
            'deploy-job': 'manual',
          },
          counts: {
            automatic: 2,
            manual: 1,
            skipped: 0,
            total: 3,
          },
        },
      }

      const result = TestRunner.runTest(scenario, config)

      expect(result.passed).toBe(true)
      expect(result.summary.total).toBe(7)
      expect(result.summary.passed).toBe(7)
      expect(result.summary.failed).toBe(0)
      expect(result.description).toBe('Main branch push')
    })

    it('should fail when job assertion does not match', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
            rules: [{ when: 'manual' }],
          },
        },
        mockContext(),
      )

      const scenario: TestScenario = {
        variables: {},
        assertions: {
          jobs: {
            'build-job': 'automatic', // Wrong - it's actually manual
          },
        },
      }

      const result = TestRunner.runTest(scenario, config)

      expect(result.passed).toBe(false)
      expect(result.summary.failed).toBe(1)
      expect(result.assertions[0]?.passed).toBe(false)
      expect(result.assertions[0]?.expected).toBe('automatic')
      expect(result.assertions[0]?.actual).toBe('manual')
    })

    it('should fail when count assertion does not match', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build', 'test'],
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

      const scenario: TestScenario = {
        variables: {},
        assertions: {
          counts: {
            automatic: 5, // Wrong - there are only 2
          },
        },
      }

      const result = TestRunner.runTest(scenario, config)

      expect(result.passed).toBe(false)
      expect(result.assertions[0]?.expected).toBe(5)
      expect(result.assertions[0]?.actual).toBe(2)
    })

    it('should handle skipped jobs', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build', 'deploy'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
          },
          'deploy-job': {
            script: ['echo deploy'],
            stage: 'deploy',
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
          },
        },
        mockContext(),
      )

      const scenario: TestScenario = {
        description: 'Feature branch',
        variables: { CI_COMMIT_BRANCH: 'feature-x' },
        assertions: {
          jobs: {
            'build-job': 'automatic',
            'deploy-job': 'skipped',
          },
          counts: {
            automatic: 1,
            skipped: 1,
          },
        },
      }

      const result = TestRunner.runTest(scenario, config)

      expect(result.passed).toBe(true)
    })

    it('should include evaluation results', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
          },
        },
        mockContext(),
      )

      const scenario: TestScenario = {
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: {
          jobs: { 'build-job': 'automatic' },
        },
      }

      const result = TestRunner.runTest(scenario, config)

      expect(result.evaluation).toBeDefined()
      expect(result.evaluation.jobs).toHaveLength(1)
      expect(result.evaluation.jobs[0]?.name).toBe('build-job')
      expect(result.context).toEqual({ variables: { CI_COMMIT_BRANCH: 'main' } })
    })

    it('should handle changes in context', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
            rules: [{ changes: ['src/*.ts'] }],
          },
        },
        mockContext(),
      )

      const scenario: TestScenario = {
        variables: {},
        changes: ['src/app.ts'],
        assertions: {
          jobs: { 'build-job': 'automatic' },
        },
      }

      const result = TestRunner.runTest(scenario, config)

      expect(result.passed).toBe(true)
      expect(result.context.changes).toEqual(['src/app.ts'])
    })
  })

  describe('validateScenario', () => {
    it('should return undefined for valid scenario', () => {
      const scenario = {
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: {
          jobs: { 'build-job': 'automatic' },
        },
      }

      expect(TestRunner.validateScenario(scenario)).toBeUndefined()
    })

    it('should reject non-object scenario', () => {
      expect(TestRunner.validateScenario(null)).toBe('Test scenario must be an object')
      expect(TestRunner.validateScenario('string')).toBe('Test scenario must be an object')
    })

    it('should reject missing variables', () => {
      const scenario = {
        assertions: { jobs: { 'build-job': 'automatic' } },
      }

      expect(TestRunner.validateScenario(scenario)).toBe(
        "Test scenario must have a 'variables' object",
      )
    })

    it('should reject missing assertions', () => {
      const scenario = {
        variables: { CI_COMMIT_BRANCH: 'main' },
      }

      expect(TestRunner.validateScenario(scenario)).toBe(
        "Test scenario must have an 'assertions' object",
      )
    })

    it('should reject empty assertions', () => {
      const scenario = {
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: {},
      }

      expect(TestRunner.validateScenario(scenario)).toBe(
        "Test scenario must have at least one of 'assertions.jobs', 'assertions.counts', or 'assertions.childPipelines'",
      )
    })

    it('should reject invalid job status', () => {
      const scenario = {
        variables: {},
        assertions: {
          jobs: { 'build-job': 'invalid-status' },
        },
      }

      const error = TestRunner.validateScenario(scenario)
      expect(error).toContain("Invalid job status 'invalid-status'")
      expect(error).toContain('automatic, manual, skipped')
    })

    it('should reject invalid count type', () => {
      const scenario = {
        variables: {},
        assertions: {
          counts: { invalid: 5 },
        },
      }

      const error = TestRunner.validateScenario(scenario)
      expect(error).toContain("Invalid count type 'invalid'")
    })

    it('should reject non-integer count value', () => {
      const scenario = {
        variables: {},
        assertions: {
          counts: { automatic: 2.5 },
        },
      }

      const error = TestRunner.validateScenario(scenario)
      expect(error).toContain("Count 'automatic' must be a non-negative integer")
    })

    it('should reject negative count value', () => {
      const scenario = {
        variables: {},
        assertions: {
          counts: { automatic: -1 },
        },
      }

      const error = TestRunner.validateScenario(scenario)
      expect(error).toContain("Count 'automatic' must be a non-negative integer")
    })

    it('should accept count-only assertions', () => {
      const scenario = {
        variables: {},
        assertions: {
          counts: { total: 5 },
        },
      }

      expect(TestRunner.validateScenario(scenario)).toBeUndefined()
    })

    it('should accept childPipelines-only assertions', () => {
      const scenario = {
        variables: {},
        assertions: {
          childPipelines: {
            'trigger-extension': {
              jobs: { 'build-chrome': 'automatic' },
            },
          },
        },
      }

      expect(TestRunner.validateScenario(scenario)).toBeUndefined()
    })

    it('should validate childPipelines job assertions', () => {
      const scenario = {
        variables: {},
        assertions: {
          childPipelines: {
            'trigger-extension': {
              jobs: { 'build-chrome': 'invalid-status' },
            },
          },
        },
      }

      const error = TestRunner.validateScenario(scenario)
      expect(error).toContain("Invalid job status 'invalid-status'")
    })

    it('should validate childPipelines count assertions', () => {
      const scenario = {
        variables: {},
        assertions: {
          childPipelines: {
            'trigger-extension': {
              counts: { invalid: 5 },
            },
          },
        },
      }

      const error = TestRunner.validateScenario(scenario)
      expect(error).toContain("Invalid count type 'invalid'")
    })

    it('should reject empty childPipelines assertion', () => {
      const scenario = {
        variables: {},
        assertions: {
          childPipelines: {
            'trigger-extension': {},
          },
        },
      }

      const error = TestRunner.validateScenario(scenario)
      expect(error).toContain("must have at least one of 'jobs', 'counts', or 'childPipelines'")
    })

    it('should validate nested childPipelines assertions', () => {
      const scenario = {
        variables: {},
        assertions: {
          childPipelines: {
            'trigger-extension': {
              jobs: { 'build-chrome': 'automatic' },
              childPipelines: {
                'trigger-sub': {
                  jobs: { 'sub-build': 'invalid-status' },
                },
              },
            },
          },
        },
      }

      const error = TestRunner.validateScenario(scenario)
      expect(error).toContain("Invalid job status 'invalid-status'")
    })
  })

  describe('formatTestResult', () => {
    it('should format passing test result', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
          },
        },
        mockContext(),
      )

      const scenario: TestScenario = {
        description: 'Simple test',
        variables: {},
        assertions: {
          jobs: { 'build-job': 'automatic' },
        },
      }

      const result = TestRunner.runTest(scenario, config)
      const formatted = TestRunner.formatTestResult(result, false)

      expect(formatted.some(line => line.includes('Simple test'))).toBe(true)
      expect(formatted.some(line => line.includes('PASSED'))).toBe(true)
      expect(formatted.some(line => line.includes('1/1'))).toBe(true)
    })

    it('should format failing test result', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
            rules: [{ when: 'manual' }],
          },
        },
        mockContext(),
      )

      const scenario: TestScenario = {
        description: 'Failing test',
        variables: {},
        assertions: {
          jobs: { 'build-job': 'automatic' },
        },
      }

      const result = TestRunner.runTest(scenario, config)
      const formatted = TestRunner.formatTestResult(result, false)

      expect(formatted.some(line => line.includes('FAILED'))).toBe(true)
      expect(formatted.some(line => line.includes('expected') && line.includes('automatic'))).toBe(
        true,
      )
    })

    it('should include type labels in output', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
          },
        },
        mockContext(),
      )

      const scenario: TestScenario = {
        variables: {},
        assertions: {
          jobs: { 'build-job': 'automatic' },
          counts: { total: 1 },
        },
      }

      const result = TestRunner.runTest(scenario, config)
      const formatted = TestRunner.formatTestResult(result, false)

      expect(formatted.some(line => line.includes('[job]'))).toBe(true)
      expect(formatted.some(line => line.includes('[count]'))).toBe(true)
    })
  })

  describe('aggregateResults', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'deploy'],
        'build-job': {
          script: ['echo build'],
          stage: 'build',
        },
        'deploy-job': {
          script: ['echo deploy'],
          stage: 'deploy',
          rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
        },
      },
      mockContext(),
    )

    it('should aggregate all-passing results', () => {
      const scenario1: TestScenario = {
        description: 'Main branch',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { 'build-job': 'automatic', 'deploy-job': 'automatic' } },
      }
      const scenario2: TestScenario = {
        description: 'Feature branch',
        variables: { CI_COMMIT_BRANCH: 'feature' },
        assertions: { jobs: { 'build-job': 'automatic', 'deploy-job': 'skipped' } },
      }

      const result1 = TestRunner.runTest(scenario1, config)
      const result2 = TestRunner.runTest(scenario2, config)
      const aggregate = TestRunner.aggregateResults([result1, result2])

      expect(aggregate.passed).toBe(true)
      expect(aggregate.summary.totalScenarios).toBe(2)
      expect(aggregate.summary.passedScenarios).toBe(2)
      expect(aggregate.summary.failedScenarios).toBe(0)
      expect(aggregate.summary.totalAssertions).toBe(4)
      expect(aggregate.summary.passedAssertions).toBe(4)
      expect(aggregate.summary.failedAssertions).toBe(0)
      expect(aggregate.results).toHaveLength(2)
    })

    it('should aggregate with failures', () => {
      const passing: TestScenario = {
        description: 'Passes',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { 'build-job': 'automatic' } },
      }
      const failing: TestScenario = {
        description: 'Fails',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { 'build-job': 'skipped' } }, // Wrong
      }

      const result1 = TestRunner.runTest(passing, config)
      const result2 = TestRunner.runTest(failing, config)
      const aggregate = TestRunner.aggregateResults([result1, result2])

      expect(aggregate.passed).toBe(false)
      expect(aggregate.summary.passedScenarios).toBe(1)
      expect(aggregate.summary.failedScenarios).toBe(1)
      expect(aggregate.summary.failedAssertions).toBe(1)
    })

    it('should handle single result', () => {
      const scenario: TestScenario = {
        description: 'Single',
        variables: {},
        assertions: { jobs: { 'build-job': 'automatic' } },
      }

      const result = TestRunner.runTest(scenario, config)
      const aggregate = TestRunner.aggregateResults([result])

      expect(aggregate.passed).toBe(true)
      expect(aggregate.summary.totalScenarios).toBe(1)
    })
  })

  describe('formatAggregateResult', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build'],
        'build-job': {
          script: ['echo build'],
          stage: 'build',
        },
      },
      mockContext(),
    )

    it('should format all-passing aggregate', () => {
      const scenario: TestScenario = {
        description: 'Simple test',
        variables: {},
        assertions: { jobs: { 'build-job': 'automatic' } },
      }

      const result = TestRunner.runTest(scenario, config)
      const aggregate = TestRunner.aggregateResults([result])
      const formatted = TestRunner.formatAggregateResult(aggregate, false)

      expect(formatted.some(line => line.includes('ALL PASSED'))).toBe(true)
      expect(formatted.some(line => line.includes('Simple test'))).toBe(true)
      expect(formatted.some(line => line.includes('1/1 scenarios'))).toBe(true)
    })

    it('should format failing aggregate with inline failures', () => {
      const scenario: TestScenario = {
        description: 'Failing test',
        variables: {},
        assertions: { jobs: { 'build-job': 'skipped' } }, // Wrong
      }

      const result = TestRunner.runTest(scenario, config)
      const aggregate = TestRunner.aggregateResults([result])
      const formatted = TestRunner.formatAggregateResult(aggregate, false)

      expect(formatted.some(line => line.includes('FAILED'))).toBe(true)
      expect(formatted.some(line => line.includes('expected') && line.includes('skipped'))).toBe(
        true,
      )
    })
  })

  describe('toAggregateJson', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build'],
        'build-job': {
          script: ['echo build'],
          stage: 'build',
        },
      },
      mockContext(),
    )

    it('should create JSON-serializable aggregate object', () => {
      const scenario: TestScenario = {
        description: 'Test',
        variables: {},
        assertions: { jobs: { 'build-job': 'automatic' } },
      }

      const result = TestRunner.runTest(scenario, config)
      const aggregate = TestRunner.aggregateResults([result])
      const json = TestRunner.toAggregateJson(aggregate)

      expect(() => JSON.stringify(json)).not.toThrow()

      const parsed = JSON.parse(JSON.stringify(json))
      expect(parsed.passed).toBe(true)
      expect(parsed.summary.totalScenarios).toBe(1)
      expect(parsed.results).toHaveLength(1)
      expect(parsed.results[0].description).toBe('Test')
    })
  })

  describe('toJson', () => {
    it('should create JSON-serializable object', () => {
      const config = new ProcessedConfig(
        {
          stages: ['build', 'test'],
          'build-job': {
            script: ['echo build'],
            stage: 'build',
          },
          'test-job': {
            script: ['echo test'],
            stage: 'test',
            rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
          },
        },
        mockContext(),
      )

      const scenario: TestScenario = {
        description: 'Test scenario',
        variables: { CI_COMMIT_BRANCH: 'develop' },
        assertions: {
          jobs: { 'build-job': 'automatic', 'test-job': 'skipped' },
          counts: { total: 2 },
        },
      }

      const result = TestRunner.runTest(scenario, config)
      const json = TestRunner.toJson(result)

      expect(() => JSON.stringify(json)).not.toThrow()

      const parsed = JSON.parse(JSON.stringify(json))
      expect(parsed.passed).toBe(true)
      expect(parsed.description).toBe('Test scenario')
      expect(parsed.summary.total).toBe(3)
      expect(parsed.assertions).toHaveLength(3)
      expect(parsed.evaluation.jobs).toHaveLength(1)
      expect(parsed.evaluation.skipped).toHaveLength(1)
    })
  })
})
