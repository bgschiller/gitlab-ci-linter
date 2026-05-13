import {
  GITLAB_VARIABLES,
  type GitLabVariable,
  type ParsedCondition,
  PIPELINE_CONTEXT_TEMPLATES,
  VARIABLE_PATTERNS,
  type VariableScenario,
} from './types.js'

/**
 * Generates comprehensive variable scenarios for testing GitLab CI conditions
 */
export class ScenarioGenerator {
  /**
   * Generate variable scenarios that cover all possible outcomes for given conditions
   */
  static generateScenariosForConditions(conditions: ParsedCondition[]): VariableScenario[] {
    // Extract all variables used across conditions
    const allVariables = this.extractAllVariables(conditions)

    // Generate base scenarios from common GitLab CI patterns
    const baseScenarios = this.generateBaseScenarios(allVariables)

    // Generate targeted scenarios for specific condition patterns
    const targetedScenarios = this.generateTargetedScenarios(conditions, allVariables)

    // Combine and deduplicate scenarios
    const combinedScenarios = this.combineScenarios([...baseScenarios, ...targetedScenarios])

    // Minimize scenario set while maintaining coverage
    return this.minimizeScenarios(combinedScenarios, conditions)
  }

  /**
   * Generate scenarios for comparing two jobs' conditions
   */
  static generateConflictScenarios(
    dependentConditions: ParsedCondition[],
    dependencyConditions: ParsedCondition[],
  ): VariableScenario[] {
    // Generate scenarios for all variables involved
    const allConditions = [...dependentConditions, ...dependencyConditions]
    const allScenarios = this.generateScenariosForConditions(allConditions)

    // Filter to only scenarios that represent actual conflicts:
    // - At least one dependent condition is true (dependent job runs)
    // - All dependency conditions are false (dependency job doesn't run)
    const conflictScenarios = allScenarios.filter(scenario => {
      const dependentRuns = dependentConditions.some(condition =>
        this.evaluateConditionSimple(condition, scenario.variables),
      )
      const dependencyRuns = dependencyConditions.some(condition =>
        this.evaluateConditionSimple(condition, scenario.variables),
      )

      // Conflict occurs when dependent runs but dependency doesn't
      return dependentRuns && !dependencyRuns
    })

    return conflictScenarios
  }

  private static extractAllVariables(conditions: ParsedCondition[]): Set<string> {
    const variables = new Set<string>()

    for (const condition of conditions) {
      for (const variable of condition.variables) {
        variables.add(variable)
      }
    }

    return variables
  }

  private static generateBaseScenarios(variables: Set<string>): VariableScenario[] {
    // Generate base scenarios from pipeline context templates.
    // These templates mirror GitLab's actual variable behavior per pipeline source,
    // ensuring correct null/set patterns (e.g., CI_COMMIT_BRANCH is null for MR pipelines).
    const scenarios = PIPELINE_CONTEXT_TEMPLATES.map(template => ({
      variables: this.createVariableSet(template.variables, variables),
      description: template.description,
      tags: [...template.tags],
    }))

    // Filter scenarios to only include those with at least one relevant variable
    return scenarios.filter(scenario =>
      Object.keys(scenario.variables).some(key => variables.has(key)),
    )
  }

  private static generateTargetedScenarios(
    conditions: ParsedCondition[],
    variables: Set<string>,
  ): VariableScenario[] {
    const scenarios: VariableScenario[] = []

    for (const condition of conditions) {
      scenarios.push(...this.generateScenariosForCondition(condition, variables))
    }

    return scenarios
  }

  private static generateScenariosForCondition(
    condition: ParsedCondition,
    allVariables: Set<string>,
  ): VariableScenario[] {
    const scenarios: VariableScenario[] = []

    switch (condition.type) {
      case 'comparison': {
        scenarios.push(...this.generateComparisonScenarios(condition, allVariables))
        break
      }

      case 'logical': {
        if (condition.left) {
          scenarios.push(...this.generateScenariosForCondition(condition.left, allVariables))
        }
        if (condition.right) {
          scenarios.push(...this.generateScenariosForCondition(condition.right, allVariables))
        }
        break
      }
    }

    return scenarios
  }

