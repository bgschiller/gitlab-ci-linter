import { stringify } from 'yaml'
import type { ChildPipelineAssertions, TestAssertions, TestScenario } from '../test-runner/types'
import type { ProcessedConfig } from '../ProcessedConfig'
import { ScenarioLoader } from '../scenario-loader'
import type { ScenarioConversionOptions, ScenarioConversionResult } from './types'

/**
 * Converts standalone child pipeline test scenarios into parent pipeline scenarios
 * with nested childPipelines assertions.
 *
 * This is useful when migrating test scenarios from a child repository
 * (testing the child CI directly) to a parent monorepo structure
 * (testing via the trigger job).
 */
export class ScenarioConverter {
  /**
   * Load test scenarios from a directory or file.
   * Delegates to ScenarioLoader for the actual loading logic.
   *
   * @param path - Directory containing scenario files or a single file path
   * @returns Array of loaded test scenarios
   */
  static loadScenariosFromPath(path: string): TestScenario[] {
    return ScenarioLoader.loadScenariosFromPath(path)
  }

  /**
   * Convert child pipeline scenarios to parent format with nested childPipelines assertions.
   *
   * @param parentConfig - The processed parent CI configuration
   * @param triggerJobName - Name of the trigger job in the parent CI
   * @param childScenarios - Test scenarios from the child CI
   * @param options - Conversion options
   * @returns Converted scenarios with metadata
   */
  static convert(
    parentConfig: ProcessedConfig | null,
    triggerJobName: string,
    childScenarios: TestScenario[],
    options: ScenarioConversionOptions,
  ): ScenarioConversionResult {
    // Validate trigger job exists in parent config if provided
    if (parentConfig) {
      const jobs = parentConfig.getJobs()
      if (!jobs[triggerJobName]) {
        const availableJobs = Object.keys(jobs).filter(name => !name.startsWith('.'))
        throw new Error(
          `Trigger job '${triggerJobName}' not found in parent configuration. ` +
            `Available jobs: ${availableJobs.join(', ')}`,
        )
      }
    }

    const convertedScenarios = childScenarios.map(scenario =>
      this.convertScenario(scenario, triggerJobName, options),
    )

    return {
      scenarios: convertedScenarios,
      metadata: {
        scenariosConverted: convertedScenarios.length,
        triggerJob: triggerJobName,
        childPath: options.childPath,
      },
    }
  }

  /**
   * Convert a single child scenario to parent format.
   *
   * @param childScenario - The child pipeline test scenario
   * @param triggerJobName - Name of the trigger job in parent
   * @param options - Conversion options
   * @returns Converted parent test scenario
   */
  private static convertScenario(
    childScenario: TestScenario,
    triggerJobName: string,
    options: ScenarioConversionOptions,
  ): TestScenario {
    // 1. Transform changes paths - prefix with child path
    const normalizedChildPath = options.childPath.endsWith('/')
      ? options.childPath
      : options.childPath + '/'

    // If the child scenario has explicit changes, prefix them with the child path.
    // If no changes are specified, generate a default wildcard entry — standalone
    // scenarios implicitly change "everything", which maps to everything under
    // the child path in the monorepo context.
    const changes = childScenario.changes
      ? childScenario.changes.map(path => `${normalizedChildPath}${path}`)
      : [`${normalizedChildPath}**/*`]

    // 2. Apply branch mapping to variables
    const variables = this.applyBranchMapping(childScenario.variables, options.branchMapping)

    // 3. Auto-inject MR-specific variables for merge_request_event scenarios.
    // Root CI workflows derive TARGET_CONTEXT and SOURCE_CONTEXT from these variables,
    // so child pipeline rules checking $TARGET_CONTEXT / $SOURCE_CONTEXT need them.
    if (variables['CI_PIPELINE_SOURCE'] === 'merge_request_event') {
      if (!variables['CI_MERGE_REQUEST_TARGET_BRANCH_NAME'] && variables['CI_DEFAULT_BRANCH']) {
        variables['CI_MERGE_REQUEST_TARGET_BRANCH_NAME'] = variables['CI_DEFAULT_BRANCH']
      }
      if (!variables['CI_MERGE_REQUEST_SOURCE_BRANCH_NAME'] && variables['CI_COMMIT_BRANCH']) {
        variables['CI_MERGE_REQUEST_SOURCE_BRANCH_NAME'] = variables['CI_COMMIT_BRANCH']
      }
    }

    // 4. Build parent assertions structure
    const assertions = this.buildParentAssertions(childScenario.assertions, triggerJobName, options)

    return {
      description: childScenario.description,
      variables,
      changes,
      assertions,
    }
  }

  /**
   * Apply branch mapping to variable values.
   * Replaces values matching old branch names with new branch names.
   *
   * @param variables - Original variables
   * @param branchMapping - Mapping of old branch names to new ones
   * @returns Variables with branch names replaced
   */
  private static applyBranchMapping(
    variables: Record<string, string>,
    branchMapping?: Record<string, string>,
  ): Record<string, string> {
    if (!branchMapping || Object.keys(branchMapping).length === 0) {
      return { ...variables }
    }

    const result: Record<string, string> = {}

    for (const [key, value] of Object.entries(variables)) {
      // Check if the value matches any branch in the mapping
      if (branchMapping[value] !== undefined) {
        result[key] = branchMapping[value]
      } else {
        result[key] = value
      }
    }

    return result
  }

