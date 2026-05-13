import type { TestScenario } from '../test-runner/types'

/**
 * Options for converting child pipeline scenarios to parent format.
 */
export interface ScenarioConversionOptions {
  /** Path prefix to add to changes (e.g., "apps/extension/") */
  childPath: string
  /** Branch name mappings (e.g., { master: 'main' }) */
  branchMapping?: Record<string, string>
  /** Output format */
  format?: 'json' | 'yaml'
  /** Job names to exclude from root-level assertions (e.g., component jobs that can't be locally evaluated) */
  excludeJobs?: string[]
  /** Include root-level counts in assertions (default: false) */
  includeRootCounts?: boolean
}

/**
 * Result of scenario conversion operation.
 */
export interface ScenarioConversionResult {
  /** Converted test scenarios */
  scenarios: TestScenario[]
  /** Metadata about the conversion */
  metadata: {
    /** Number of scenarios converted */
    scenariosConverted: number
    /** Trigger job name in parent pipeline */
    triggerJob: string
    /** Child path prefix used */
    childPath: string
  }
}
