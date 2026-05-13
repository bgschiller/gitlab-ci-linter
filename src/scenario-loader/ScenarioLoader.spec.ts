import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ScenarioLoader } from './ScenarioLoader'

describe('ScenarioLoader', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scenario-loader-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('loadScenariosFromPath', () => {
    it('should load a single YAML file', () => {
      const content = `
description: "Main branch push"
variables:
  CI_COMMIT_BRANCH: main
assertions:
  jobs:
    build: automatic
`
      writeFileSync(join(tempDir, 'scenario.yaml'), content)

      const scenarios = ScenarioLoader.loadScenariosFromPath(join(tempDir, 'scenario.yaml'))

      expect(scenarios).toHaveLength(1)
      expect(scenarios[0]!.description).toBe('Main branch push')
      expect(scenarios[0]!.variables['CI_COMMIT_BRANCH']).toBe('main')
    })

    it('should load a multi-document YAML file', () => {
      const content = `
description: "First"
variables:
  CI_COMMIT_BRANCH: main
assertions:
  jobs:
    build: automatic
---
description: "Second"
variables:
  CI_COMMIT_BRANCH: develop
assertions:
  jobs:
    build: skipped
`
      writeFileSync(join(tempDir, 'multi.yaml'), content)

      const scenarios = ScenarioLoader.loadScenariosFromPath(join(tempDir, 'multi.yaml'))

      expect(scenarios).toHaveLength(2)
      expect(scenarios[0]!.description).toBe('First')
      expect(scenarios[1]!.description).toBe('Second')
    })

    it('should load a JSON file with single object', () => {
      const content = JSON.stringify({
        description: 'JSON scenario',
        variables: { CI_COMMIT_BRANCH: 'main' },
        assertions: { jobs: { build: 'automatic' } },
      })
      writeFileSync(join(tempDir, 'scenario.json'), content)

      const scenarios = ScenarioLoader.loadScenariosFromPath(join(tempDir, 'scenario.json'))

      expect(scenarios).toHaveLength(1)
      expect(scenarios[0]!.description).toBe('JSON scenario')
    })

    it('should load a JSON file with array', () => {
      const content = JSON.stringify([
        {
          description: 'First',
          variables: { CI_COMMIT_BRANCH: 'main' },
          assertions: { jobs: { build: 'automatic' } },
        },
        {
          description: 'Second',
          variables: { CI_COMMIT_BRANCH: 'develop' },
          assertions: { jobs: { build: 'skipped' } },
        },
      ])
      writeFileSync(join(tempDir, 'scenarios.json'), content)

      const scenarios = ScenarioLoader.loadScenariosFromPath(join(tempDir, 'scenarios.json'))

      expect(scenarios).toHaveLength(2)
    })

    it('should load all scenarios from a flat directory', () => {
      writeFileSync(
        join(tempDir, 'a.yaml'),
        'description: "A"\nvariables:\n  X: "1"\nassertions:\n  jobs:\n    build: automatic\n',
      )
      writeFileSync(
        join(tempDir, 'b.yml'),
        'description: "B"\nvariables:\n  X: "2"\nassertions:\n  jobs:\n    build: skipped\n',
      )

      const scenarios = ScenarioLoader.loadScenariosFromPath(tempDir)

      expect(scenarios).toHaveLength(2)
      const descriptions = scenarios.map(s => s.description)
      expect(descriptions).toContain('A')
      expect(descriptions).toContain('B')
    })

    it('should recursively load from subdirectories', () => {
      const subDir = join(tempDir, 'nested')
      const deepDir = join(subDir, 'deep')
      mkdirSync(deepDir, { recursive: true })

      writeFileSync(
        join(tempDir, 'root.yaml'),
        'description: "Root"\nvariables:\n  X: "1"\nassertions:\n  jobs:\n    build: automatic\n',
      )
      writeFileSync(
        join(subDir, 'middle.yaml'),
        'description: "Middle"\nvariables:\n  X: "2"\nassertions:\n  jobs:\n    build: automatic\n',
      )
      writeFileSync(
        join(deepDir, 'deep.yaml'),
        'description: "Deep"\nvariables:\n  X: "3"\nassertions:\n  jobs:\n    build: automatic\n',
      )

      const scenarios = ScenarioLoader.loadScenariosFromPath(tempDir)

      expect(scenarios).toHaveLength(3)
      const descriptions = scenarios.map(s => s.description)
      expect(descriptions).toContain('Root')
      expect(descriptions).toContain('Middle')
      expect(descriptions).toContain('Deep')
    })

    it('should throw for nonexistent path', () => {
      expect(() => ScenarioLoader.loadScenariosFromPath('/nonexistent/path')).toThrow(
        'Path not found',
      )
    })

    it('should return empty array for empty directory', () => {
      const emptyDir = join(tempDir, 'empty')
      mkdirSync(emptyDir)

      const scenarios = ScenarioLoader.loadScenariosFromPath(emptyDir)

      expect(scenarios).toHaveLength(0)
    })

    it('should skip non-scenario files in directory', () => {
      writeFileSync(join(tempDir, 'readme.md'), '# Not a scenario')
      writeFileSync(join(tempDir, 'config.txt'), 'some config')
      writeFileSync(
        join(tempDir, 'actual.yaml'),
        'description: "Real"\nvariables:\n  X: "1"\nassertions:\n  jobs:\n    build: automatic\n',
      )

      const scenarios = ScenarioLoader.loadScenariosFromPath(tempDir)

      expect(scenarios).toHaveLength(1)
      expect(scenarios[0]!.description).toBe('Real')
    })

    it('should throw for unsupported file format', () => {
      const filePath = join(tempDir, 'scenario.txt')
      writeFileSync(filePath, 'some content')

      expect(() => ScenarioLoader.loadScenariosFromFile(filePath)).toThrow(
        'Unsupported file format',
      )
    })

    it('should load files in sorted order from directory', () => {
      writeFileSync(
        join(tempDir, '02-second.yaml'),
        'description: "Second"\nvariables:\n  X: "2"\nassertions:\n  jobs:\n    build: automatic\n',
      )
      writeFileSync(
        join(tempDir, '01-first.yaml'),
        'description: "First"\nvariables:\n  X: "1"\nassertions:\n  jobs:\n    build: automatic\n',
      )

      const scenarios = ScenarioLoader.loadScenariosFromPath(tempDir)

      expect(scenarios).toHaveLength(2)
      expect(scenarios[0]!.description).toBe('First')
      expect(scenarios[1]!.description).toBe('Second')
    })
  })

  describe('parseYamlScenarios', () => {
    it('should parse a single YAML document', () => {
      const content = `
description: "Test"
variables:
  X: "1"
`
      const scenarios = ScenarioLoader.parseYamlScenarios(content)

      expect(scenarios).toHaveLength(1)
      expect(scenarios[0]!.description).toBe('Test')
    })

    it('should parse multiple YAML documents separated by ---', () => {
      const content = `description: "A"
variables:
  X: "1"
---
description: "B"
variables:
  X: "2"
---
description: "C"
variables:
  X: "3"
`
      const scenarios = ScenarioLoader.parseYamlScenarios(content)

      expect(scenarios).toHaveLength(3)
    })

    it('should skip empty documents', () => {
      const content = `
description: "A"
variables:
  X: "1"
---

---
description: "B"
variables:
  X: "2"
`
      const scenarios = ScenarioLoader.parseYamlScenarios(content)

      expect(scenarios).toHaveLength(2)
    })
  })
})
