import { describe, expect, it } from 'vitest'
import { ConditionParser } from './ConditionParser.js'
import { ConditionEvaluator } from './ConditionEvaluator.js'
import { ScenarioGenerator } from './ScenarioGenerator.js'

describe('ConflictDetection', () => {
  describe('EPH_ENV_ID dependency conflict', () => {
    it('should correctly identify when dependent runs but dependency does not', () => {
      // backend-build: only runs when CI_COMMIT_BRANCH == "main" AND EPH_ENV_ID == null
      const dependencyCondition = ConditionParser.parse(
        '$CI_COMMIT_BRANCH == "main" && $EPH_ENV_ID == null',
      )

      // release: runs when CI_COMMIT_BRANCH == "main" (regardless of EPH_ENV_ID)
      const dependentCondition = ConditionParser.parse('$CI_COMMIT_BRANCH == "main"')

      const scenarios = ScenarioGenerator.generateConflictScenarios(
        [dependentCondition],
        [dependencyCondition],
      )

      // Test each scenario to identify actual conflicts
      const actualConflicts = scenarios.filter(scenario => {
        const dependentRuns = ConditionEvaluator.evaluate(
          dependentCondition,
          scenario.variables,
        ).result
        const dependencyRuns = ConditionEvaluator.evaluate(
          dependencyCondition,
          scenario.variables,
        ).result

        // Conflict occurs when dependent runs but dependency doesn't
        return dependentRuns && !dependencyRuns
      })

      // Should find exactly one conflict scenario: CI_COMMIT_BRANCH="main" AND EPH_ENV_ID != null
      expect(actualConflicts.length).toBeGreaterThan(0)

      const conflict = actualConflicts[0]!
      expect(conflict.variables['CI_COMMIT_BRANCH']).toBe('main')
      expect(conflict.variables['EPH_ENV_ID']).not.toBe(null)
    })

    it('should correctly identify non-conflict scenarios', () => {
      const dependencyCondition = ConditionParser.parse(
        '$CI_COMMIT_BRANCH == "main" && $EPH_ENV_ID == null',
      )
      const dependentCondition = ConditionParser.parse('$CI_COMMIT_BRANCH == "main"')

      // Test specific scenarios that should NOT be conflicts
      const nonConflictScenarios = [
        // Both run: main branch + no ephemeral env
        { CI_COMMIT_BRANCH: 'main', EPH_ENV_ID: null },
        // Both don't run: feature branch
        { CI_COMMIT_BRANCH: 'feature/test', EPH_ENV_ID: 'env-123' },
        // Both don't run: develop branch
        { CI_COMMIT_BRANCH: 'develop', EPH_ENV_ID: null },
      ]

      for (const scenario of nonConflictScenarios) {
        const dependentRuns = ConditionEvaluator.evaluate(dependentCondition, scenario).result
        const dependencyRuns = ConditionEvaluator.evaluate(dependencyCondition, scenario).result

        // These should NOT be conflicts (both run or both don't run)
        const isConflict = dependentRuns && !dependencyRuns
        expect(isConflict).toBe(false)
      }
    })

    it('should identify the actual conflict scenario', () => {
      const dependencyCondition = ConditionParser.parse(
        '$CI_COMMIT_BRANCH == "main" && $EPH_ENV_ID == null',
      )
      const dependentCondition = ConditionParser.parse('$CI_COMMIT_BRANCH == "main"')

      // The actual conflict: main branch + ephemeral environment exists
      const conflictScenario = { CI_COMMIT_BRANCH: 'main', EPH_ENV_ID: 'ephemeral-123' }

      const dependentRuns = ConditionEvaluator.evaluate(dependentCondition, conflictScenario).result
      const dependencyRuns = ConditionEvaluator.evaluate(
        dependencyCondition,
        conflictScenario,
      ).result

      // Dependent (release) should run: CI_COMMIT_BRANCH == "main" = true
      expect(dependentRuns).toBe(true)

      // Dependency (backend-build) should NOT run: "main" && "ephemeral-123" != null = true && false = false
      expect(dependencyRuns).toBe(false)

      // This is a conflict!
      expect(dependentRuns && !dependencyRuns).toBe(true)
    })
  })

  describe('ScenarioGenerator conflict filtering', () => {
    it('should only return scenarios that represent actual conflicts', () => {
      const dependencyConditions = [
        ConditionParser.parse('$CI_COMMIT_BRANCH == "main" && $EPH_ENV_ID == null'),
      ]
      const dependentConditions = [ConditionParser.parse('$CI_COMMIT_BRANCH == "main"')]

      const conflictScenarios = ScenarioGenerator.generateConflictScenarios(
        dependentConditions,
        dependencyConditions,
      )

      // Filter to actual conflicts
      const actualConflicts = conflictScenarios.filter(scenario => {
        const dependentRuns = dependentConditions.some(
          condition => ConditionEvaluator.evaluate(condition, scenario.variables).result,
        )
        const dependencyRuns = dependencyConditions.some(
          condition => ConditionEvaluator.evaluate(condition, scenario.variables).result,
        )
        return dependentRuns && !dependencyRuns
      })

      // All returned scenarios should be actual conflicts
      expect(actualConflicts.length).toBe(conflictScenarios.length)

      // Should include the main conflict scenario
      const hasMainConflict = actualConflicts.some(
        scenario =>
          scenario.variables['CI_COMMIT_BRANCH'] === 'main' &&
          scenario.variables['EPH_ENV_ID'] !== null,
      )
      expect(hasMainConflict).toBe(true)
    })
  })
})