  private static generateComparisonScenarios(
    condition: ParsedCondition,
    allVariables: Set<string>,
  ): VariableScenario[] {
    if (!condition.left || !condition.right || !condition.operator) {
      return []
    }

    const scenarios: VariableScenario[] = []

    // Handle variable comparisons
    if (condition.left.type === 'variable' && condition.right.type === 'literal') {
      const variable = condition.left.variable!
      const expectedValue = condition.right.value

      scenarios.push(
        {
          variables: this.createVariableSet({ [variable]: expectedValue ?? null }, allVariables),
          description: `${variable} equals expected value (${this.formatValue(expectedValue ?? null)})`,
          tags: ['condition-match', variable.toLowerCase()],
        },
        {
          variables: this.createVariableSet(
            { [variable]: this.generateAlternativeValue(expectedValue ?? null) },
            allVariables,
          ),
          description: `${variable} differs from expected value`,
          tags: ['condition-mismatch', variable.toLowerCase()],
        },
      )

      // Add null scenario for != null comparisons
      if (condition.operator === '!=' && expectedValue === null) {
        scenarios.push({
          variables: this.createVariableSet({ [variable]: 'non-null-value' }, allVariables),
          description: `${variable} is not null`,
          tags: ['not-null', variable.toLowerCase()],
        })
      }
    }

    // Handle variable-to-variable comparisons
    if (condition.left.type === 'variable' && condition.right.type === 'variable') {
      const leftVar = condition.left.variable!
      const rightVar = condition.right.variable!

      scenarios.push(
        {
          variables: this.createVariableSet(
            {
              [leftVar]: 'same-value',
              [rightVar]: 'same-value',
            },
            allVariables,
          ),
          description: `${leftVar} equals ${rightVar}`,
          tags: ['variable-match', leftVar.toLowerCase(), rightVar.toLowerCase()],
        },
        {
          variables: this.createVariableSet(
            {
              [leftVar]: 'different-value-1',
              [rightVar]: 'different-value-2',
            },
            allVariables,
          ),
          description: `${leftVar} differs from ${rightVar}`,
          tags: ['variable-mismatch', leftVar.toLowerCase(), rightVar.toLowerCase()],
        },
      )

      // Special handling for common patterns
      if (leftVar === 'CI_COMMIT_BRANCH' && rightVar === 'CI_DEFAULT_BRANCH') {
        scenarios.push(
          {
            variables: this.createVariableSet(
              {
                CI_COMMIT_BRANCH: 'main',
                CI_DEFAULT_BRANCH: 'main',
              },
              allVariables,
            ),
            description: 'On main branch (CI_COMMIT_BRANCH == CI_DEFAULT_BRANCH)',
            tags: ['main-branch', 'branch-match'],
          },
          {
            variables: this.createVariableSet(
              {
                CI_COMMIT_BRANCH: 'feature/test',
                CI_DEFAULT_BRANCH: 'main',
              },
              allVariables,
            ),
            description: 'On feature branch (CI_COMMIT_BRANCH != CI_DEFAULT_BRANCH)',
            tags: ['feature-branch', 'branch-mismatch'],
          },
        )
      }
    }

    return scenarios
  }

  private static generateAlternativeValue(originalValue: string | null): string | null {
    if (originalValue === null) return 'non-null-value'
    if (originalValue === 'main') return 'develop'
    if (originalValue === 'push') return 'web'
    if (originalValue === 'merge_request_event') return 'push'
    if (originalValue === 'web') return 'push'
    if (originalValue === 'schedule') return 'push'
    if (originalValue === 'api') return 'push'
    if (originalValue === 'trigger') return 'push'
    if (originalValue === 'external') return 'push'
    if (originalValue === 'true') return 'false'
    if (originalValue === 'false') return 'true'
    if (originalValue === 'production') return 'staging'
    if (originalValue === 'staging') return 'development'
    if (originalValue === 'detached') return 'merged_result'
    if (originalValue === 'merged_result') return 'detached'

    return `alt-${originalValue}`
  }

  private static createVariableSet(
    baseVariables: Record<string, string | null>,
    requiredVariables: Set<string>,
  ): Record<string, string | null> {
    const result: Record<string, string | null> = {}

    // Add all required variables
    for (const variable of requiredVariables) {
      if (variable in baseVariables) {
        result[variable] = baseVariables[variable] ?? null
      } else {
        // Provide sensible defaults for common GitLab variables
        result[variable] = this.getDefaultValue(variable as GitLabVariable)
      }
    }

    // Enforce GitLab's cross-variable constraints to avoid unrealistic combinations
    this.enforceGitLabConstraints(result)

    return result
  }

