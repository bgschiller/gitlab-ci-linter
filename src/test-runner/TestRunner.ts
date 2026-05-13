import type { EvaluationContext } from '../rule-evaluation'
import type { ProcessedConfig } from '../ProcessedConfig'
import { RuleEvaluator } from '../rule-evaluation'
import { checkAllAssertions, checkChildPipelineAssertions } from './assertionChecker'
import type { AggregateTestResult, TestResult, TestScenario } from './types'
import { ChildPipelineEvaluator, type ChildPipelineOptions } from '../child-pipeline'
import type { LinterOptions } from '../linter'

/**
 * TestRunner executes test scenarios against a processed GitLab CI configuration.
 * It evaluates job rules and checks assertions about job states and counts.
 */
export class TestRunner {
  /**
   * Run a test scenario against a processed configuration.
   * @param scenario - The test scenario with variables, changes, and assertions
   * @param config - The processed GitLab CI configuration
   * @returns Test result with all assertion outcomes
   */
  static runTest(scenario: TestScenario, config: ProcessedConfig): TestResult {
    // Build evaluation context from scenario
    const context: EvaluationContext = {
      variables: scenario.variables,
      changes: scenario.changes,
    }

    // Evaluate all jobs
    const evaluation = RuleEvaluator.evaluateAllJobs(config, context)

    // Check all assertions
    const assertionResults = checkAllAssertions(scenario.assertions, evaluation)

    // Calculate summary
    const passed = assertionResults.filter(r => r.passed).length
    const failed = assertionResults.filter(r => !r.passed).length

    return {
      passed: failed === 0,
      description: scenario.description,
      assertions: assertionResults,
      summary: {
        total: assertionResults.length,
        passed,
        failed,
      },
      evaluation,
      context,
    }
  }

  /**
   * Run a test scenario with child pipeline evaluation.
   * Child pipeline assertions use the new format with explicit `childPipelines` field:
   *
   * ```yaml
   * assertions:
   *   jobs:
   *     trigger-extension: automatic
   *   childPipelines:
   *     trigger-extension:
   *       jobs:
   *         build-chrome: automatic
   *       counts:
   *         automatic: 10
   * ```
   *
   * @param scenario - The test scenario with variables, changes, and assertions
   * @param config - The processed GitLab CI configuration
   * @param baseDir - Base directory for resolving child pipeline paths
   * @param options - Linter options including child pipeline settings
   * @returns Test result with all assertion outcomes
   */
  static async runTestWithChildren(
    scenario: TestScenario,
    config: ProcessedConfig,
    baseDir: string,
    options: LinterOptions & ChildPipelineOptions = {},
  ): Promise<TestResult> {
    // Build evaluation context from scenario
    const context: EvaluationContext = {
      variables: scenario.variables,
      changes: scenario.changes,
    }

    // Evaluate with child pipelines
    const childEvaluator = new ChildPipelineEvaluator(
      baseDir,
      {
        evaluateChildren: true,
        maxDepth: options.maxDepth,
      },
      options,
    )

    const evaluationWithChildren = await childEvaluator.evaluateWithChildren(config, context)

    // Check parent pipeline assertions
    const assertionResults = checkAllAssertions(scenario.assertions, evaluationWithChildren)

    // Check child pipeline assertions if present
    if (scenario.assertions.childPipelines && evaluationWithChildren.childPipelines) {
      assertionResults.push(
        ...checkChildPipelineAssertions(
          scenario.assertions.childPipelines,
          evaluationWithChildren.childPipelines,
        ),
      )
    }

    // Calculate summary
    const passed = assertionResults.filter(r => r.passed).length
    const failed = assertionResults.filter(r => !r.passed).length

    return {
      passed: failed === 0,
      description: scenario.description,
      assertions: assertionResults,
      summary: {
        total: assertionResults.length,
        passed,
        failed,
      },
      evaluation: evaluationWithChildren,
      context,
    }
  }

  /**
   * Validate that a test scenario has the required structure.
   * @param scenario - The object to validate
   * @returns Error message if invalid, undefined if valid
   */
  static validateScenario(scenario: unknown): string | undefined {
    if (!scenario || typeof scenario !== 'object') {
      return 'Test scenario must be an object'
    }

    const s = scenario as Record<string, unknown>

    if (!s['variables'] || typeof s['variables'] !== 'object') {
      return "Test scenario must have a 'variables' object"
    }

    if (!s['assertions'] || typeof s['assertions'] !== 'object') {
      return "Test scenario must have an 'assertions' object"
    }

    const assertions = s['assertions'] as Record<string, unknown>

    // Check that at least one assertion type is present
    if (!assertions['jobs'] && !assertions['counts'] && !assertions['childPipelines']) {
      return "Test scenario must have at least one of 'assertions.jobs', 'assertions.counts', or 'assertions.childPipelines'"
    }

    // Validate job assertions if present
    if (assertions['jobs']) {
      const error = this.validateJobAssertions(assertions['jobs'], '')
      if (error) return error
    }

    // Validate count assertions if present
    if (assertions['counts']) {
      const error = this.validateCountAssertions(assertions['counts'], '')
      if (error) return error
    }

    // Validate child pipeline assertions if present
    if (assertions['childPipelines']) {
      const error = this.validateChildPipelineAssertions(assertions['childPipelines'], '')
      if (error) return error
    }

    return undefined
  }

