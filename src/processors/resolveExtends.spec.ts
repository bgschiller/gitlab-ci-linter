import { describe, expect, it } from 'vitest'
import { resolveExtends } from './resolveExtends'
import type { GitLabCI } from '../types'

describe('resolveExtends', () => {
  it('should resolve simple extends relationship', () => {
    const config: GitLabCI = {
      '.base_job': {
        image: 'node:18',
        before_script: ['npm ci'],
      },
      job1: {
        extends: '.base_job',
        script: ['npm test'],
      },
    }

    const result = resolveExtends(config)

    expect(result['job1']).toEqual({
      image: 'node:18',
      before_script: ['npm ci'],
      script: ['npm test'],
    })
    expect(result['job1']).not.toHaveProperty('extends')
  })

  it('should resolve multiple extends in array', () => {
    const config: GitLabCI = {
      '.base_job': {
        image: 'node:18',
        before_script: ['npm ci'],
      },
      '.test_job': {
        stage: 'test',
        coverage: '/Coverage: \\d+\\.\\d+%/',
      },
      job1: {
        extends: ['.base_job', '.test_job'],
        script: ['npm test'],
      },
    }

    const result = resolveExtends(config)

    // Multiple extends merges all parents in order, then the child.
    // Later parents override earlier ones for conflicting properties.
    expect(result['job1']).toEqual({
      image: 'node:18', // From .base_job
      before_script: ['npm ci'], // From .base_job
      stage: 'test', // From .test_job
      coverage: '/Coverage: \\d+\\.\\d+%/', // From .test_job
      script: ['npm test'], // From job1
    })
    expect(result['job1']).not.toHaveProperty('extends')
  })

  it('should merge variables from parent and child', () => {
    const config: GitLabCI = {
      '.base_job': {
        variables: {
          NODE_ENV: 'test',
          LOG_LEVEL: 'debug',
        },
      },
      job1: {
        extends: '.base_job',
        variables: {
          LOG_LEVEL: 'info', // Should override parent
          PORT: '3000', // Should be added
        },
        script: ['npm start'],
      },
    }

    const result = resolveExtends(config)

    expect(result['job1']?.variables).toEqual({
      NODE_ENV: 'test', // From parent
      LOG_LEVEL: 'info', // Child overrides parent
      PORT: '3000', // From child
    })
  })

  it('should merge script arrays from parent and child', () => {
    const config: GitLabCI = {
      '.base_job': {
        script: ['echo "Setup"', 'npm ci'],
      },
      job1: {
        extends: '.base_job',
        script: ['npm test', 'echo "Cleanup"'],
      },
    }

    const result = resolveExtends(config)

    expect(result['job1']?.script).toEqual(['echo "Setup"', 'npm ci', 'npm test', 'echo "Cleanup"'])
  })

  it('should handle child job overriding parent properties', () => {
    const config: GitLabCI = {
      '.base_job': {
        image: 'node:16',
        stage: 'test',
        allow_failure: false,
        timeout: 3600,
      },
      job1: {
        extends: '.base_job',
        image: 'node:18', // Override parent image
        allow_failure: true, // Override parent allow_failure
        script: ['npm test'],
      },
    }

    const result = resolveExtends(config)

    expect(result['job1']).toEqual({
      image: 'node:18', // Overridden
      stage: 'test', // From parent
      allow_failure: true, // Overridden
      timeout: 3600, // From parent
      script: ['npm test'], // From child
    })
  })

  it('should handle missing parent job gracefully', () => {
    const config: GitLabCI = {
      job1: {
        extends: '.missing_job',
        script: ['npm test'],
      },
    }

    const result = resolveExtends(config)

    expect(result['job1']).toEqual({
      script: ['npm test'],
    })
    expect(result['job1']).not.toHaveProperty('extends')
  })

  it('should handle config with no extends', () => {
    const config: GitLabCI = {
      variables: {
        NODE_VERSION: '18',
      },
      job1: {
        script: ['npm test'],
      },
      job2: {
        script: ['npm build'],
      },
    }

    const result = resolveExtends(config)

    expect(result).toEqual(config)
  })

  it('should preserve reserved config keys', () => {
    const config: GitLabCI = {
      stages: ['build', 'test', 'deploy'],
      variables: {
        NODE_VERSION: '18',
      },
      workflow: {
        rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
      },
      include: [{ template: 'Security/SAST.gitlab-ci.yml' }],
      '.base_job': {
        image: 'node:18',
      },
      job1: {
        extends: '.base_job',
        script: ['npm test'],
      },
    }

    const result = resolveExtends(config)

    expect(result.stages).toEqual(['build', 'test', 'deploy'])
    expect(result.variables).toEqual({ NODE_VERSION: '18' })
    expect(result.workflow).toEqual({
      rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }],
    })
    expect(result.include).toEqual([{ template: 'Security/SAST.gitlab-ci.yml' }])
  })

  it('should handle multi-level inheritance chain', () => {
    const config: GitLabCI = {
      '.base': {
        image: 'alpine',
        before_script: ['apk add --no-cache git'],
      },
      '.node_base': {
        extends: '.base',
        image: 'node:18', // Override parent
        before_script: ['npm ci'], // Override parent
      },
      '.test_base': {
        extends: '.node_base',
        stage: 'test',
        coverage: '/Coverage: \\d+\\.\\d+%/',
      },
      unit_tests: {
        extends: '.test_base',
        script: ['npm test'],
        artifacts: {
          reports: {
            coverage_report: {
              coverage_format: 'cobertura',
              path: 'coverage/cobertura-coverage.xml',
            },
          },
        },
      },
    }

    const result = resolveExtends(config)

    // Multi-level extends: unit_tests <- .test_base <- .node_base <- .base
    // Properties are inherited and overridden through the chain
    expect(result['unit_tests']).toEqual({
      image: 'node:18', // From .node_base (overrode .base)
      before_script: ['npm ci'], // From .node_base (overrode .base)
      stage: 'test', // From .test_base
      coverage: '/Coverage: \\d+\\.\\d+%/', // From .test_base
      script: ['npm test'], // From unit_tests
      artifacts: {
        reports: {
          coverage_report: {
            coverage_format: 'cobertura',
            path: 'coverage/cobertura-coverage.xml',
          },
        },
      },
    })
  })

  it('should handle variables and scripts merging together', () => {
    const config: GitLabCI = {
      '.base': {
        variables: {
          BASE_VAR: 'base_value',
          SHARED_VAR: 'base_shared',
        },
        script: ['echo "Base setup"'],
      },
      job1: {
        extends: '.base',
        variables: {
          SHARED_VAR: 'child_shared', // Override
          CHILD_VAR: 'child_value', // Add
        },
        script: ['npm test'], // Should merge with parent
      },
    }

    const result = resolveExtends(config)

    expect(result['job1']?.variables).toEqual({
      BASE_VAR: 'base_value',
      SHARED_VAR: 'child_shared', // Child wins
      CHILD_VAR: 'child_value',
    })
    expect(result['job1']?.script).toEqual(['echo "Base setup"', 'npm test'])
  })

  it('should handle extends with no variables or scripts in parent', () => {
    const config: GitLabCI = {
      '.base': {
        image: 'node:18',
        stage: 'test',
      },
      job1: {
        extends: '.base',
        variables: {
          NODE_ENV: 'test',
        },
        script: ['npm test'],
      },
    }

    const result = resolveExtends(config)

    expect(result['job1']).toEqual({
      image: 'node:18',
      stage: 'test',
      variables: {
        NODE_ENV: 'test',
      },
      script: ['npm test'],
    })
  })

  it('should handle extends with no variables or scripts in child', () => {
    const config: GitLabCI = {
      '.base': {
        image: 'node:18',
        variables: {
          NODE_ENV: 'test',
        },
        script: ['npm ci', 'npm test'],
      },
      job1: {
        extends: '.base',
        stage: 'test',
      },
    }

    const result = resolveExtends(config)

    expect(result['job1']).toEqual({
      image: 'node:18',
      stage: 'test',
      variables: {
        NODE_ENV: 'test',
      },
      script: ['npm ci', 'npm test'],
    })
  })

  it('should handle multiple jobs extending the same parent', () => {
    const config: GitLabCI = {
      '.test_base': {
        image: 'node:18',
        stage: 'test',
        before_script: ['npm ci'],
      },
      unit_tests: {
        extends: '.test_base',
        script: ['npm run test:unit'],
      },
      integration_tests: {
        extends: '.test_base',
        script: ['npm run test:integration'],
        services: ['postgres:13'],
      },
    }

    const result = resolveExtends(config)

    expect(result['unit_tests']).toEqual({
      image: 'node:18',
      stage: 'test',
      before_script: ['npm ci'],
      script: ['npm run test:unit'],
    })

    expect(result['integration_tests']).toEqual({
      image: 'node:18',
      stage: 'test',
      before_script: ['npm ci'],
      script: ['npm run test:integration'],
      services: ['postgres:13'],
    })
  })

  it('should handle empty extends array', () => {
    const config: GitLabCI = {
      job1: {
        extends: [],
        script: ['npm test'],
      },
    }

    const result = resolveExtends(config)

    expect(result['job1']).toEqual({
      script: ['npm test'],
    })
    expect(result['job1']).not.toHaveProperty('extends')
  })

  it('should not modify template jobs that are only extended', () => {
    const config: GitLabCI = {
      '.hidden_job': {
        image: 'node:18',
        variables: {
          NODE_ENV: 'test',
        },
        script: ['echo "This is a template"'],
      },
      real_job: {
        extends: '.hidden_job',
        script: ['npm test'],
      },
    }

    const result = resolveExtends(config)

    // Template job should remain unchanged
    expect(result['.hidden_job']).toEqual({
      image: 'node:18',
      variables: {
        NODE_ENV: 'test',
      },
      script: ['echo "This is a template"'],
    })

    // Real job should be extended
    expect(result['real_job']).toEqual({
      image: 'node:18',
      variables: {
        NODE_ENV: 'test',
      },
      script: ['echo "This is a template"', 'npm test'],
    })
  })

  it('should handle circular extends gracefully', () => {
    const config: GitLabCI = {
      '.a': { extends: '.b', image: 'alpine' },
      '.b': { extends: '.a', stage: 'test' },
      job1: { extends: '.a', script: ['echo test'] },
    }

    // Should not throw or hang
    const result = resolveExtends(config)
    expect(result['job1']).toHaveProperty('script')
  })

  it('should resolve deeply nested extends (5 levels)', () => {
    const config: GitLabCI = {
      '.level1': { image: 'node:18' },
      '.level2': { extends: '.level1', stage: 'build' },
      '.level3': { extends: '.level2', before_script: ['npm ci'] },
      '.level4': { extends: '.level3', cache: { paths: ['node_modules/'] } },
      '.level5': { extends: '.level4', timeout: '30m' },
      job1: { extends: '.level5', script: ['npm test'] },
    }

    const result = resolveExtends(config)

    expect(result['job1']).toEqual({
      image: 'node:18',
      stage: 'build',
      before_script: ['npm ci'],
      cache: { paths: ['node_modules/'] },
      timeout: '30m',
      script: ['npm test'],
    })
  })

  it('should allow intermediate layers to override ancestor properties', () => {
    const config: GitLabCI = {
      '.base': {
        image: 'alpine:3.18',
        stage: 'test',
        timeout: '1h',
        variables: { LOG_LEVEL: 'info', ENV: 'test' },
      },
      '.node_base': {
        extends: '.base',
        image: 'node:18', // Override ancestor's image
        variables: { LOG_LEVEL: 'debug' }, // Override ancestor's LOG_LEVEL
      },
      '.test_base': {
        extends: '.node_base',
        stage: 'integration', // Override grandparent's stage
        timeout: '2h', // Override grandparent's timeout
      },
      job1: {
        extends: '.test_base',
        script: ['npm test'],
        variables: { ENV: 'ci' }, // Override great-grandparent's ENV
      },
    }

    const result = resolveExtends(config)

    expect(result['job1']).toEqual({
      image: 'node:18', // From .node_base (overrode .base)
      stage: 'integration', // From .test_base (overrode .node_base -> .base)
      timeout: '2h', // From .test_base (overrode .base)
      variables: {
        LOG_LEVEL: 'debug', // From .node_base (overrode .base)
        ENV: 'ci', // From job1 (overrode .base)
      },
      script: ['npm test'], // From job1
    })
  })
})