  /**
   * Enforce GitLab's actual variable behavior to prevent unrealistic combinations.
   *
   * GitLab sets different variables depending on pipeline source. Key constraints:
   * - MR pipelines: CI_COMMIT_BRANCH is NOT set (null)
   * - Tag pipelines: CI_COMMIT_BRANCH is NOT set (null), CI_COMMIT_TAG is set
   * - Non-MR pipelines: CI_MERGE_REQUEST_* variables are NOT set (null)
   *
   * See: https://docs.gitlab.com/ci/variables/predefined_variables/
   */
  static enforceGitLabConstraints(variables: Record<string, string | null>): void {
    const source = variables['CI_PIPELINE_SOURCE']

    if (source === 'merge_request_event') {
      // GitLab does NOT set CI_COMMIT_BRANCH for MR pipelines
      if ('CI_COMMIT_BRANCH' in variables) {
        variables['CI_COMMIT_BRANCH'] = null
      }
    } else if (source !== undefined && source !== 'merge_request_event') {
      // Non-MR pipelines don't have MR variables
      if ('CI_MERGE_REQUEST_ID' in variables) variables['CI_MERGE_REQUEST_ID'] = null
      if ('CI_MERGE_REQUEST_IID' in variables) variables['CI_MERGE_REQUEST_IID'] = null
      if ('CI_MERGE_REQUEST_TARGET_BRANCH_NAME' in variables)
        variables['CI_MERGE_REQUEST_TARGET_BRANCH_NAME'] = null
      if ('CI_MERGE_REQUEST_SOURCE_BRANCH_NAME' in variables)
        variables['CI_MERGE_REQUEST_SOURCE_BRANCH_NAME'] = null
      if ('CI_MERGE_REQUEST_EVENT_TYPE' in variables)
        variables['CI_MERGE_REQUEST_EVENT_TYPE'] = null
    }

    // Tag pipelines don't have CI_COMMIT_BRANCH
    if (variables['CI_COMMIT_TAG'] && variables['CI_COMMIT_TAG'] !== null) {
      if ('CI_COMMIT_BRANCH' in variables) {
        variables['CI_COMMIT_BRANCH'] = null
      }
    }
  }

  private static getDefaultValue(variable: GitLabVariable | string): string | null {
    // Check if it's a known GitLab variable
    if (variable in GITLAB_VARIABLES) {
      const defaults = GITLAB_VARIABLES[variable as GitLabVariable]
      if (defaults && defaults.length > 0) {
        return defaults[0] // First value is typically the most common
      }
    }

    // Use pattern recognition for unknown variables
    return this.getDefaultValueByPattern(variable)
  }

  private static getDefaultValueByPattern(variable: string): string | null {
    // Branch patterns
    for (const pattern of VARIABLE_PATTERNS.BRANCH_PATTERNS) {
      if (pattern.test(variable)) {
        return 'main'
      }
    }

    // Environment patterns
    for (const pattern of VARIABLE_PATTERNS.ENV_PATTERNS) {
      if (pattern.test(variable)) {
        return 'development'
      }
    }

    // ID patterns
    for (const pattern of VARIABLE_PATTERNS.ID_PATTERNS) {
      if (pattern.test(variable)) {
        return null // IDs are typically null by default
      }
    }

    // Boolean flag patterns
    for (const pattern of VARIABLE_PATTERNS.FLAG_PATTERNS) {
      if (pattern.test(variable)) {
        return 'false'
      }
    }

    // Version patterns
    for (const pattern of VARIABLE_PATTERNS.VERSION_PATTERNS) {
      if (pattern.test(variable)) {
        return '1.0.0'
      }
    }

    // URL patterns
    for (const pattern of VARIABLE_PATTERNS.URL_PATTERNS) {
      if (pattern.test(variable)) {
        return 'https://example.com'
      }
    }

    // Default fallback
    return null
  }

  private static combineScenarios(scenarios: VariableScenario[]): VariableScenario[] {
    const uniqueScenarios = new Map<string, VariableScenario>()

    for (const scenario of scenarios) {
      const key = this.generateScenarioKey(scenario.variables)

      if (!uniqueScenarios.has(key)) {
        uniqueScenarios.set(key, scenario)
      } else {
        // Merge tags and descriptions for duplicate scenarios
        const existing = uniqueScenarios.get(key)!
        existing.tags = [...new Set([...existing.tags, ...scenario.tags])]

        // Keep the more descriptive description
        if (scenario.description.length > existing.description.length) {
          existing.description = scenario.description
        }
      }
    }

    return Array.from(uniqueScenarios.values())
  }

