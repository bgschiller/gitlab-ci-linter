import { describe, expect, it } from 'vitest'
import { checkInvalidNeeds } from './checkInvalidNeeds.js'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig.js'
import type { GitLabCI } from '../types.js'

const defaultContext: ProcessingContext = {
  filePath: '.gitlab-ci.yml',
  baseDir: '/project',
  includedFiles: new Set(),
  includeStack: [],
  remoteJobs: new Set(),
  gitlabHost: 'gitlab.com',
}

describe('checkInvalidNeeds', () => {
  it('should detect needs referencing non-existent job', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'test'],
        'build-app': {
          stage: 'build',
          script: ['npm run build'],
        },
        'test-app': {
          stage: 'test',
          script: ['npm test'],
          needs: ['build-nonexistent'],
        },
      } as GitLabCI,
      defaultContext,
    )

    const issues = checkInvalidNeeds(config)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      message:
        "Job 'test-app' has 'needs: build-nonexistent' but job 'build-nonexistent' does not exist",
      location: 'test-app',
    })
  })

  it('should detect needs with object syntax referencing non-existent job', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'test'],
        'build-app': {
          stage: 'build',
          script: ['npm run build'],
        },
        'test-app': {
          stage: 'test',
          script: ['npm test'],
          needs: [{ job: 'missing-job', artifacts: true }],
        },
      } as GitLabCI,
      defaultContext,
    )

    const issues = checkInvalidNeeds(config)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      message: "Job 'test-app' has 'needs: missing-job' but job 'missing-job' does not exist",
      location: 'test-app',
    })
  })

  it('should not flag valid needs references', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'test'],
        'build-app': {
          stage: 'build',
          script: ['npm run build'],
        },
        'test-app': {
          stage: 'test',
          script: ['npm test'],
          needs: ['build-app'],
        },
      } as GitLabCI,
      defaultContext,
    )

    const issues = checkInvalidNeeds(config)

    expect(issues).toHaveLength(0)
  })

  it('should not flag valid needs with object syntax', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'test'],
        'build-app': {
          stage: 'build',
          script: ['npm run build'],
        },
        'test-app': {
          stage: 'test',
          script: ['npm test'],
          needs: [{ job: 'build-app', artifacts: true }],
        },
      } as GitLabCI,
      defaultContext,
    )

    const issues = checkInvalidNeeds(config)

    expect(issues).toHaveLength(0)
  })

  it('should detect invalid dependencies field', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'test'],
        'build-app': {
          stage: 'build',
          script: ['npm run build'],
        },
        'test-app': {
          stage: 'test',
          script: ['npm test'],
          dependencies: ['nonexistent-job'],
        },
      } as GitLabCI,
      defaultContext,
    )

    const issues = checkInvalidNeeds(config)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      message:
        "Job 'test-app' has 'dependencies: nonexistent-job' but job 'nonexistent-job' does not exist",
      location: 'test-app',
    })
  })

  it('should skip template jobs', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'test'],
        '.template': {
          script: ['npm test'],
          needs: ['nonexistent-job'],
        },
        'build-app': {
          stage: 'build',
          script: ['npm run build'],
        },
      } as GitLabCI,
      defaultContext,
    )

    const issues = checkInvalidNeeds(config)

    expect(issues).toHaveLength(0)
  })

  it('should not flag needs with optional: true for non-existent jobs', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'test'],
        'build-app': {
          stage: 'build',
          script: ['npm run build'],
        },
        'test-app': {
          stage: 'test',
          script: ['npm test'],
          needs: [{ job: 'maybe-exists', optional: true }],
        },
      } as GitLabCI,
      defaultContext,
    )

    const issues = checkInvalidNeeds(config)

    expect(issues).toHaveLength(0)
  })

  it('should not flag cross-project needs', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'test'],
        'build-app': {
          stage: 'build',
          script: ['npm run build'],
        },
        'test-app': {
          stage: 'test',
          script: ['npm test'],
          needs: [
            {
              project: 'other-group/other-project',
              job: 'external-build',
              ref: 'main',
              artifacts: true,
            },
          ],
        },
      } as GitLabCI,
      defaultContext,
    )

    const issues = checkInvalidNeeds(config)

    expect(issues).toHaveLength(0)
  })

  it('should not flag cross-pipeline needs', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'test'],
        'build-app': {
          stage: 'build',
          script: ['npm run build'],
        },
        'test-app': {
          stage: 'test',
          script: ['npm test'],
          needs: [{ pipeline: '$PARENT_PIPELINE_ID', job: 'parent-build' }],
        },
      } as GitLabCI,
      defaultContext,
    )

    const issues = checkInvalidNeeds(config)

    expect(issues).toHaveLength(0)
  })

  it('should still flag invalid needs when mixed with optional/cross-project needs', () => {
    const config = new ProcessedConfig(
      {
        stages: ['build', 'test'],
        'build-app': {
          stage: 'build',
          script: ['npm run build'],
        },
        'test-app': {
          stage: 'test',
          script: ['npm test'],
          needs: [
            { job: 'maybe-exists', optional: true },
            { project: 'other/project', job: 'external', ref: 'main' },
            'nonexistent-job',
          ],
        },
      } as GitLabCI,
      defaultContext,
    )

    const issues = checkInvalidNeeds(config)

    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('nonexistent-job')
  })
})
