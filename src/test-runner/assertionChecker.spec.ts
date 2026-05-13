import { describe, expect, it } from 'vitest'
import type { EvaluationSummary, JobEvaluationResult } from '../rule-evaluation'
import type { ChildPipelineResult } from '../child-pipeline'
import {
  checkAllAssertions,
  checkChildPipelineAssertions,
  checkCountAssertion,
  checkJobAssertion,
  countJobsByStatus,
  determineJobStatus,
} from './assertionChecker'
import type { ChildPipelineAssertions, TestAssertions } from './types'

describe('assertionChecker', () => {
  describe('determineJobStatus', () => {
    it('should return "skipped" when job will not run', () => {
      const job: JobEvaluationResult = {
        name: 'test-job',
        willRun: false,
        stage: 'test',
        when: 'on_success',
        reason: 'No rules matched',
      }

      expect(determineJobStatus(job)).toBe('skipped')
    })

    it('should return "manual" when job requires manual trigger', () => {
      const job: JobEvaluationResult = {
        name: 'deploy-job',
        willRun: true,
        stage: 'deploy',
        when: 'manual',
      }

      expect(determineJobStatus(job)).toBe('manual')
    })

    it('should return "automatic" when job runs on_success', () => {
      const job: JobEvaluationResult = {
        name: 'build-job',
        willRun: true,
        stage: 'build',
        when: 'on_success',
      }

      expect(determineJobStatus(job)).toBe('automatic')
    })

    it('should return "automatic" when job runs always', () => {
      const job: JobEvaluationResult = {
        name: 'cleanup-job',
        willRun: true,
        stage: 'cleanup',
        when: 'always',
      }

      expect(determineJobStatus(job)).toBe('automatic')
    })

    it('should return "automatic" when job runs on_failure', () => {
      const job: JobEvaluationResult = {
        name: 'notify-job',
        willRun: true,
        stage: 'notify',
        when: 'on_failure',
      }

      expect(determineJobStatus(job)).toBe('automatic')
    })

    it('should return "automatic" when job runs delayed', () => {
      const job: JobEvaluationResult = {
        name: 'delayed-job',
        willRun: true,
        stage: 'deploy',
        when: 'delayed',
      }

      expect(determineJobStatus(job)).toBe('automatic')
    })

    it('should return "skipped" when job has when: never', () => {
      const job: JobEvaluationResult = {
        name: 'never-job',
        willRun: false,
        stage: 'test',
        when: 'never',
      }

      expect(determineJobStatus(job)).toBe('skipped')
    })
  })

  describe('checkJobAssertion', () => {
    const createSummary = (
      jobs: JobEvaluationResult[],
      skipped: JobEvaluationResult[],
    ): EvaluationSummary => ({
      jobs,
      skipped,
      totalJobs: jobs.length + skipped.length,
    })

    it('should pass when job status matches expected', () => {
      const summary = createSummary(
        [{ name: 'build-job', willRun: true, stage: 'build', when: 'on_success' }],
        [],
      )

      const result = checkJobAssertion('build-job', 'automatic', summary)

      expect(result.passed).toBe(true)
      expect(result.type).toBe('job')
      expect(result.name).toBe('build-job')
      expect(result.expected).toBe('automatic')
      expect(result.actual).toBe('automatic')
    })

    it('should fail when job status does not match expected', () => {
      const summary = createSummary(
        [{ name: 'deploy-job', willRun: true, stage: 'deploy', when: 'manual' }],
        [],
      )

      const result = checkJobAssertion('deploy-job', 'automatic', summary)

      expect(result.passed).toBe(false)
      expect(result.expected).toBe('automatic')
      expect(result.actual).toBe('manual')
      expect(result.message).toContain("expected 'automatic' but was 'manual'")
    })

    it('should check skipped jobs correctly', () => {
      const summary = createSummary(
        [],
        [
          {
            name: 'skipped-job',
            willRun: false,
            stage: 'test',
            when: 'on_success',
            reason: 'No rules matched',
          },
        ],
      )

      const result = checkJobAssertion('skipped-job', 'skipped', summary)

      expect(result.passed).toBe(true)
      expect(result.actual).toBe('skipped')
    })

    it('should fail when job is not found', () => {
      const summary = createSummary(
        [{ name: 'build-job', willRun: true, stage: 'build', when: 'on_success' }],
        [],
      )

      const result = checkJobAssertion('non-existent-job', 'automatic', summary)

      expect(result.passed).toBe(false)
      expect(result.actual).toBe('not found')
      expect(result.message).toContain('not found in evaluation results')
    })

    it('should handle manual job assertion', () => {
      const summary = createSummary(
        [{ name: 'deploy-prod', willRun: true, stage: 'deploy', when: 'manual' }],
        [],
      )

      const result = checkJobAssertion('deploy-prod', 'manual', summary)

      expect(result.passed).toBe(true)
      expect(result.actual).toBe('manual')
    })
  })

  describe('countJobsByStatus', () => {
    const createSummary = (
      jobs: JobEvaluationResult[],
      skipped: JobEvaluationResult[],
    ): EvaluationSummary => ({
      jobs,
      skipped,
      totalJobs: jobs.length + skipped.length,
    })

    it('should count all job types correctly', () => {
      const summary = createSummary(
        [
          { name: 'build-job', willRun: true, stage: 'build', when: 'on_success' },
          { name: 'test-job', willRun: true, stage: 'test', when: 'on_success' },
          { name: 'deploy-manual', willRun: true, stage: 'deploy', when: 'manual' },
        ],
        [
          {
            name: 'skipped-job',
            willRun: false,
            stage: 'test',
            when: 'on_success',
            reason: 'No rules matched',
          },
        ],
      )

      const counts = countJobsByStatus(summary)

      expect(counts.automatic).toBe(2)
      expect(counts.manual).toBe(1)
      expect(counts.skipped).toBe(1)
      expect(counts.total).toBe(4)
    })

    it('should handle empty summary', () => {
      const summary = createSummary([], [])

      const counts = countJobsByStatus(summary)

      expect(counts.automatic).toBe(0)
      expect(counts.manual).toBe(0)
      expect(counts.skipped).toBe(0)
      expect(counts.total).toBe(0)
    })

    it('should count multiple manual jobs', () => {
      const summary = createSummary(
        [
          { name: 'deploy-staging', willRun: true, stage: 'deploy', when: 'manual' },
          { name: 'deploy-prod', willRun: true, stage: 'deploy', when: 'manual' },
        ],
        [],
      )

      const counts = countJobsByStatus(summary)

      expect(counts.automatic).toBe(0)
      expect(counts.manual).toBe(2)
      expect(counts.skipped).toBe(0)
      expect(counts.total).toBe(2)
    })
  })

  describe('checkCountAssertion', () => {
    const createSummary = (
      jobs: JobEvaluationResult[],
      skipped: JobEvaluationResult[],
    ): EvaluationSummary => ({
      jobs,
      skipped,
      totalJobs: jobs.length + skipped.length,
    })

    it('should pass when count matches expected', () => {
      const summary = createSummary(
        [
          { name: 'build-job', willRun: true, stage: 'build', when: 'on_success' },
          { name: 'test-job', willRun: true, stage: 'test', when: 'on_success' },
        ],
        [],
      )

      const result = checkCountAssertion('automatic', 2, summary)

      expect(result.passed).toBe(true)
      expect(result.type).toBe('count')
      expect(result.name).toBe('automatic')
      expect(result.expected).toBe(2)
      expect(result.actual).toBe(2)
    })

    it('should fail when count does not match expected', () => {
      const summary = createSummary(
        [{ name: 'build-job', willRun: true, stage: 'build', when: 'on_success' }],
        [],
      )

      const result = checkCountAssertion('automatic', 5, summary)

      expect(result.passed).toBe(false)
      expect(result.expected).toBe(5)
      expect(result.actual).toBe(1)
      expect(result.message).toContain('expected 5 but was 1')
    })

    it('should check skipped count correctly', () => {
      const summary = createSummary(
        [],
        [
          {
            name: 'skipped-1',
            willRun: false,
            stage: 'test',
            when: 'on_success',
            reason: 'No rules matched',
          },
          {
            name: 'skipped-2',
            willRun: false,
            stage: 'test',
            when: 'on_success',
            reason: 'No rules matched',
          },
        ],
      )

      const result = checkCountAssertion('skipped', 2, summary)

      expect(result.passed).toBe(true)
    })

    it('should check total count correctly', () => {
      const summary = createSummary(
        [{ name: 'build-job', willRun: true, stage: 'build', when: 'on_success' }],
        [
          {
            name: 'skipped-job',
            willRun: false,
            stage: 'test',
            when: 'on_success',
            reason: 'No rules matched',
          },
        ],
      )

      const result = checkCountAssertion('total', 2, summary)

      expect(result.passed).toBe(true)
    })
  })

  describe('checkAllAssertions', () => {
    const createSummary = (
      jobs: JobEvaluationResult[],
      skipped: JobEvaluationResult[],
    ): EvaluationSummary => ({
      jobs,
      skipped,
      totalJobs: jobs.length + skipped.length,
    })

    it('should check all job and count assertions', () => {
      const summary = createSummary(
        [
          { name: 'build-job', willRun: true, stage: 'build', when: 'on_success' },
          { name: 'deploy-manual', willRun: true, stage: 'deploy', when: 'manual' },
        ],
        [
          {
            name: 'skipped-job',
            willRun: false,
            stage: 'test',
            when: 'on_success',
            reason: 'No rules matched',
          },
        ],
      )

      const assertions: TestAssertions = {
        jobs: {
          'build-job': 'automatic',
          'deploy-manual': 'manual',
          'skipped-job': 'skipped',
        },
        counts: {
          automatic: 1,
          manual: 1,
          skipped: 1,
          total: 3,
        },
      }

      const results = checkAllAssertions(assertions, summary)

      expect(results).toHaveLength(7) // 3 job assertions + 4 count assertions
      expect(results.every(r => r.passed)).toBe(true)
    })

    it('should return mixed results when some assertions fail', () => {
      const summary = createSummary(
        [{ name: 'build-job', willRun: true, stage: 'build', when: 'manual' }],
        [],
      )

      const assertions: TestAssertions = {
        jobs: {
          'build-job': 'automatic', // Should fail - it's actually manual
        },
        counts: {
          automatic: 1, // Should fail - there are 0 automatic jobs
          manual: 1, // Should pass
        },
      }

      const results = checkAllAssertions(assertions, summary)

      expect(results).toHaveLength(3)

      const failedResults = results.filter(r => !r.passed)
      expect(failedResults).toHaveLength(2)

      const passedResults = results.filter(r => r.passed)
      expect(passedResults).toHaveLength(1)
      expect(passedResults[0]?.name).toBe('manual')
    })

    it('should handle empty assertions', () => {
      const summary = createSummary(
        [{ name: 'build-job', willRun: true, stage: 'build', when: 'on_success' }],
        [],
      )

      const assertions: TestAssertions = {}

      const results = checkAllAssertions(assertions, summary)

      expect(results).toHaveLength(0)
    })

    it('should handle only job assertions', () => {
      const summary = createSummary(
        [{ name: 'build-job', willRun: true, stage: 'build', when: 'on_success' }],
        [],
      )

      const assertions: TestAssertions = {
        jobs: {
          'build-job': 'automatic',
        },
      }

      const results = checkAllAssertions(assertions, summary)

      expect(results).toHaveLength(1)
      expect(results[0]?.passed).toBe(true)
    })

    it('should handle only count assertions', () => {
      const summary = createSummary(
        [{ name: 'build-job', willRun: true, stage: 'build', when: 'on_success' }],
        [],
      )

      const assertions: TestAssertions = {
        counts: {
          total: 1,
        },
      }

      const results = checkAllAssertions(assertions, summary)

      expect(results).toHaveLength(1)
      expect(results[0]?.passed).toBe(true)
    })

    it('should skip undefined count assertions', () => {
      const summary = createSummary(
        [{ name: 'build-job', willRun: true, stage: 'build', when: 'on_success' }],
        [],
      )

      const assertions: TestAssertions = {
        counts: {
          automatic: 1,
          // manual, skipped, total are undefined and should be skipped
        },
      }

      const results = checkAllAssertions(assertions, summary)

      expect(results).toHaveLength(1)
      expect(results[0]?.name).toBe('automatic')
    })
  })

  describe('checkChildPipelineAssertions', () => {
    const createChildPipeline = (
      triggerJobName: string,
      jobs: JobEvaluationResult[],
      skipped: JobEvaluationResult[],
      children?: ChildPipelineResult[],
      error?: string,
    ): ChildPipelineResult => ({
      configPath: `apps/${triggerJobName}/.gitlab-ci.yml`,
      triggerJobName,
      evaluation: {
        jobs,
        skipped,
        totalJobs: jobs.length + skipped.length,
      },
      lintIssues: [],
      children,
      depth: 1,
      error,
    })

    it('should check job assertions for child pipeline', () => {
      const childPipelines: ChildPipelineResult[] = [
        createChildPipeline(
          'trigger-extension',
          [{ name: 'build-chrome', willRun: true, stage: 'build', when: 'on_success' }],
          [
            {
              name: 'build-qa',
              willRun: false,
              stage: 'build',
              when: 'on_success',
              reason: 'Skipped',
            },
          ],
        ),
      ]

      const assertions: Record<string, ChildPipelineAssertions> = {
        'trigger-extension': {
          jobs: {
            'build-chrome': 'automatic',
            'build-qa': 'skipped',
          },
        },
      }

      const results = checkChildPipelineAssertions(assertions, childPipelines)

      expect(results).toHaveLength(2)
      expect(results.every(r => r.passed)).toBe(true)
      expect(results[0]?.name).toBe('trigger-extension:build-chrome')
      expect(results[1]?.name).toBe('trigger-extension:build-qa')
    })

    it('should check count assertions for child pipeline', () => {
      const childPipelines: ChildPipelineResult[] = [
        createChildPipeline(
          'trigger-extension',
          [
            { name: 'build-chrome', willRun: true, stage: 'build', when: 'on_success' },
            { name: 'deploy', willRun: true, stage: 'deploy', when: 'manual' },
          ],
          [
            {
              name: 'build-qa',
              willRun: false,
              stage: 'build',
              when: 'on_success',
              reason: 'Skipped',
            },
          ],
        ),
      ]

      const assertions: Record<string, ChildPipelineAssertions> = {
        'trigger-extension': {
          counts: {
            automatic: 1,
            manual: 1,
            skipped: 1,
            total: 3,
          },
        },
      }

      const results = checkChildPipelineAssertions(assertions, childPipelines)

      expect(results).toHaveLength(4)
      expect(results.every(r => r.passed)).toBe(true)
    })

    it('should fail when child pipeline is not found', () => {
      const childPipelines: ChildPipelineResult[] = []

      const assertions: Record<string, ChildPipelineAssertions> = {
        'trigger-extension': {
          jobs: {
            'build-chrome': 'automatic',
          },
        },
      }

      const results = checkChildPipelineAssertions(assertions, childPipelines)

      expect(results).toHaveLength(1)
      expect(results[0]?.passed).toBe(false)
      expect(results[0]?.actual).toBe('pipeline not found')
      expect(results[0]?.message).toContain('was not evaluated')
    })

    it('should fail when child pipeline has error', () => {
      const childPipelines: ChildPipelineResult[] = [
        createChildPipeline('trigger-extension', [], [], undefined, 'Config file not found'),
      ]

      const assertions: Record<string, ChildPipelineAssertions> = {
        'trigger-extension': {
          jobs: {
            'build-chrome': 'automatic',
          },
        },
      }

      const results = checkChildPipelineAssertions(assertions, childPipelines)

      expect(results).toHaveLength(1)
      expect(results[0]?.passed).toBe(false)
      expect(results[0]?.actual).toBe('pipeline error')
      expect(results[0]?.message).toContain('Config file not found')
    })

    it('should recursively check grandchild assertions', () => {
      const grandchild = createChildPipeline(
        'trigger-sub',
        [{ name: 'sub-build', willRun: true, stage: 'build', when: 'on_success' }],
        [],
      )
      grandchild.depth = 2

      const childPipelines: ChildPipelineResult[] = [
        createChildPipeline(
          'trigger-extension',
          [{ name: 'build-chrome', willRun: true, stage: 'build', when: 'on_success' }],
          [],
          [grandchild],
        ),
      ]

      const assertions: Record<string, ChildPipelineAssertions> = {
        'trigger-extension': {
          jobs: {
            'build-chrome': 'automatic',
          },
          childPipelines: {
            'trigger-sub': {
              jobs: {
                'sub-build': 'automatic',
              },
            },
          },
        },
      }

      const results = checkChildPipelineAssertions(assertions, childPipelines)

      expect(results).toHaveLength(2)
      expect(results.every(r => r.passed)).toBe(true)
      expect(results[0]?.name).toBe('trigger-extension:build-chrome')
      expect(results[1]?.name).toBe('trigger-extension > trigger-sub:sub-build')
    })

    it('should fail count assertions when count does not match', () => {
      const childPipelines: ChildPipelineResult[] = [
        createChildPipeline(
          'trigger-extension',
          [{ name: 'build-chrome', willRun: true, stage: 'build', when: 'on_success' }],
          [],
        ),
      ]

      const assertions: Record<string, ChildPipelineAssertions> = {
        'trigger-extension': {
          counts: {
            automatic: 5, // Should fail - only 1 automatic job
          },
        },
      }

      const results = checkChildPipelineAssertions(assertions, childPipelines)

      expect(results).toHaveLength(1)
      expect(results[0]?.passed).toBe(false)
      expect(results[0]?.expected).toBe(5)
      expect(results[0]?.actual).toBe(1)
    })

    it('should handle multiple child pipelines', () => {
      const childPipelines: ChildPipelineResult[] = [
        createChildPipeline(
          'trigger-extension',
          [{ name: 'build-ext', willRun: true, stage: 'build', when: 'on_success' }],
          [],
        ),
        createChildPipeline(
          'trigger-app',
          [{ name: 'build-app', willRun: true, stage: 'build', when: 'manual' }],
          [],
        ),
      ]

      const assertions: Record<string, ChildPipelineAssertions> = {
        'trigger-extension': {
          jobs: {
            'build-ext': 'automatic',
          },
        },
        'trigger-app': {
          jobs: {
            'build-app': 'manual',
          },
        },
      }

      const results = checkChildPipelineAssertions(assertions, childPipelines)

      expect(results).toHaveLength(2)
      expect(results.every(r => r.passed)).toBe(true)
    })
  })
})