  /**
   * Validate job assertions structure.
   */
  private static validateJobAssertions(jobs: unknown, prefix: string): string | undefined {
    if (typeof jobs !== 'object' || jobs === null) {
      return `${prefix}'assertions.jobs' must be an object`.trim()
    }

    const validStatuses = ['automatic', 'manual', 'skipped']
    for (const [jobName, status] of Object.entries(jobs as Record<string, unknown>)) {
      if (typeof status !== 'string' || !validStatuses.includes(status)) {
        return `${prefix}Invalid job status '${status}' for job '${jobName}'. Must be one of: ${validStatuses.join(', ')}`.trim()
      }
    }

    return undefined
  }

  /**
   * Validate count assertions structure.
   */
  private static validateCountAssertions(counts: unknown, prefix: string): string | undefined {
    if (typeof counts !== 'object' || counts === null) {
      return `${prefix}'assertions.counts' must be an object`.trim()
    }

    const validCountTypes = ['automatic', 'manual', 'skipped', 'total']
    for (const [countType, value] of Object.entries(counts as Record<string, unknown>)) {
      if (!validCountTypes.includes(countType)) {
        return `${prefix}Invalid count type '${countType}'. Must be one of: ${validCountTypes.join(', ')}`.trim()
      }
      if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
        return `${prefix}Count '${countType}' must be a non-negative integer, got: ${value}`.trim()
      }
    }

