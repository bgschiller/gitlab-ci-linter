import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigProcessor } from './ConfigProcessor'
import { IncludeResolver } from './IncludeResolver'
import { expandVariables } from './expandVariables'
import { resolveExtends } from './resolveExtends'
import { resolveReferences } from './resolveReferences'

// Mock the processor functions
vi.mock('./IncludeResolver')
vi.mock('./expandVariables')
vi.mock('./resolveExtends')
vi.mock('./resolveReferences')

describe('ConfigProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should initialize with correct context', () => {
      const content = 'stages: [build, test]'
      const filePath = '/path/to/ci.yml'

      const processor = new ConfigProcessor(content, filePath)

      expect(processor).toBeDefined()
      expect(IncludeResolver).toHaveBeenCalledWith({
        filePath: '/path/to/ci.yml',
        baseDir: '/path/to',
        includedFiles: new Set(),
        includeStack: [],
        remoteJobs: new Set(),
        gitlabHost: 'gitlab.com',
      })
    })

    it('should handle file paths with nested directories', () => {
      new ConfigProcessor('content', '/deep/nested/path/ci.yml')

      expect(IncludeResolver).toHaveBeenCalledWith({
        filePath: '/deep/nested/path/ci.yml',
        baseDir: '/deep/nested/path',
        includedFiles: new Set(),
        includeStack: [],
        remoteJobs: new Set(),
        gitlabHost: 'gitlab.com',
      })
    })
  })

  describe('parseWithCustomTags', () => {
    it('should parse simple YAML without custom tags', async () => {
      const yamlContent = `
stages:
  - build
  - test
job1:
  script:
    - echo "hello"
`

      // Mock all the processing functions to return the input unchanged
      const mockIncludeResolver = {
        resolve: vi.fn().mockImplementation(async config => config),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockImplementation(config => config)
      vi.mocked(resolveExtends).mockImplementation(config => config)
      vi.mocked(resolveReferences).mockImplementation(config => config)

      const processor = new ConfigProcessor(yamlContent, '/test.yml')
      const result = await processor.process()

      expect(result.config['stages']).toEqual(['build', 'test'])
      expect(result.config['job1']?.script).toEqual(['echo "hello"'])
    })

    it('should parse !reference tags correctly', async () => {
      const yamlContent = `
.template:
  script:
    - echo "template"

job1:
  script: !reference [.template, script]
`

      // Mock processors
      const mockIncludeResolver = {
        resolve: vi.fn().mockImplementation(async config => config),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockImplementation(config => config)
      vi.mocked(resolveExtends).mockImplementation(config => config)
      vi.mocked(resolveReferences).mockImplementation(config => config)

      const processor = new ConfigProcessor(yamlContent, '/test.yml')
      const result = await processor.process()

      expect(result.config['job1']?.script).toEqual({
        __gitlab_reference: true,
        job: '.template',
        section: 'script',
      })
    })

    it('should parse !reference tags with optional key', async () => {
      const yamlContent = `
job1:
  variables:
    VAR1: !reference [.template, variables, MY_VAR]
`

      // Mock processors
      const mockIncludeResolver = {
        resolve: vi.fn().mockImplementation(async config => config),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockImplementation(config => config)
      vi.mocked(resolveExtends).mockImplementation(config => config)
      vi.mocked(resolveReferences).mockImplementation(config => config)

      const processor = new ConfigProcessor(yamlContent, '/test.yml')
      const result = await processor.process()

      expect(result.config['job1']?.variables?.VAR1).toEqual({
        __gitlab_reference: true,
        job: '.template',
        section: 'variables',
        key: 'MY_VAR',
      })
    })

    it('should throw error for invalid !reference with too few arguments', async () => {
      const yamlContent = `
job1:
  script: !reference [.template]
`

      const processor = new ConfigProcessor(yamlContent, '/test.yml')

      await expect(processor.process()).rejects.toThrow(
        '!reference requires at least [job, section]',
      )
    })

    it('should parse merge keys (<<) correctly', async () => {
      const yamlContent = `
base: &base
  name: Everyone has same name
  age: 5

foo:
  <<: *base

bar:
  <<: *base
  age: 20
`

      // Mock processors
      const mockIncludeResolver = {
        resolve: vi.fn().mockImplementation(async config => config),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockImplementation(config => config)
      vi.mocked(resolveExtends).mockImplementation(config => config)
      vi.mocked(resolveReferences).mockImplementation(config => config)

      const processor = new ConfigProcessor(yamlContent, '/test.yml')
      const result = await processor.process()

      // Verify merge keys are resolved correctly
      expect(result.config['base']).toEqual({
        name: 'Everyone has same name',
        age: 5,
      })
      expect(result.config['foo']).toEqual({
        name: 'Everyone has same name',
        age: 5,
      })
      expect(result.config['bar']).toEqual({
        name: 'Everyone has same name',
        age: 20, // overridden value
      })
    })

    it('should parse multiple merge keys correctly', async () => {
      const yamlContent = `
base: &base
  image: node:18
  before_script:
    - npm install

cache_config: &cache_config
  cache:
    key: \${CI_COMMIT_REF_SLUG}
    paths:
      - node_modules/

test_job:
  <<: [*base, *cache_config]
  stage: test
  script:
    - npm test
  variables:
    ENV: test
`

      // Mock processors
      const mockIncludeResolver = {
        resolve: vi.fn().mockImplementation(async config => config),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockImplementation(config => config)
      vi.mocked(resolveExtends).mockImplementation(config => config)
      vi.mocked(resolveReferences).mockImplementation(config => config)

      const processor = new ConfigProcessor(yamlContent, '/test.yml')
      const result = await processor.process()

      // Verify multiple merge keys are resolved correctly
      expect(result.config['test_job']).toEqual({
        image: 'node:18',
        before_script: ['npm install'],
        cache: {
          key: '${CI_COMMIT_REF_SLUG}',
          paths: ['node_modules/'],
        },
        stage: 'test',
        script: ['npm test'],
        variables: {
          ENV: 'test',
        },
      })
    })
  })

  describe('process pipeline', () => {
    it('should execute processing pipeline in correct order', async () => {
      const initialConfig = { stages: ['build'] }
      const afterInclude = { stages: ['build'], included: true }
      const afterVariables = { stages: ['build'], included: true, expanded: true }
      const afterExtends = { stages: ['build'], included: true, expanded: true, extended: true }
      const afterReferences = {
        stages: ['build'],
        included: true,
        expanded: true,
        extended: true,
        referenced: true,
      }

      const mockIncludeResolver = {
        resolve: vi.fn().mockResolvedValue(afterInclude),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockReturnValue(afterVariables)
      vi.mocked(resolveExtends).mockReturnValue(afterExtends)
      vi.mocked(resolveReferences).mockReturnValue(afterReferences)

      const processor = new ConfigProcessor('stages: [build]', '/test.yml')
      const result = await processor.process()

      expect(mockIncludeResolver.resolve).toHaveBeenCalledWith(initialConfig)
      expect(expandVariables).toHaveBeenCalledWith(afterInclude)
      expect(resolveExtends).toHaveBeenCalledWith(afterVariables)
      expect(resolveReferences).toHaveBeenCalledWith(afterExtends)
      expect(result.config).toEqual(afterReferences)
    })

    it('should return ProcessedConfig with correct context', async () => {
      const finalConfig = { stages: ['build'], job1: { script: ['test'] } }

      const mockIncludeResolver = {
        resolve: vi.fn().mockResolvedValue(finalConfig),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockReturnValue(finalConfig)
      vi.mocked(resolveExtends).mockReturnValue(finalConfig)
      vi.mocked(resolveReferences).mockReturnValue(finalConfig)

      const processor = new ConfigProcessor('content', '/path/to/ci.yml')
      const result = await processor.process()

      expect(result.config).toEqual(finalConfig)
      expect(result.context).toEqual({
        filePath: '/path/to/ci.yml',
        baseDir: '/path/to',
        includedFiles: new Set(),
        includeStack: [],
        remoteJobs: new Set(),
        gitlabHost: 'gitlab.com',
      })
    })

    it('should handle complex GitLab CI configuration', async () => {
      const yamlContent = `
stages:
  - build
  - test
  - deploy

variables:
  NODE_VERSION: "18"
  APP_NAME: "myapp"

.template:
  image: node:\${NODE_VERSION}
  before_script:
    - npm ci

build:
  extends: .template
  stage: build
  script:
    - npm run build
  artifacts:
    paths:
      - dist/

test:
  extends: .template
  stage: test
  script: !reference [.template, before_script]
  dependencies:
    - build

deploy:
  stage: deploy
  script:
    - echo "Deploying \${APP_NAME}"
  needs:
    - build
    - test
`

      // Mock processors to track what they receive
      const mockIncludeResolver = {
        resolve: vi
          .fn()
          .mockImplementation(async config => ({ ...config, resolved_includes: true })),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockImplementation(config => ({
        ...config,
        expanded_variables: true,
      }))
      vi.mocked(resolveExtends).mockImplementation(config => ({
        ...config,
        resolved_extends: true,
      }))
      vi.mocked(resolveReferences).mockImplementation(config => ({
        ...config,
        resolved_references: true,
      }))

      const processor = new ConfigProcessor(yamlContent, '/complex-ci.yml')
      const result = await processor.process()

      // Verify the pipeline was executed
      expect(mockIncludeResolver.resolve).toHaveBeenCalled()
      expect(expandVariables).toHaveBeenCalled()
      expect(resolveExtends).toHaveBeenCalled()
      expect(resolveReferences).toHaveBeenCalled()

      // Verify the result contains all transformations
      expect(result.config).toHaveProperty('resolved_includes', true)
      expect(result.config).toHaveProperty('expanded_variables', true)
      expect(result.config).toHaveProperty('resolved_extends', true)
      expect(result.config).toHaveProperty('resolved_references', true)
    })
  })

  describe('error handling', () => {
    it('should propagate parsing errors', async () => {
      const invalidYaml = `
stages:
  - build
  - test
invalid: [unclosed
`

      const processor = new ConfigProcessor(invalidYaml, '/test.yml')

      await expect(processor.process()).rejects.toThrow()
    })

    it('should propagate include resolution errors', async () => {
      const mockIncludeResolver = {
        resolve: vi.fn().mockRejectedValue(new Error('Include not found')),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)

      const processor = new ConfigProcessor('stages: [build]', '/test.yml')

      await expect(processor.process()).rejects.toThrow('Include not found')
    })

    it('should propagate variable expansion errors', async () => {
      const mockIncludeResolver = {
        resolve: vi.fn().mockResolvedValue({ stages: ['build'] }),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockImplementation(() => {
        throw new Error('Variable expansion failed')
      })

      const processor = new ConfigProcessor('stages: [build]', '/test.yml')

      await expect(processor.process()).rejects.toThrow('Variable expansion failed')
    })

    it('should propagate extends resolution errors', async () => {
      const mockIncludeResolver = {
        resolve: vi.fn().mockResolvedValue({ stages: ['build'] }),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockReturnValue({ stages: ['build'] })
      vi.mocked(resolveExtends).mockImplementation(() => {
        throw new Error('Extends resolution failed')
      })

      const processor = new ConfigProcessor('stages: [build]', '/test.yml')

      await expect(processor.process()).rejects.toThrow('Extends resolution failed')
    })

    it('should propagate reference resolution errors', async () => {
      const mockIncludeResolver = {
        resolve: vi.fn().mockResolvedValue({ stages: ['build'] }),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockReturnValue({ stages: ['build'] })
      vi.mocked(resolveExtends).mockReturnValue({ stages: ['build'] })
      vi.mocked(resolveReferences).mockImplementation(() => {
        throw new Error('Reference resolution failed')
      })

      const processor = new ConfigProcessor('stages: [build]', '/test.yml')

      await expect(processor.process()).rejects.toThrow('Reference resolution failed')
    })
  })

  describe('edge cases', () => {
    it('should handle empty YAML content', async () => {
      const mockIncludeResolver = {
        resolve: vi.fn().mockImplementation(async config => config),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockImplementation(config => config)
      vi.mocked(resolveExtends).mockImplementation(config => config)
      vi.mocked(resolveReferences).mockImplementation(config => config)

      const processor = new ConfigProcessor('', '/test.yml')
      const result = await processor.process()

      expect(result.config).toEqual(null)
    })

    it('should handle YAML with only comments', async () => {
      const yamlContent = `# This is a comment
# Another comment
`

      const mockIncludeResolver = {
        resolve: vi.fn().mockImplementation(async config => config),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockImplementation(config => config)
      vi.mocked(resolveExtends).mockImplementation(config => config)
      vi.mocked(resolveReferences).mockImplementation(config => config)

      const processor = new ConfigProcessor(yamlContent, '/test.yml')
      const result = await processor.process()

      expect(result.config).toEqual(null)
    })

    it('should handle nested !reference tags', async () => {
      const yamlContent = `
job1:
  variables:
    nested:
      ref1: !reference [.template, vars, key1]
      ref2: !reference [.template, vars, key2]
`

      const mockIncludeResolver = {
        resolve: vi.fn().mockImplementation(async config => config),
      }
      vi.mocked(IncludeResolver).mockImplementation(() => mockIncludeResolver as any)
      vi.mocked(expandVariables).mockImplementation(config => config)
      vi.mocked(resolveExtends).mockImplementation(config => config)
      vi.mocked(resolveReferences).mockImplementation(config => config)

      const processor = new ConfigProcessor(yamlContent, '/test.yml')
      const result = await processor.process()

      expect(result.config['job1']?.variables?.nested?.ref1).toEqual({
        __gitlab_reference: true,
        job: '.template',
        section: 'vars',
        key: 'key1',
      })
      expect(result.config['job1']?.variables?.nested?.ref2).toEqual({
        __gitlab_reference: true,
        job: '.template',
        section: 'vars',
        key: 'key2',
      })
    })
  })
})
