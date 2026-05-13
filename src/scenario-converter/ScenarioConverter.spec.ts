import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ScenarioConverter } from './ScenarioConverter'
import type { TestScenario } from '../test-runner/types'

describe('ScenarioConverter', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scenario-converter-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('loadScenariosFromPath', () => {
    it('should load a single YAML scenario file', () => {
      const scenarioContent = `
description: "Test scenario"
variables:
  CI_COMMIT_BRANCH: main
  CI_PIPELINE_SOURCE: push
assertions:
  jobs:
    build: automatic
`
      const filePath = join(tempDir, 'scenario.yaml')
      writeFileSync(filePath, scenarioContent)

      const scenarios = ScenarioConverter.loadScenariosFromPath(filePath)

      expect(scenarios).toHaveLength(1)
      expect(scenarios[0]!.description).toBe('Test scenario')
      expect(scenarios[0]!.variables['CI_COMMIT_BRANCH']).toBe('main')
    })

    it('should load multi-document YAML files', () => {
      const scenarioContent = `
description: "First scenario"
variables:
  CI_COMMIT_BRANCH: main
assertions:
  jobs:
    build: automatic
---
description: "Second scenario"
variables:
  CI_COMMIT_BRANCH: develop
assertions:
  jobs:
    build: automatic
`
      const filePath = join(tempDir, 'scenarios.yaml')
      writeFileSync(filePath, scenarioContent)

      const scenarios = ScenarioConverter.loadScenariosFromPath(filePath)

      expect(scenarios).toHaveLength(2)
      expect(scenarios[0]!.description).toBe('First scenario')
      expect(scenarios[1]!.description).toBe('Second scenario')
    })

    it('should load JSON scenario files', () => {
      const scenarios: TestScenario[] = [
        {
          description: 'JSON scenario',
          variables: { CI_COMMIT_BRANCH: 'main' },
          assertions: { jobs: { build: 'automatic' } },
        },
      ]
      const filePath = join(tempDir, 'scenarios.json')
      writeFileSync(filePath, JSON.stringify(scenarios))

      const loaded = ScenarioConverter.loadScenariosFromPath(filePath)

      expect(loaded).toHaveLength(1)
      expect(loaded[0]!.description).toBe('JSON scenario')
    })

    it('should load all scenarios from a directory', () => {
      const scenario1 = `
description: "First"
variables:
  CI_COMMIT_BRANCH: main
assertions:
  jobs:
    build: automatic
`
      const scenario2 = `
description: "Second"
variables:
  CI_COMMIT_BRANCH: develop
assertions:
  jobs:
    build: automatic
`
      writeFileSync(join(tempDir, 'one.yaml'), scenario1)
      writeFileSync(join(tempDir, 'two.yml'), scenario2)

      const scenarios = ScenarioConverter.loadScenariosFromPath(tempDir)

      expect(scenarios).toHaveLength(2)
      const descriptions = scenarios.map(s => s.description)
      expect(descriptions).toContain('First')
      expect(descriptions).toContain('Second')
    })

    it('should recursively load from subdirectories', () => {
      const subDir = join(tempDir, 'sub')
      mkdirSync(subDir)

      const scenario1 = `
description: "Root scenario"
variables:
  CI_COMMIT_BRANCH: main
assertions:
  jobs:
    build: automatic
`
      const scenario2 = `
description: "Sub scenario"
variables:
  CI_COMMIT_BRANCH: develop
assertions:
  jobs:
    build: automatic
`
      writeFileSync(join(tempDir, 'root.yaml'), scenario1)
      writeFileSync(join(subDir, 'nested.yaml'), scenario2)

      const scenarios = ScenarioConverter.loadScenariosFromPath(tempDir)

      expect(scenarios).toHaveLength(2)
      const descriptions = scenarios.map(s => s.description)
      expect(descriptions).toContain('Root scenario')
      expect(descriptions).toContain('Sub scenario')
    })

    it('should throw error for non-existent path', () => {
      expect(() => {
        ScenarioConverter.loadScenariosFromPath('/nonexistent/path')
      }).toThrow('Path not found')
    })
  })

  describe('convert', () => {
    const childScenarios: TestScenario[] = [
      {
        description: 'Merge request to master branch',
        variables: {
          CI_PIPELINE_SOURCE: 'merge_request_event',
          CI_COMMIT_BRANCH: 'feature/test-branch',
          CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'master',
        },
        changes: ['src/js/features/assistant/index.ts', 'package.json'],
        assertions: {
          jobs: {
            'build-chrome': 'automatic',
            lint: 'automatic',
            'test-unit-chromium-bg-shared': 'automatic',
          },
          counts: {
            automatic: 3,
            total: 3,
          },
        },
      },
    ]

    it('should convert child scenarios to parent format', () => {
      const result = ScenarioConverter.convert(null, 'trigger-extension', childScenarios, {
        childPath: 'apps/extension/',
      })

      expect(result.scenarios).toHaveLength(1)
      expect(result.metadata.scenariosConverted).toBe(1)
      expect(result.metadata.triggerJob).toBe('trigger-extension')
      expect(result.metadata.childPath).toBe('apps/extension/')
    })

    it('should prefix changes with child path', () => {
      const result = ScenarioConverter.convert(null, 'trigger-extension', childScenarios, {
        childPath: 'apps/extension/',
      })

      const converted = result.scenarios[0]!
      expect(converted.changes).toEqual([
        'apps/extension/src/js/features/assistant/index.ts',
        'apps/extension/package.json',
      ])
    })

    it('should add trailing slash to child path if missing', () => {
      const result = ScenarioConverter.convert(null, 'trigger-extension', childScenarios, {
        childPath: 'apps/extension', // no trailing slash
      })

      const converted = result.scenarios[0]!
      expect(converted.changes![0]).toBe('apps/extension/src/js/features/assistant/index.ts')
    })

    it('should apply branch mapping to variables', () => {
      const result = ScenarioConverter.convert(null, 'trigger-extension', childScenarios, {
        childPath: 'apps/extension/',
        branchMapping: { master: 'main' },
      })

      const converted = result.scenarios[0]!
      expect(converted.variables['CI_MERGE_REQUEST_TARGET_BRANCH_NAME']).toBe('main')
    })

    it('should wrap child assertions in childPipelines structure', () => {
      const result = ScenarioConverter.convert(null, 'trigger-extension', childScenarios, {
        childPath: 'apps/extension/',
      })

      const converted = result.scenarios[0]!

      // Parent should have trigger job assertion
      expect(converted.assertions.jobs).toEqual({
        'trigger-extension': 'automatic',
      })

      // Parent should NOT have root-level counts by default (fragile with component jobs)
      expect(converted.assertions.counts).toBeUndefined()

      // Child assertions should be nested under childPipelines
      expect(converted.assertions.childPipelines).toBeDefined()
      expect(converted.assertions.childPipelines!['trigger-extension']).toBeDefined()
      expect(converted.assertions.childPipelines!['trigger-extension']!.jobs).toEqual({
        'build-chrome': 'automatic',
        lint: 'automatic',
        'test-unit-chromium-bg-shared': 'automatic',
      })
      expect(converted.assertions.childPipelines!['trigger-extension']!.counts).toEqual({
        automatic: 3,
        total: 3,
      })
    })

    it('should preserve description', () => {
      const result = ScenarioConverter.convert(null, 'trigger-extension', childScenarios, {
        childPath: 'apps/extension/',
      })

      expect(result.scenarios[0]!.description).toBe('Merge request to master branch')
    })

    it('should handle multiple branch mappings', () => {
      const scenarios: TestScenario[] = [
        {
          description: 'Test',
          variables: {
            CI_COMMIT_BRANCH: 'develop',
            CI_DEFAULT_BRANCH: 'master',
          },
          assertions: { jobs: { build: 'automatic' } },
        },
      ]

      const result = ScenarioConverter.convert(null, 'trigger', scenarios, {
        childPath: 'child/',
        branchMapping: { master: 'main', develop: 'development' },
      })

      expect(result.scenarios[0]!.variables['CI_COMMIT_BRANCH']).toBe('development')
      expect(result.scenarios[0]!.variables['CI_DEFAULT_BRANCH']).toBe('main')
    })

    it('should generate default changes for scenarios without changes', () => {
      const scenarios: TestScenario[] = [
        {
          description: 'No changes scenario',
          variables: { CI_COMMIT_BRANCH: 'main' },
          assertions: { jobs: { build: 'automatic' } },
        },
      ]

      const result = ScenarioConverter.convert(null, 'trigger', scenarios, {
        childPath: 'child/',
      })

      expect(result.scenarios[0]!.changes).toEqual(['child/**/*'])
    })

    it('should generate default changes with normalized path when childPath lacks trailing slash', () => {
      const scenarios: TestScenario[] = [
        {
          description: 'No changes scenario',
          variables: { CI_COMMIT_BRANCH: 'main' },
          assertions: { jobs: { build: 'automatic' } },
        },
      ]

      const result = ScenarioConverter.convert(null, 'trigger', scenarios, {
        childPath: 'apps/service',
      })

      expect(result.scenarios[0]!.changes).toEqual(['apps/service/**/*'])
    })

    it('should handle nested childPipelines in source (grandchildren)', () => {
      const scenarios: TestScenario[] = [
        {
          description: 'Scenario with grandchild',
          variables: { CI_COMMIT_BRANCH: 'main' },
          assertions: {
            jobs: { build: 'automatic' },
            childPipelines: {
              'trigger-grandchild': {
                jobs: { 'grandchild-job': 'automatic' },
              },
            },
          },
        },
      ]

      const result = ScenarioConverter.convert(null, 'trigger-child', scenarios, {
        childPath: 'child/',
      })

      const converted = result.scenarios[0]!
      expect(converted.assertions.childPipelines!['trigger-child']!.childPipelines).toEqual({
        'trigger-grandchild': {
          jobs: { 'grandchild-job': 'automatic' },
        },
      })
    })
  })

  describe('formatOutput', () => {
    const scenarios: TestScenario[] = [
      {
        description: 'Test scenario',
        variables: { CI_COMMIT_BRANCH: 'main' },
        changes: ['src/app.ts'],
        assertions: {
          jobs: { trigger: 'automatic' },
          counts: { automatic: 1, total: 1 },
          childPipelines: {
            trigger: {
              jobs: { build: 'automatic' },
            },
          },
        },
      },
    ]

    it('should format as JSON', () => {
      const result = {
        scenarios,
        metadata: { scenariosConverted: 1, triggerJob: 'trigger', childPath: 'child/' },
      }

      const output = ScenarioConverter.formatOutput(result, 'json')
      const parsed = JSON.parse(output)

      expect(parsed).toHaveLength(1)
      expect(parsed[0].description).toBe('Test scenario')
    })

    it('should format as YAML', () => {
      const result = {
        scenarios,
        metadata: { scenariosConverted: 1, triggerJob: 'trigger', childPath: 'child/' },
      }

      const output = ScenarioConverter.formatOutput(result, 'yaml')

      expect(output).toContain('description: Test scenario')
      expect(output).toContain('CI_COMMIT_BRANCH: main')
      expect(output).toContain('childPipelines:')
    })

    it('should separate multiple scenarios with ---', () => {
      const multipleScenarios: TestScenario[] = [
        {
          description: 'First',
          variables: { CI_COMMIT_BRANCH: 'main' },
          assertions: { jobs: { trigger: 'automatic' } },
        },
        {
          description: 'Second',
          variables: { CI_COMMIT_BRANCH: 'develop' },
          assertions: { jobs: { trigger: 'automatic' } },
        },
      ]

      const result = {
        scenarios: multipleScenarios,
        metadata: { scenariosConverted: 2, triggerJob: 'trigger', childPath: 'child/' },
      }

      const output = ScenarioConverter.formatOutput(result, 'yaml')

      expect(output).toContain('---')
      expect(output.match(/description:/g)!.length).toBe(2)
    })
  })

  describe('includeRootCounts', () => {
    const scenarios: TestScenario[] = [
      {
        description: 'Test',
        variables: { CI_COMMIT_BRANCH: 'main', CI_PIPELINE_SOURCE: 'push' },
        assertions: { jobs: { build: 'automatic' }, counts: { automatic: 1, total: 1 } },
      },
    ]

    it('should include root-level counts when includeRootCounts is true', () => {
      const result = ScenarioConverter.convert(null, 'trigger', scenarios, {
        childPath: 'child/',
        includeRootCounts: true,
      })

      expect(result.scenarios[0]!.assertions.counts).toEqual({
        automatic: 1,
        total: 1,
      })
    })

    it('should omit root-level counts by default', () => {
      const result = ScenarioConverter.convert(null, 'trigger', scenarios, {
        childPath: 'child/',
      })

      expect(result.scenarios[0]!.assertions.counts).toBeUndefined()
    })
  })

  describe('auto-inject MR-specific variables', () => {
    it('should add CI_MERGE_REQUEST_TARGET_BRANCH_NAME for MR scenarios missing it', () => {
      const mrScenarios: TestScenario[] = [
        {
          description: 'MR without target branch',
          variables: {
            CI_PIPELINE_SOURCE: 'merge_request_event',
            CI_COMMIT_BRANCH: 'feature/test',
            CI_DEFAULT_BRANCH: 'main',
          },
          assertions: { jobs: { build: 'automatic' } },
        },
      ]

      const result = ScenarioConverter.convert(null, 'trigger', mrScenarios, {
        childPath: 'child/',
      })

      expect(result.scenarios[0]!.variables['CI_MERGE_REQUEST_TARGET_BRANCH_NAME']).toBe('main')
    })

    it('should add CI_MERGE_REQUEST_SOURCE_BRANCH_NAME from CI_COMMIT_BRANCH', () => {
      const mrScenarios: TestScenario[] = [
        {
          description: 'MR without source branch',
          variables: {
            CI_PIPELINE_SOURCE: 'merge_request_event',
            CI_COMMIT_BRANCH: 'feature/test',
            CI_DEFAULT_BRANCH: 'main',
          },
          assertions: { jobs: { build: 'automatic' } },
        },
      ]

      const result = ScenarioConverter.convert(null, 'trigger', mrScenarios, {
        childPath: 'child/',
      })

      expect(result.scenarios[0]!.variables['CI_MERGE_REQUEST_SOURCE_BRANCH_NAME']).toBe(
        'feature/test',
      )
    })

    it('should not overwrite existing CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', () => {
      const mrScenarios: TestScenario[] = [
        {
          description: 'MR with explicit source',
          variables: {
            CI_PIPELINE_SOURCE: 'merge_request_event',
            CI_COMMIT_BRANCH: 'feature/test',
            CI_DEFAULT_BRANCH: 'main',
            CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'bugfix/hotfix',
          },
          assertions: { jobs: { build: 'automatic' } },
        },
      ]

      const result = ScenarioConverter.convert(null, 'trigger', mrScenarios, {
        childPath: 'child/',
      })

      expect(result.scenarios[0]!.variables['CI_MERGE_REQUEST_SOURCE_BRANCH_NAME']).toBe(
        'bugfix/hotfix',
      )
    })

    it('should not overwrite existing CI_MERGE_REQUEST_TARGET_BRANCH_NAME', () => {
      const mrScenarios: TestScenario[] = [
        {
          description: 'MR with explicit target',
          variables: {
            CI_PIPELINE_SOURCE: 'merge_request_event',
            CI_COMMIT_BRANCH: 'feature/test',
            CI_DEFAULT_BRANCH: 'main',
            CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'develop',
          },
          assertions: { jobs: { build: 'automatic' } },
        },
      ]

      const result = ScenarioConverter.convert(null, 'trigger', mrScenarios, {
        childPath: 'child/',
      })

      expect(result.scenarios[0]!.variables['CI_MERGE_REQUEST_TARGET_BRANCH_NAME']).toBe('develop')
    })

    it('should not inject for non-MR scenarios', () => {
      const pushScenarios: TestScenario[] = [
        {
          description: 'Push event',
          variables: {
            CI_PIPELINE_SOURCE: 'push',
            CI_COMMIT_BRANCH: 'main',
            CI_DEFAULT_BRANCH: 'main',
          },
          assertions: { jobs: { build: 'automatic' } },
        },
      ]

      const result = ScenarioConverter.convert(null, 'trigger', pushScenarios, {
        childPath: 'child/',
      })

      expect(result.scenarios[0]!.variables['CI_MERGE_REQUEST_TARGET_BRANCH_NAME']).toBeUndefined()
    })

    it('should apply branch mapping before injecting target branch', () => {
      const mrScenarios: TestScenario[] = [
        {
          description: 'MR with mapping',
          variables: {
            CI_PIPELINE_SOURCE: 'merge_request_event',
            CI_COMMIT_BRANCH: 'feature/test',
            CI_DEFAULT_BRANCH: 'master',
          },
          assertions: { jobs: { build: 'automatic' } },
        },
      ]

      const result = ScenarioConverter.convert(null, 'trigger', mrScenarios, {
        childPath: 'child/',
        branchMapping: { master: 'main' },
      })

      // CI_DEFAULT_BRANCH was mapped from master -> main, and that should be used for target branch
      expect(result.scenarios[0]!.variables['CI_DEFAULT_BRANCH']).toBe('main')
      expect(result.scenarios[0]!.variables['CI_MERGE_REQUEST_TARGET_BRANCH_NAME']).toBe('main')
    })
  })

  describe('excludeJobs', () => {
    const scenarios: TestScenario[] = [
      {
        description: 'Test',
        variables: { CI_COMMIT_BRANCH: 'main', CI_PIPELINE_SOURCE: 'push' },
        assertions: {
          jobs: { build: 'automatic', lint: 'automatic' },
          counts: { automatic: 2, total: 2 },
        },
      },
    ]

    it('should not affect child pipeline assertions', () => {
      const result = ScenarioConverter.convert(null, 'trigger', scenarios, {
        childPath: 'child/',
        excludeJobs: ['ci-scenario-tests'],
      })

      // Child pipeline assertions should still have all original jobs
      expect(result.scenarios[0]!.assertions.childPipelines!['trigger']!.jobs).toEqual({
        build: 'automatic',
        lint: 'automatic',
      })
    })

    it('should not add excluded jobs to root assertions', () => {
      const result = ScenarioConverter.convert(null, 'trigger', scenarios, {
        childPath: 'child/',
        excludeJobs: ['ci-scenario-tests'],
      })

      // Root assertions should only have the trigger job, no ci-scenario-tests
      expect(result.scenarios[0]!.assertions.jobs).toEqual({
        trigger: 'automatic',
      })
    })
  })

  describe('formatScenarioFileName', () => {
    it('should generate filename from description', () => {
      const scenario: TestScenario = {
        description: 'Main branch push',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { build: 'automatic' } },
      }

      expect(ScenarioConverter.formatScenarioFileName(scenario, 0)).toBe('01-main-branch-push.yaml')
    })

    it('should use zero-padded index', () => {
      const scenario: TestScenario = {
        description: 'Test',
        variables: {},
        assertions: { jobs: {} },
      }

      expect(ScenarioConverter.formatScenarioFileName(scenario, 9)).toBe('10-test.yaml')
    })

    it('should fall back to scenario-N when no description', () => {
      const scenario: TestScenario = {
        variables: {},
        assertions: { jobs: {} },
      }

      expect(ScenarioConverter.formatScenarioFileName(scenario, 2)).toBe('03-scenario-3.yaml')
    })

    it('should use json extension for json format', () => {
      const scenario: TestScenario = {
        description: 'Test',
        variables: {},
        assertions: { jobs: {} },
      }

      expect(ScenarioConverter.formatScenarioFileName(scenario, 0, 'json')).toBe('01-test.json')
    })
  })

  describe('formatSingleScenario', () => {
    it('should format as YAML', () => {
      const scenario: TestScenario = {
        description: 'Test',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { trigger: 'automatic' } },
      }

      const output = ScenarioConverter.formatSingleScenario(scenario)
      expect(output).toContain('description: Test')
      expect(output).toContain('CI_COMMIT_BRANCH: main')
      expect(output).not.toContain('---')
    })

    it('should format as JSON', () => {
      const scenario: TestScenario = {
        description: 'Test',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { trigger: 'automatic' } },
      }

      const output = ScenarioConverter.formatSingleScenario(scenario, 'json')
      const parsed = JSON.parse(output)
      expect(parsed.description).toBe('Test')
    })

    it('should omit empty changes array', () => {
      const scenario: TestScenario = {
        description: 'Test',
        variables: {},
        assertions: { jobs: {} },
      }

      const output = ScenarioConverter.formatSingleScenario(scenario)
      expect(output).not.toContain('changes:')
    })
  })

  describe('parseBranchMapping', () => {
    it('should parse single mapping', () => {
      const mapping = ScenarioConverter.parseBranchMapping('master:main')

      expect(mapping).toEqual({ master: 'main' })
    })

    it('should parse multiple mappings', () => {
      const mapping = ScenarioConverter.parseBranchMapping('master:main,develop:development')

      expect(mapping).toEqual({ master: 'main', develop: 'development' })
    })

    it('should handle whitespace', () => {
      const mapping = ScenarioConverter.parseBranchMapping(' master : main , develop : dev ')

      expect(mapping).toEqual({ master: 'main', develop: 'dev' })
    })

    it('should return empty object for empty string', () => {
      const mapping = ScenarioConverter.parseBranchMapping('')

      expect(mapping).toEqual({})
    })

    it('should handle invalid entries gracefully', () => {
      const mapping = ScenarioConverter.parseBranchMapping('master:main,invalid,develop:dev')

      expect(mapping).toEqual({ master: 'main', develop: 'dev' })
    })
  })
})