  private static generateScenarioKey(variables: Record<string, string | null>): string {
    const sortedEntries = Object.entries(variables)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value ?? 'null'}`)

    return sortedEntries.join('|')
  }

  private static minimizeScenarios(
    scenarios: VariableScenario[],
    conditions: ParsedCondition[],
  ): VariableScenario[] {
    if (conditions.length === 0) {
      return scenarios.slice(0, 10) // Return a reasonable subset if no conditions
    }

    // Step 1: Group scenarios by their effect on condition outcomes
    const scenarioGroups = this.groupScenariosByOutcomes(scenarios, conditions)

    // Step 2: Select representative scenarios from each group
    const representativeScenarios: VariableScenario[] = []

    for (const [_outcomeKey, groupScenarios] of scenarioGroups) {
      // Separate targeted (condition-derived) scenarios from base (template) scenarios.
      // Targeted scenarios test specific variable states and must be preserved.
      const targeted = groupScenarios.filter(
        s =>
          s.tags.includes('condition-match') ||
          s.tags.includes('condition-mismatch') ||
          s.tags.includes('not-null') ||
          s.tags.includes('variable-match') ||
          s.tags.includes('variable-mismatch'),
      )
      const base = groupScenarios.filter(s => !targeted.includes(s))

      // Always include the best base scenario
      const prioritizedBase = this.prioritizeScenarios(base)
      if (prioritizedBase.length > 0) {
        representativeScenarios.push(prioritizedBase[0]!)
      }

      // Always include targeted scenarios (they test specific condition states)
      representativeScenarios.push(...targeted)

      // Add a few more base scenarios if they're significantly different
      if (prioritizedBase.length > 1) {
        const additional = prioritizedBase.slice(1, Math.min(2, prioritizedBase.length))
        representativeScenarios.push(...additional)
      }
    }

    // Step 3: Ensure we have essential edge cases
    const edgeCases = this.generateEssentialEdgeCases(scenarios, conditions)
    representativeScenarios.push(...edgeCases)

    // Step 4: Remove duplicates and limit total count
    const uniqueScenarios = this.combineScenarios(representativeScenarios)

    // Limit to reasonable number for performance (prioritize by tags)
    return this.limitScenarioCount(uniqueScenarios, 25)
  }

  private static groupScenariosByOutcomes(
    scenarios: VariableScenario[],
    conditions: ParsedCondition[],
  ): Map<string, VariableScenario[]> {
    const groups = new Map<string, VariableScenario[]>()

    for (const scenario of scenarios) {
      const outcomes: boolean[] = []

      // Evaluate each condition against this scenario using simplified evaluation
      // This avoids circular dependencies by not using ConditionEvaluator
      for (const condition of conditions) {
        try {
          const result = this.evaluateConditionSimple(condition, scenario.variables)
          outcomes.push(result)
        } catch {
          outcomes.push(false) // Default to false on evaluation error
        }
      }

      const outcomeKey = outcomes.map(r => (r ? 'T' : 'F')).join('')

      if (!groups.has(outcomeKey)) {
        groups.set(outcomeKey, [])
      }

      groups.get(outcomeKey)!.push(scenario)
    }

    return groups
  }

  /**
   * Simplified condition evaluation to avoid circular dependencies
   * This is a lightweight version of ConditionEvaluator for scenario grouping
   */
  private static evaluateConditionSimple(
    condition: ParsedCondition,
    variables: Record<string, string | null>,
  ): boolean {
    switch (condition.type) {
      case 'comparison': {
        if (!condition.left || !condition.right || !condition.operator) return false

        const leftValue = this.resolveValueSimple(condition.left, variables)
        const rightValue = this.resolveValueSimple(condition.right, variables)

        switch (condition.operator) {
          case '==':
            return leftValue === rightValue
          case '!=':
            return leftValue !== rightValue
          default:
            return false // Simplified - only handle basic operators
        }
      }

      case 'logical': {
        const operator = condition.operator

        if (operator === '!') {
          return condition.right ? !this.evaluateConditionSimple(condition.right, variables) : false
        } else if (operator === '&&') {
          return condition.left && condition.right
            ? this.evaluateConditionSimple(condition.left, variables) &&
                this.evaluateConditionSimple(condition.right, variables)
            : false
        } else if (operator === '||') {
          return condition.left && condition.right
            ? this.evaluateConditionSimple(condition.left, variables) ||
                this.evaluateConditionSimple(condition.right, variables)
            : false
        }
        return false
      }

      default:
        return false
    }
  }

  private static resolveValueSimple(
    condition: ParsedCondition,
    variables: Record<string, string | null>,
  ): string | null {
    if (condition.type === 'variable' && condition.variable) {
      return variables[condition.variable] ?? null
    } else if (condition.type === 'literal') {
      return condition.value ?? null
    }
    return null
  }

  private static prioritizeScenarios(scenarios: VariableScenario[]): VariableScenario[] {
    return scenarios.sort((a, b) => {
      // Priority factors:

      // 1. Scenarios with common GitLab patterns get higher priority
      const aCommonScore = this.calculateCommonPatternScore(a)
      const bCommonScore = this.calculateCommonPatternScore(b)

      if (aCommonScore !== bCommonScore) {
        return bCommonScore - aCommonScore
      }

      // 2. Scenarios that test important edge cases (null values, branch mismatches)
      const aEdgeScore = this.calculateEdgeCaseScore(a)
      const bEdgeScore = this.calculateEdgeCaseScore(b)

      if (aEdgeScore !== bEdgeScore) {
        return bEdgeScore - aEdgeScore
      }

      // 3. Prefer scenarios with more descriptive names
      return b.description.length - a.description.length
    })
  }

  private static calculateCommonPatternScore(scenario: VariableScenario): number {
    let score = 0

    // Higher scores for common GitLab CI patterns
    if (scenario.tags.includes('main-branch')) score += 10
    if (scenario.tags.includes('push')) score += 8
    if (scenario.tags.includes('merge-request')) score += 6
    if (scenario.tags.includes('production')) score += 5
    if (scenario.tags.includes('staging')) score += 3

    // Bonus for realistic variable combinations
    const vars = scenario.variables
    if (vars['CI_COMMIT_BRANCH'] === vars['CI_DEFAULT_BRANCH']) score += 5
    if (vars['CI_PIPELINE_SOURCE'] === 'push' && vars['CI_COMMIT_BRANCH']) score += 3
    if (vars['EPH_ENV_ID'] && vars['CI_COMMIT_BRANCH']?.startsWith('feature/')) score += 4

    return score
  }

  private static calculateEdgeCaseScore(scenario: VariableScenario): number {
    let score = 0

    // Edge cases that often reveal bugs
    if (scenario.tags.includes('condition-mismatch')) score += 8
    if (scenario.tags.includes('branch-mismatch')) score += 6
    if (scenario.tags.includes('not-null')) score += 4
    if (scenario.tags.includes('variable-mismatch')) score += 5

    // Null values often cause issues
    const nullCount = Object.values(scenario.variables).filter(v => v === null).length
    score += nullCount * 2

    return score
  }

  private static generateEssentialEdgeCases(
    _scenarios: VariableScenario[],
    conditions: ParsedCondition[],
  ): VariableScenario[] {
    const edgeCases: VariableScenario[] = []
    const allVariables = this.extractAllVariables(conditions)

    // Essential edge case 1: All variables null
    edgeCases.push({
      variables: this.createVariableSet({}, allVariables),
      description: 'All variables null (default state)',
      tags: ['edge-case', 'all-null'],
    })

    // Essential edge case 2: Branch mismatch scenario
    if (allVariables.has('CI_COMMIT_BRANCH') && allVariables.has('CI_DEFAULT_BRANCH')) {
      edgeCases.push({
        variables: this.createVariableSet(
          {
            CI_COMMIT_BRANCH: 'feature/different',
            CI_DEFAULT_BRANCH: 'main',
          },
          allVariables,
        ),
        description: 'Branch mismatch edge case',
        tags: ['edge-case', 'branch-mismatch'],
      })
    }

    // Essential edge case 3: Mixed null/non-null for ID variables
    const idVariables = Array.from(allVariables).filter(v =>
      VARIABLE_PATTERNS.ID_PATTERNS.some(pattern => pattern.test(v)),
    )

    if (idVariables.length > 0) {
      const mixedVars: Record<string, string | null> = {}
      idVariables.forEach((idVar, index) => {
        mixedVars[idVar] = index % 2 === 0 ? null : `${idVar.toLowerCase()}-123`
      })

      edgeCases.push({
        variables: this.createVariableSet(mixedVars, allVariables),
        description: 'Mixed null/non-null ID variables',
        tags: ['edge-case', 'mixed-ids'],
      })
    }

    return edgeCases
  }

  private static limitScenarioCount(
    scenarios: VariableScenario[],
    maxCount: number,
  ): VariableScenario[] {
    if (scenarios.length <= maxCount) {
      return scenarios
    }

    // Prioritize scenarios to keep
    const prioritized = scenarios.sort((a, b) => {
      const aScore = this.calculateCommonPatternScore(a) + this.calculateEdgeCaseScore(a)
      const bScore = this.calculateCommonPatternScore(b) + this.calculateEdgeCaseScore(b)

      return bScore - aScore
    })

    return prioritized.slice(0, maxCount)
  }

  private static formatValue(value: string | null): string {
    return value === null ? 'null' : `"${value}"`
  }
}