    return undefined
  }

  /**
   * Validate child pipeline assertions structure recursively.
   */
  private static validateChildPipelineAssertions(
    childPipelines: unknown,
    prefix: string,
  ): string | undefined {
    if (typeof childPipelines !== 'object' || childPipelines === null) {
      return `${prefix}'childPipelines' must be an object`.trim()
    }

    for (const [triggerJobName, assertions] of Object.entries(
      childPipelines as Record<string, unknown>,
    )) {
      if (typeof assertions !== 'object' || assertions === null) {
        return `${prefix}Child pipeline assertions for '${triggerJobName}' must be an object`.trim()
      }

      const childPrefix = prefix ? `${prefix}${triggerJobName} > ` : `${triggerJobName} > `
      const assertionsObj = assertions as Record<string, unknown>

      // Validate that at least one assertion type is present
      if (!assertionsObj['jobs'] && !assertionsObj['counts'] && !assertionsObj['childPipelines']) {
        return `${childPrefix.slice(0, -3)}: Child pipeline must have at least one of 'jobs', 'counts', or 'childPipelines'`
      }

      // Validate job assertions
      if (assertionsObj['jobs']) {
        const error = this.validateJobAssertions(assertionsObj['jobs'], childPrefix)
        if (error) return error
      }

      // Validate count assertions
      if (assertionsObj['counts']) {
        const error = this.validateCountAssertions(assertionsObj['counts'], childPrefix)
        if (error) return error
      }

      // Recursively validate grandchild assertions
      if (assertionsObj['childPipelines']) {
        const error = this.validateChildPipelineAssertions(
          assertionsObj['childPipelines'],
          childPrefix,
        )
        if (error) return error
      }
    }

    return undefined
  }

  /**
   * Create a summary of test results suitable for display.
   * @param result - The test result
   * @param useColor - Whether to use ANSI colors
   * @returns Array of formatted lines
   */
  static formatTestResult(result: TestResult, useColor = true): string[] {
    const lines: string[] = []
    const colors = {
      green: '\x1b[32m',
      red: '\x1b[31m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
      dim: '\x1b[2m',
      reset: '\x1b[0m',
    }

    const c = useColor ? colors : { green: '', red: '', yellow: '', cyan: '', dim: '', reset: '' }

    // Header
    if (result.description) {
      lines.push(`${c.cyan}Test: ${result.description}${c.reset}`)
    }

    // Overall result
    const statusIcon = result.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`
    const statusText = result.passed ? `${c.green}PASSED${c.reset}` : `${c.red}FAILED${c.reset}`
    lines.push(
      `${statusIcon} ${statusText} (${result.summary.passed}/${result.summary.total} assertions)`,
    )
    lines.push('')

    // Assertion details
    if (result.assertions.length > 0) {
      lines.push('Assertions:')

      for (const assertion of result.assertions) {
        const icon = assertion.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`
        const typeLabel = assertion.type === 'job' ? 'job' : 'count'

        if (assertion.passed) {
          lines.push(
            `  ${icon} ${c.dim}[${typeLabel}]${c.reset} ${assertion.name}: ${assertion.actual}`,
          )
        } else {
          lines.push(
            `  ${icon} ${c.dim}[${typeLabel}]${c.reset} ${assertion.name}: expected ${c.yellow}${assertion.expected}${c.reset}, got ${c.red}${assertion.actual}${c.reset}`,
          )
        }
      }
    }

    return lines
  }

  /**
   * Create a JSON-friendly summary of test results.
   * @param result - The test result
   * @returns Object suitable for JSON.stringify
   */
  static toJson(result: TestResult): object {
    return {
      passed: result.passed,
      description: result.description,
      summary: result.summary,
      assertions: result.assertions.map(a => ({
        type: a.type,
        name: a.name,
        passed: a.passed,
        expected: a.expected,
        actual: a.actual,
        message: a.message,
      })),
      evaluation: {
        jobs: result.evaluation.jobs.map(j => ({
          name: j.name,
          stage: j.stage,
          when: j.when,
        })),
        skipped: result.evaluation.skipped.map(j => ({
          name: j.name,
          stage: j.stage,
          reason: j.reason,
        })),
        totalJobs: result.evaluation.totalJobs,
      },
    }
  }

  /**
   * Aggregate multiple test results into a single summary.
   * @param results - Array of individual test results
   * @returns Aggregated result with overall pass/fail and combined summary
   */
  static aggregateResults(results: TestResult[]): AggregateTestResult {
    const passedScenarios = results.filter(r => r.passed).length
    const failedScenarios = results.filter(r => !r.passed).length
    const totalAssertions = results.reduce((sum, r) => sum + r.summary.total, 0)
    const passedAssertions = results.reduce((sum, r) => sum + r.summary.passed, 0)
    const failedAssertions = results.reduce((sum, r) => sum + r.summary.failed, 0)

    return {
      passed: failedScenarios === 0,
      results,
      summary: {
        totalScenarios: results.length,
        passedScenarios,
        failedScenarios,
        totalAssertions,
        passedAssertions,
        failedAssertions,
      },
    }
  }

  /**
   * Format an aggregate test result for display.
   * Shows per-scenario pass/fail status and an overall summary.
   * @param aggregate - The aggregate test result
   * @param useColor - Whether to use ANSI colors
   * @returns Array of formatted lines
   */
  static formatAggregateResult(aggregate: AggregateTestResult, useColor = true): string[] {
    const lines: string[] = []
    const colors = {
      green: '\x1b[32m',
      red: '\x1b[31m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
      dim: '\x1b[2m',
      reset: '\x1b[0m',
    }

    const c = useColor ? colors : { green: '', red: '', yellow: '', cyan: '', dim: '', reset: '' }

    // Per-scenario results
    for (const result of aggregate.results) {
      const icon = result.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`
      const desc = result.description || 'unnamed scenario'
      const detail = `${c.dim}(${result.summary.passed}/${result.summary.total} assertions)${c.reset}`
      lines.push(`${icon} ${desc} ${detail}`)

      // Show failed assertions inline
      if (!result.passed) {
        for (const assertion of result.assertions) {
          if (!assertion.passed) {
            lines.push(
              `    ${c.red}✗${c.reset} ${c.dim}[${assertion.type}]${c.reset} ${assertion.name}: expected ${c.yellow}${assertion.expected}${c.reset}, got ${c.red}${assertion.actual}${c.reset}`,
            )
          }
        }
      }
    }

    // Summary line
    lines.push('')
    const { summary } = aggregate
    const overallIcon = aggregate.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`
    const overallText = aggregate.passed
      ? `${c.green}ALL PASSED${c.reset}`
      : `${c.red}FAILED${c.reset}`
    lines.push(
      `${overallIcon} ${overallText}: ${summary.passedScenarios}/${summary.totalScenarios} scenarios, ${summary.passedAssertions}/${summary.totalAssertions} assertions`,
    )

    return lines
  }

  /**
   * Create a JSON-friendly summary of aggregate test results.
   * @param aggregate - The aggregate test result
   * @returns Object suitable for JSON.stringify
   */
  static toAggregateJson(aggregate: AggregateTestResult): object {
    return {
      passed: aggregate.passed,
      summary: aggregate.summary,
      results: aggregate.results.map(r => this.toJson(r)),
    }
  }
}
