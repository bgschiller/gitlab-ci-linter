import { describe, expect, it } from 'vitest'
import { ConditionParser } from './ConditionParser.js'
import { ScenarioGenerator } from './ScenarioGenerator.js'

describe('ScenarioGenerator', () => {
  describe('generateScenariosForConditions', () => {
    it('should generate scenarios for simple branch comparison', () => {
      const conditions = [ConditionParser.parse('$CI_COMMIT_BRANCH == "main"')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      expect(scenarios.length).toBeGreaterThan(0)

      // Should include scenarios where the condition is true and false
      const variableValues = scenarios.map(s => s.variables['CI_COMMIT_BRANCH'])
      expect(variableValues).toContain('main') // Condition true
      expect(variableValues.some(v => v !== 'main')).toBe(true) // Condition false

      // Should have descriptive names
      expect(scenarios.every(s => s.description.length > 0)).toBe(true)
      expect(scenarios.every(s => s.tags.length > 0)).toBe(true)
    })

    it('should generate scenarios for variable-to-variable comparison', () => {
      const conditions = [ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      expect(scenarios.length).toBeGreaterThan(0)

      // Should include scenarios with matching and non-matching branches
      const hasMatching = scenarios.some(
        s => s.variables['CI_COMMIT_BRANCH'] === s.variables['CI_DEFAULT_BRANCH'],
      )
      const hasNonMatching = scenarios.some(
        s => s.variables['CI_COMMIT_BRANCH'] !== s.variables['CI_DEFAULT_BRANCH'],
      )

      expect(hasMatching).toBe(true)
      expect(hasNonMatching).toBe(true)

      // Should include main branch scenarios
      const hasMainBranch = scenarios.some(
        s =>
          s.variables['CI_COMMIT_BRANCH'] === 'main' && s.variables['CI_DEFAULT_BRANCH'] === 'main',
      )
      expect(hasMainBranch).toBe(true)
    })

    it('should generate scenarios for complex logical conditions', () => {
      const conditions = [
        ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $EPH_ENV_ID == null'),
      ]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      expect(scenarios.length).toBeGreaterThan(0)

      // Should cover all combinations of the AND condition
      const allVariables = scenarios.every(
        s =>
          'CI_COMMIT_BRANCH' in s.variables &&
          'CI_DEFAULT_BRANCH' in s.variables &&
          'EPH_ENV_ID' in s.variables,
      )
      expect(allVariables).toBe(true)

      // Should include realistic GitLab scenarios
      const hasMainBranchProduction = scenarios.some(
        s =>
          s.variables['CI_COMMIT_BRANCH'] === 'main' &&
          s.variables['CI_DEFAULT_BRANCH'] === 'main' &&
          s.variables['EPH_ENV_ID'] === null,
      )
      expect(hasMainBranchProduction).toBe(true)

      // Should include scenario with non-null EPH_ENV_ID (from targeted generation for EPH_ENV_ID == null)
      const hasNonNullEph = scenarios.some(s => s.variables['EPH_ENV_ID'] !== null)
      expect(hasNonNullEph).toBe(true)
    })

    it('should generate scenarios for null comparisons', () => {
      const conditions = [ConditionParser.parse('$EPH_ENV_ID != null')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Should include scenarios where EPH_ENV_ID is null and not null
      const hasNull = scenarios.some(s => s.variables['EPH_ENV_ID'] === null)
      const hasNotNull = scenarios.some(s => s.variables['EPH_ENV_ID'] !== null)

      expect(hasNull).toBe(true)
      expect(hasNotNull).toBe(true)

      // Should include appropriate tags
      const hasNotNullTag = scenarios.some(s => s.tags.includes('not-null'))
      expect(hasNotNullTag).toBe(true)
    })
  })

  describe('generateConflictScenarios', () => {
    it('should generate scenarios covering both dependent and dependency conditions', () => {
      const dependentConditions = [ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH')]
      const dependencyConditions = [
        ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $EPH_ENV_ID == null'),
      ]

      const scenarios = ScenarioGenerator.generateConflictScenarios(
        dependentConditions,
        dependencyConditions,
      )

      expect(scenarios.length).toBeGreaterThan(0)

      // Should include all variables from both conditions
      const allVariables = scenarios.every(
        s =>
          'CI_COMMIT_BRANCH' in s.variables &&
          'CI_DEFAULT_BRANCH' in s.variables &&
          'EPH_ENV_ID' in s.variables,
      )
      expect(allVariables).toBe(true)

      // Should include the conflict scenario (dependent runs, dependency doesn't)
      const hasConflictScenario = scenarios.some(
        s =>
          s.variables['CI_COMMIT_BRANCH'] === s.variables['CI_DEFAULT_BRANCH'] &&
          s.variables['EPH_ENV_ID'] !== null,
      )
      expect(hasConflictScenario).toBe(true)
    })
  })

  describe('pattern recognition and defaults', () => {
    it('should recognize branch variable patterns', () => {
      const conditions = [ConditionParser.parse('$CUSTOM_BRANCH == "main"')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Should provide sensible defaults for branch-like variables
      const hasMainDefault = scenarios.some(s => s.variables['CUSTOM_BRANCH'] === 'main')
      expect(hasMainDefault).toBe(true)
    })

    it('should recognize ID variable patterns', () => {
      const conditions = [ConditionParser.parse('$CUSTOM_ID != null')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Should include null scenarios for ID variables
      const hasNullId = scenarios.some(s => s.variables['CUSTOM_ID'] === null)
      expect(hasNullId).toBe(true)
    })

    it('should recognize flag variable patterns', () => {
      const conditions = [ConditionParser.parse('$SKIP_TESTS == "true"')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Should include boolean-like values for flag variables
      const hasBooleanValues = scenarios.some(
        s => s.variables['SKIP_TESTS'] === 'true' || s.variables['SKIP_TESTS'] === 'false',
      )
      expect(hasBooleanValues).toBe(true)
    })

    it('should recognize environment variable patterns', () => {
      const conditions = [ConditionParser.parse('$DEPLOY_ENV == "production"')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Should include environment-like values
      const hasEnvValues = scenarios.some(s =>
        ['production', 'staging', 'development'].includes(s.variables['DEPLOY_ENV'] as string),
      )
      expect(hasEnvValues).toBe(true)
    })
  })

  describe('scenario minimization', () => {
    it('should limit scenario count to reasonable number', () => {
      const conditions = [
        ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'),
        ConditionParser.parse('$EPH_ENV_ID != null'),
        ConditionParser.parse('$CI_PIPELINE_SOURCE == "push"'),
        ConditionParser.parse('$DEPLOY_ENV == "production"'),
      ]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Should be a reasonable number (not exponential explosion)
      expect(scenarios.length).toBeLessThanOrEqual(30)
      expect(scenarios.length).toBeGreaterThanOrEqual(5)
    })

    it('should prioritize realistic GitLab CI scenarios', () => {
      const conditions = [
        ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $EPH_ENV_ID == null'),
      ]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // First few scenarios should include common patterns
      const firstFive = scenarios.slice(0, 5)
      const hasMainBranch = firstFive.some(s => s.tags.includes('main-branch'))
      const hasPush = firstFive.some(s => s.tags.includes('push'))

      expect(hasMainBranch || hasPush).toBe(true)
    })

    it('should include essential edge cases', () => {
      const conditions = [
        ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $EPH_ENV_ID == null'),
      ]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Should include edge cases
      const hasEdgeCase = scenarios.some(s => s.tags.includes('edge-case'))
      expect(hasEdgeCase).toBe(true)

      // Should include all-null scenario
      const hasAllNull = scenarios.some(s => s.tags.includes('all-null'))
      expect(hasAllNull).toBe(true)

      // Should include branch mismatch scenario
      const hasBranchMismatch = scenarios.some(s => s.tags.includes('branch-mismatch'))
      expect(hasBranchMismatch).toBe(true)
    })
  })

  describe('scenario quality', () => {
    it('should generate scenarios with meaningful descriptions', () => {
      const conditions = [ConditionParser.parse('$CI_COMMIT_BRANCH == "main"')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // All scenarios should have descriptions
      expect(scenarios.every(s => s.description && s.description.length > 0)).toBe(true)

      // Descriptions should be meaningful
      const hasSpecificDescriptions = scenarios.some(
        s => s.description.includes('main') || s.description.includes('branch'),
      )
      expect(hasSpecificDescriptions).toBe(true)
    })

    it('should generate scenarios with appropriate tags', () => {
      const conditions = [
        ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $EPH_ENV_ID == null'),
      ]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Should have relevant tags
      const tags = scenarios.flatMap(s => s.tags)
      expect(tags).toContain('main-branch')
      expect(tags.some(tag => tag.includes('branch'))).toBe(true)
    })

    it('should avoid duplicate scenarios', () => {
      const conditions = [ConditionParser.parse('$CI_COMMIT_BRANCH == "main"')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Create a set of scenario keys to check for duplicates
      const scenarioKeys = new Set()
      let hasDuplicates = false

      for (const scenario of scenarios) {
        const key = Object.entries(scenario.variables)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join('|')

        if (scenarioKeys.has(key)) {
          hasDuplicates = true
          break
        }
        scenarioKeys.add(key)
      }

      expect(hasDuplicates).toBe(false)
    })
  })

  describe('real-world GitLab CI patterns', () => {
    it('should handle typical dependency rule scenario', () => {
      // Simulate the original issue: release depends on docker-backend
      const releaseConditions = [ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH')]
      const dockerBackendConditions = [
        ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $EPH_ENV_ID == null'),
      ]

      const scenarios = ScenarioGenerator.generateConflictScenarios(
        releaseConditions,
        dockerBackendConditions,
      )

      // Should identify the conflict scenario
      const conflictScenario = scenarios.find(
        s =>
          s.variables['CI_COMMIT_BRANCH'] === s.variables['CI_DEFAULT_BRANCH'] && // release runs
          s.variables['EPH_ENV_ID'] !== null, // docker-backend doesn't run
      )

      expect(conflictScenario).toBeDefined()
      expect(conflictScenario?.variables['CI_COMMIT_BRANCH']).toBe('main')
      expect(conflictScenario?.variables['CI_DEFAULT_BRANCH']).toBe('main')
      expect(conflictScenario?.variables['EPH_ENV_ID']).not.toBe(null)
    })

    it('should handle merge request scenarios', () => {
      const conditions = [
        ConditionParser.parse(
          '$CI_PIPELINE_SOURCE == "merge_request_event" || $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
        ),
      ]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Should include merge request scenarios
      const hasMRScenario = scenarios.some(
        s => s.variables['CI_PIPELINE_SOURCE'] === 'merge_request_event',
      )
      expect(hasMRScenario).toBe(true)

      // Should include main branch scenarios
      const hasMainBranchScenario = scenarios.some(
        s => s.variables['CI_COMMIT_BRANCH'] === s.variables['CI_DEFAULT_BRANCH'],
      )
      expect(hasMainBranchScenario).toBe(true)
    })

    it('should enforce CI_COMMIT_BRANCH is null for MR pipeline scenarios', () => {
      const conditions = [
        ConditionParser.parse(
          '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
        ),
      ]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // All scenarios with merge_request_event source must have CI_COMMIT_BRANCH null
      const mrScenarios = scenarios.filter(
        s => s.variables['CI_PIPELINE_SOURCE'] === 'merge_request_event',
      )
      expect(mrScenarios.length).toBeGreaterThan(0)
      for (const scenario of mrScenarios) {
        expect(scenario.variables['CI_COMMIT_BRANCH']).toBeNull()
      }
    })

    it('should enforce CI_COMMIT_BRANCH is null for tag pipeline scenarios', () => {
      // Test enforceGitLabConstraints directly for tag pipeline behavior
      const tagVariables: Record<string, string | null> = {
        CI_COMMIT_TAG: 'v1.0.0',
        CI_COMMIT_BRANCH: 'main',
        CI_DEFAULT_BRANCH: 'main',
        CI_PIPELINE_SOURCE: 'push',
      }

      ScenarioGenerator.enforceGitLabConstraints(tagVariables)

      // Tag pipelines must have CI_COMMIT_BRANCH nulled out
      expect(tagVariables['CI_COMMIT_BRANCH']).toBeNull()
      // CI_COMMIT_TAG should remain untouched
      expect(tagVariables['CI_COMMIT_TAG']).toBe('v1.0.0')
    })

    it('should not null CI_COMMIT_BRANCH when CI_COMMIT_TAG is null', () => {
      const branchVariables: Record<string, string | null> = {
        CI_COMMIT_TAG: null,
        CI_COMMIT_BRANCH: 'main',
        CI_DEFAULT_BRANCH: 'main',
        CI_PIPELINE_SOURCE: 'push',
      }

      ScenarioGenerator.enforceGitLabConstraints(branchVariables)

      // Non-tag pipelines should keep CI_COMMIT_BRANCH
      expect(branchVariables['CI_COMMIT_BRANCH']).toBe('main')
    })

    it('should not generate fabricated pipeline sources', () => {
      const conditions = [ConditionParser.parse('$CI_PIPELINE_SOURCE == "merge_request_event"')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // No scenario should have a fabricated pipeline source (e.g., alt-merge_request_event)
      const realSources = [
        'push',
        'web',
        'schedule',
        'api',
        'merge_request_event',
        'trigger',
        'external',
        null,
      ]
      for (const scenario of scenarios) {
        if ('CI_PIPELINE_SOURCE' in scenario.variables) {
          expect(
            realSources,
            `Unexpected pipeline source: ${scenario.variables['CI_PIPELINE_SOURCE']} in scenario "${scenario.description}"`,
          ).toContain(scenario.variables['CI_PIPELINE_SOURCE'])
        }
      }

      // Should include a non-MR source as an alternative
      const hasNonMRSource = scenarios.some(
        s =>
          s.variables['CI_PIPELINE_SOURCE'] !== 'merge_request_event' &&
          s.variables['CI_PIPELINE_SOURCE'] !== null,
      )
      expect(hasNonMRSource).toBe(true)
    })

    it('should handle schedule exclusion scenarios', () => {
      const conditions = [ConditionParser.parse('$CI_PIPELINE_SOURCE != "schedule"')]

      const scenarios = ScenarioGenerator.generateScenariosForConditions(conditions)

      // Should include schedule scenarios (where condition is false)
      const hasScheduleScenario = scenarios.some(
        s => s.variables['CI_PIPELINE_SOURCE'] === 'schedule',
      )
      expect(hasScheduleScenario).toBe(true)

      // Should include non-schedule scenarios (where condition is true)
      const hasNonScheduleScenario = scenarios.some(
        s => s.variables['CI_PIPELINE_SOURCE'] !== 'schedule' && s.variables['CI_PIPELINE_SOURCE'],
      )
      expect(hasNonScheduleScenario).toBe(true)
    })
  })
})
