// eslint-disable no-template-curly-in-string
import { describe, expect, it } from 'vitest'
import { expandVariables } from './expandVariables'
import type { GitLabCI } from '../types'

describe('expandVariables', () => {
  it('should expand simple variables with ${} syntax', () => {
    const config: GitLabCI = {
      variables: {
        NODE_VERSION: '18',
        DIST_DIR: 'dist',
      },
      job1: {
        script: ['node --version ${NODE_VERSION}', 'ls ${DIST_DIR}'],
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.script).toEqual(['node --version 18', 'ls dist'])
  })

  it('should expand simple variables with $ syntax', () => {
    const config: GitLabCI = {
      variables: {
        NODE_VERSION: '18',
        APP_NAME: 'myapp',
      },
      job1: {
        script: ['echo $NODE_VERSION', 'docker build -t $APP_NAME .'],
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.script).toEqual(['echo 18', 'docker build -t myapp .'])
  })

  it('should handle mixed variable syntax in same string', () => {
    const config: GitLabCI = {
      variables: {
        NODE_VERSION: '18',
        DIST_DIR: 'dist',
      },
      job1: {
        script: ['node --version $NODE_VERSION && ls ${DIST_DIR}'],
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.script).toEqual(['node --version 18 && ls dist'])
  })

  it('should preserve undefined variables', () => {
    const config: GitLabCI = {
      variables: {
        DEFINED_VAR: 'value',
      },
      job1: {
        script: ['echo $DEFINED_VAR $UNDEFINED_VAR ${ALSO_UNDEFINED}'],
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.script).toEqual(['echo value $UNDEFINED_VAR ${ALSO_UNDEFINED}'])
  })

  it('should expand variables in nested objects', () => {
    const config: GitLabCI = {
      variables: {
        IMAGE_TAG: 'latest',
        PORT: '3000',
      },
      job1: {
        image: 'node:${IMAGE_TAG}',
        services: [
          {
            name: 'redis:${IMAGE_TAG}',
            alias: 'redis',
          },
        ],
        variables: {
          APP_PORT: '${PORT}',
        },
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.image).toBe('node:latest')
    expect(result['job1']?.services?.[0]?.name).toBe('redis:latest')
    expect(result['job1']?.variables?.APP_PORT).toBe('3000')
  })

  it('should expand variables in arrays', () => {
    const config: GitLabCI = {
      variables: {
        TEST_CMD: 'npm test',
        BUILD_CMD: 'npm run build',
      },
      job1: {
        script: ['$TEST_CMD', '${BUILD_CMD}', 'echo done'],
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.script).toEqual(['npm test', 'npm run build', 'echo done'])
  })

  it('should handle empty variables object', () => {
    const config: GitLabCI = {
      variables: {},
      job1: {
        script: ['echo $UNDEFINED_VAR'],
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.script).toEqual(['echo $UNDEFINED_VAR'])
  })

  it('should handle missing variables object', () => {
    const config: GitLabCI = {
      job1: {
        script: ['echo $UNDEFINED_VAR'],
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.script).toEqual(['echo $UNDEFINED_VAR'])
  })

  it('should preserve non-string values', () => {
    const config: GitLabCI = {
      variables: {
        STRING_VAR: 'value',
      },
      job1: {
        timeout: 3600,
        retry: 2,
        parallel: 5,
        allow_failure: true,
        script: ['echo ${STRING_VAR}'],
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.timeout).toBe(3600)
    expect(result['job1']?.retry).toBe(2)
    expect(result['job1']?.parallel).toBe(5)
    expect(result['job1']?.allow_failure).toBe(true)
    expect(result['job1']?.script).toEqual(['echo value'])
  })

  it('should handle variable names with underscores and numbers', () => {
    const config: GitLabCI = {
      variables: {
        NODE_VERSION_18: '18.17.0',
        API_KEY_V2: 'secret123',
        TEST_ENV_URL: 'https://test.example.com',
      },
      job1: {
        script: [
          'node --version $NODE_VERSION_18',
          'curl -H "Authorization: ${API_KEY_V2}" ${TEST_ENV_URL}',
        ],
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.script).toEqual([
      'node --version 18.17.0',
      'curl -H "Authorization: secret123" https://test.example.com',
    ])
  })

  it('should not expand lowercase variables (GitLab convention)', () => {
    const config: GitLabCI = {
      variables: {
        UPPERCASE_VAR: 'should expand',
        lowercase_var: 'should not expand',
      },
      job1: {
        script: ['echo $UPPERCASE_VAR $lowercase_var'],
      },
    }

    const result = expandVariables(config)

    expect(result['job1']?.script).toEqual(['echo should expand $lowercase_var'])
  })

  it('should handle complex nested structures', () => {
    const config: GitLabCI = {
      variables: {
        BASE_IMAGE: 'node:18',
        BUILD_STAGE: 'build',
        TEST_STAGE: 'test',
      },
      stages: ['${BUILD_STAGE}', '${TEST_STAGE}'],
      build: {
        stage: '${BUILD_STAGE}',
        image: '${BASE_IMAGE}',
        script: ['npm ci', 'npm run build'],
        artifacts: {
          paths: ['dist/'],
        },
      },
      test: {
        stage: '${TEST_STAGE}',
        image: '${BASE_IMAGE}',
        script: ['npm test'],
        needs: ['build'],
      },
    }

    const result = expandVariables(config)

    expect(result.stages).toEqual(['build', 'test'])
    expect(result['build']?.stage).toBe('build')
    expect(result['build']?.image).toBe('node:18')
    expect(result['test']?.stage).toBe('test')
    expect(result['test']?.image).toBe('node:18')
  })

  it('should handle empty strings and null values', () => {
    const config: GitLabCI = {
      variables: {
        EMPTY_VAR: '',
        REGULAR_VAR: 'value',
      },
      job1: {
        script: ['echo "${EMPTY_VAR}" "${REGULAR_VAR}"'],
        description: null as any,
        tags: [],
      },
    }

    const result = expandVariables(config)

    // Empty string should expand to empty, not remain as variable
    expect(result['job1']?.script).toEqual(['echo "" "value"'])
    expect(result['job1']?.description).toBe(null)
    expect(result['job1']?.tags).toEqual([])
  })

  it('should preserve original config structure', () => {
    const config: GitLabCI = {
      variables: {
        VERSION: '1.0.0',
      },
      stages: ['test', 'deploy'],
      job1: {
        script: ['echo $VERSION'],
      },
    }

    const result = expandVariables(config)

    expect(result['variables']).toEqual({ VERSION: '1.0.0' })
    expect(result.stages).toEqual(['test', 'deploy'])
    expect(Object.keys(result)).toEqual(Object.keys(config))
  })
})