  /**
   * Build parent assertions structure from child assertions.
   * Wraps child assertions in childPipelines structure and adds parent trigger job assertion.
   *
   * Root-level counts are omitted by default because they're fragile when the root CI
   * includes components that can't be locally evaluated (e.g., ci-scenario-tests).
   * Use `includeRootCounts` option to opt-in.
   *
   * @param childAssertions - Assertions from child scenario
   * @param triggerJobName - Name of the trigger job
   * @param options - Conversion options
   * @returns Parent assertions structure
   */
  private static buildParentAssertions(
    childAssertions: TestAssertions,
    triggerJobName: string,
    options: ScenarioConversionOptions,
  ): TestAssertions {
    // Create child pipeline assertions from the original child assertions
    const childPipelineAssertions: ChildPipelineAssertions = {}

    // Copy jobs assertions
    if (childAssertions.jobs) {
      childPipelineAssertions.jobs = { ...childAssertions.jobs }
    }

    // Copy counts assertions
    if (childAssertions.counts) {
      childPipelineAssertions.counts = { ...childAssertions.counts }
    }

    // Handle nested childPipelines if the child already has them (grandchildren)
    if (childAssertions.childPipelines) {
      childPipelineAssertions.childPipelines = { ...childAssertions.childPipelines }
    }

    // Build parent assertions
    const assertions: TestAssertions = {
      jobs: {
        [triggerJobName]: 'automatic',
      },
      childPipelines: {
        [triggerJobName]: childPipelineAssertions,
      },
    }

    // Only include root-level counts when explicitly requested
    if (options.includeRootCounts) {
      assertions.counts = {
        automatic: 1,
        total: 1,
      }
    }

    return assertions
  }

  /**
   * Format conversion result as JSON or YAML string.
   *
   * @param result - Conversion result
   * @param format - Output format
   * @returns Formatted string
   */
  static formatOutput(result: ScenarioConversionResult, format: 'json' | 'yaml'): string {
    if (format === 'json') {
      return JSON.stringify(result.scenarios, null, 2)
    }

    // YAML format with document separators
    return result.scenarios
      .map(scenario => {
        const yamlScenario = {
          description: scenario.description,
          variables: scenario.variables,
          changes: scenario.changes,
          assertions: scenario.assertions,
        }
        return stringify(yamlScenario, {
          indent: 2,
          lineWidth: 0,
          minContentWidth: 0,
        }).trim()
      })
      .join('\n---\n')
  }

  /**
   * Generate a filename for a single scenario file.
   * Format: "01-main-branch-push.yaml" (zero-padded index + slugified description).
   *
   * @param scenario - The test scenario
   * @param index - Zero-based index of the scenario
   * @param format - Output format ('json' or 'yaml')
   * @returns Filename string
   */
  static formatScenarioFileName(
    scenario: TestScenario,
    index: number,
    format: 'json' | 'yaml' = 'yaml',
  ): string {
    const paddedIndex = String(index + 1).padStart(2, '0')
    const slug = this.slugify(scenario.description || `scenario-${index + 1}`)
    const ext = format === 'json' ? 'json' : 'yaml'
    return `${paddedIndex}-${slug}.${ext}`
  }

  /**
   * Format a single scenario as a YAML or JSON string.
   *
   * @param scenario - The test scenario
   * @param format - Output format ('json' or 'yaml')
   * @returns Formatted string for a single scenario
   */
  static formatSingleScenario(scenario: TestScenario, format: 'json' | 'yaml' = 'yaml'): string {
    if (format === 'json') {
      return JSON.stringify(scenario, null, 2)
    }

    const yamlScenario = {
      description: scenario.description,
      variables: scenario.variables,
      ...(scenario.changes && scenario.changes.length > 0 && { changes: scenario.changes }),
      ...(scenario.assertions && { assertions: scenario.assertions }),
    }
    return stringify(yamlScenario, {
      indent: 2,
      lineWidth: 0,
      minContentWidth: 0,
    }).trim()
  }

  /**
   * Convert a text string to a URL/filename-friendly slug.
   */
  private static slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  /**
   * Parse branch mapping from CLI string format.
   * Format: "old1:new1,old2:new2" (e.g., "master:main,develop:development")
   *
   * @param mappingStr - Comma-separated key:value pairs
   * @returns Branch mapping object
   */
  static parseBranchMapping(mappingStr: string): Record<string, string> {
    const mapping: Record<string, string> = {}

    if (!mappingStr || mappingStr.trim() === '') {
      return mapping
    }

    const pairs = mappingStr.split(',')
    for (const pair of pairs) {
      const [oldBranch, newBranch] = pair.split(':').map(s => s.trim())
      if (oldBranch && newBranch) {
        mapping[oldBranch] = newBranch
      }
    }

    return mapping
  }
}
