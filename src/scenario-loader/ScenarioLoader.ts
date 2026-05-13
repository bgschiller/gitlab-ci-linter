import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { extname, join } from 'path'
import { parse as parseYaml } from 'yaml'
import type { TestScenario } from '../test-runner/types'

/**
 * Shared utility for loading test scenarios from files and directories.
 * Supports YAML (single and multi-document), JSON, and recursive directory loading.
 */
export class ScenarioLoader {
  /**
   * Load test scenarios from a directory or file.
   * Supports YAML and JSON files, including YAML with multiple documents.
   *
   * @param path - Directory containing scenario files or a single file path
   * @returns Array of loaded test scenarios
   */
  static loadScenariosFromPath(path: string): TestScenario[] {
    if (!existsSync(path)) {
      throw new Error(`Path not found: ${path}`)
    }

    const stats = statSync(path)

    if (stats.isFile()) {
      return this.loadScenariosFromFile(path)
    }

    if (stats.isDirectory()) {
      return this.loadScenariosFromDirectory(path)
    }

    throw new Error(`Invalid path type: ${path}`)
  }

  /**
   * Load test scenarios from a single file.
   *
   * @param filePath - Path to the scenario file
   * @returns Array of loaded test scenarios
   */
  static loadScenariosFromFile(filePath: string): TestScenario[] {
    const content = readFileSync(filePath, 'utf8')
    const ext = extname(filePath).toLowerCase()

    if (ext === '.yaml' || ext === '.yml') {
      return this.parseYamlScenarios(content)
    } else if (ext === '.json') {
      const parsed = JSON.parse(content)
      return Array.isArray(parsed) ? parsed : [parsed]
    } else {
      throw new Error(`Unsupported file format: ${ext}`)
    }
  }

  /**
   * Load all test scenarios from a directory.
   * Recursively loads all .yaml, .yml, and .json files.
   *
   * @param dirPath - Directory path
   * @returns Array of loaded test scenarios
   */
  static loadScenariosFromDirectory(dirPath: string): TestScenario[] {
    const scenarios: TestScenario[] = []
    const entries = readdirSync(dirPath).sort()

    for (const entry of entries) {
      const fullPath = join(dirPath, entry)
      const stats = statSync(fullPath)

      if (stats.isFile()) {
        const ext = extname(entry).toLowerCase()
        if (ext === '.yaml' || ext === '.yml' || ext === '.json') {
          try {
            const fileScenarios = this.loadScenariosFromFile(fullPath)
            scenarios.push(...fileScenarios)
          } catch (error) {
            // Skip files that fail to parse
            console.warn(`Warning: Failed to parse ${fullPath}: ${error}`)
          }
        }
      } else if (stats.isDirectory()) {
        // Recursively process subdirectories
        const subScenarios = this.loadScenariosFromDirectory(fullPath)
        scenarios.push(...subScenarios)
      }
    }

    return scenarios
  }

  /**
   * Parse YAML content that may contain multiple documents (separated by ---).
   *
   * @param content - YAML content string
   * @returns Array of parsed test scenarios
   */
  static parseYamlScenarios(content: string): TestScenario[] {
    const scenarios: TestScenario[] = []

    // Split by document separator
    const documents = content.split(/^---$/m).filter(doc => doc.trim())

    for (const doc of documents) {
      const parsed = parseYaml(doc)
      if (parsed && typeof parsed === 'object') {
        scenarios.push(parsed as TestScenario)
      }
    }

    return scenarios
  }
}
