import { describe, expect, it } from 'vitest'
import { ConditionParser } from './ConditionParser.js'
import { ConditionEvaluator } from './ConditionEvaluator.js'

describe('ConditionEvaluator', () => {
  describe('basic evaluation', () => {
    it('should evaluate simple equality to true', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_BRANCH == "main"')
      const variables = { CI_COMMIT_BRANCH: 'main' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
      expect(result.explanation).toContain('evaluates to true')
      expect(result.explanation).toContain('CI_COMMIT_BRANCH="main"')
    })

    it('should evaluate simple equality to false', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_BRANCH == "main"')
      const variables = { CI_COMMIT_BRANCH: 'develop' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(false)
      expect(result.explanation).toContain('evaluates to false')
      expect(result.explanation).toContain('CI_COMMIT_BRANCH="develop"')
    })

    it('should evaluate null comparison', () => {
      const condition = ConditionParser.parse('$EPH_ENV_ID == null')
      const variables = { EPH_ENV_ID: null }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
      expect(result.explanation).toContain('EPH_ENV_ID=null')
    })

    it('should evaluate not null comparison', () => {
      const condition = ConditionParser.parse('$EPH_ENV_ID != null')
      const variables = { EPH_ENV_ID: 'test-env' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
      expect(result.explanation).toContain('EPH_ENV_ID="test-env"')
    })
  })

  describe('variable to variable comparison', () => {
    it('should evaluate variable equality', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH')
      const variables = { CI_COMMIT_BRANCH: 'main', CI_DEFAULT_BRANCH: 'main' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
      expect(result.explanation).toContain('CI_COMMIT_BRANCH="main"')
      expect(result.explanation).toContain('CI_DEFAULT_BRANCH="main"')
    })

    it('should evaluate variable inequality', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH')
      const variables = { CI_COMMIT_BRANCH: 'feature', CI_DEFAULT_BRANCH: 'main' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(false)
    })
  })

  describe('logical operators', () => {
    it('should evaluate logical AND to true', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_BRANCH == "main" && $EPH_ENV_ID == null')
      const variables = { CI_COMMIT_BRANCH: 'main', EPH_ENV_ID: null }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
    })

    it('should evaluate logical AND to false when first condition fails', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_BRANCH == "main" && $EPH_ENV_ID == null')
      const variables = { CI_COMMIT_BRANCH: 'develop', EPH_ENV_ID: null }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(false)
    })

    it('should evaluate logical AND to false when second condition fails', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_BRANCH == "main" && $EPH_ENV_ID == null')
      const variables = { CI_COMMIT_BRANCH: 'main', EPH_ENV_ID: 'test-env' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(false)
    })

    it('should evaluate logical OR to true when first condition passes', () => {
      const condition = ConditionParser.parse(
        '$CI_PIPELINE_SOURCE == "push" || $CI_PIPELINE_SOURCE == "web"',
      )
      const variables = { CI_PIPELINE_SOURCE: 'push' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
    })

    it('should evaluate logical OR to true when second condition passes', () => {
      const condition = ConditionParser.parse(
        '$CI_PIPELINE_SOURCE == "push" || $CI_PIPELINE_SOURCE == "web"',
      )
      const variables = { CI_PIPELINE_SOURCE: 'web' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
    })

    it('should evaluate logical OR to false when both conditions fail', () => {
      const condition = ConditionParser.parse(
        '$CI_PIPELINE_SOURCE == "push" || $CI_PIPELINE_SOURCE == "web"',
      )
      const variables = { CI_PIPELINE_SOURCE: 'schedule' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(false)
    })

    it('should evaluate logical NOT', () => {
      const condition = ConditionParser.parse('!($CI_COMMIT_BRANCH == "main")')
      const variables = { CI_COMMIT_BRANCH: 'develop' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
    })
  })

  describe('comparison operators', () => {
    it('should evaluate greater than with numbers', () => {
      const condition = ConditionParser.parse('$VERSION_NUM > "1.0"')
      const variables = { VERSION_NUM: '2.0' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
    })

    it('should evaluate less than with numbers', () => {
      const condition = ConditionParser.parse('$VERSION_NUM < "2.0"')
      const variables = { VERSION_NUM: '1.0' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
    })

    it('should evaluate greater than or equal', () => {
      const condition = ConditionParser.parse('$RETRY_COUNT >= "3"')
      const variables = { RETRY_COUNT: '3' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
    })

    it('should evaluate string comparison with greater than', () => {
      const condition = ConditionParser.parse('$BRANCH_NAME > "main"')
      const variables = { BRANCH_NAME: 'production' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true) // 'production' > 'main' alphabetically
    })

    it('should handle null values in numeric comparisons', () => {
      const condition = ConditionParser.parse('$VERSION_NUM > "1.0"')
      const variables = { VERSION_NUM: null }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(false) // null comparisons should be false
    })
  })

  describe('regex operations', () => {
    it('should evaluate regex match', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_REF_NAME =~ "^release-.*"')
      const variables = { CI_COMMIT_REF_NAME: 'release-1.0' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
    })

    it('should evaluate regex not match', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_REF_NAME !~ "^hotfix-.*"')
      const variables = { CI_COMMIT_REF_NAME: 'release-1.0' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
    })

    it('should handle invalid regex gracefully', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_REF_NAME =~ "[invalid"')
      const variables = { CI_COMMIT_REF_NAME: 'main' }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(false) // Invalid regex should return false
    })

    it('should handle null values in regex operations', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_REF_NAME =~ "pattern"')
      const variables = { CI_COMMIT_REF_NAME: null }

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(false)
    })
  })

  describe('complex real-world scenarios', () => {
    it('should evaluate typical GitLab CI condition', () => {
      const condition = ConditionParser.parse(
        '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $EPH_ENV_ID == null',
      )

      // Scenario 1: main branch, no ephemeral env - should be true
      let variables: Record<string, string | null> = {
        CI_COMMIT_BRANCH: 'main',
        CI_DEFAULT_BRANCH: 'main',
        EPH_ENV_ID: null,
      }
      let result = ConditionEvaluator.evaluate(condition, variables)
      expect(result.result).toBe(true)

      // Scenario 2: main branch, with ephemeral env - should be false
      variables = { CI_COMMIT_BRANCH: 'main', CI_DEFAULT_BRANCH: 'main', EPH_ENV_ID: 'test-env' }
      result = ConditionEvaluator.evaluate(condition, variables)
      expect(result.result).toBe(false)

      // Scenario 3: feature branch, no ephemeral env - should be false
      variables = { CI_COMMIT_BRANCH: 'feature', CI_DEFAULT_BRANCH: 'main', EPH_ENV_ID: null }
      result = ConditionEvaluator.evaluate(condition, variables)
      expect(result.result).toBe(false)
    })

    it('should evaluate schedule exclusion condition', () => {
      const condition = ConditionParser.parse('$CI_PIPELINE_SOURCE != "schedule"')

      // Should be true for push
      let variables = { CI_PIPELINE_SOURCE: 'push' }
      let result = ConditionEvaluator.evaluate(condition, variables)
      expect(result.result).toBe(true)

      // Should be false for schedule
      variables = { CI_PIPELINE_SOURCE: 'schedule' }
      result = ConditionEvaluator.evaluate(condition, variables)
      expect(result.result).toBe(false)
    })

    it('should evaluate complex merge request condition', () => {
      const condition = ConditionParser.parse(
        '($CI_PIPELINE_SOURCE == "merge_request_event" || $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH) && $SKIP_DEPLOY != "true"',
      )

      // MR event, no skip - should be true
      let variables: Record<string, string | null> = {
        CI_PIPELINE_SOURCE: 'merge_request_event',
        CI_COMMIT_BRANCH: 'feature',
        CI_DEFAULT_BRANCH: 'main',
        SKIP_DEPLOY: null,
      }
      let result = ConditionEvaluator.evaluate(condition, variables)
      expect(result.result).toBe(true)

      // Main branch, no skip - should be true
      variables = {
        CI_PIPELINE_SOURCE: 'push',
        CI_COMMIT_BRANCH: 'main',
        CI_DEFAULT_BRANCH: 'main',
        SKIP_DEPLOY: null,
      }
      result = ConditionEvaluator.evaluate(condition, variables)
      expect(result.result).toBe(true)

      // MR event, but skip deploy - should be false
      variables = {
        CI_PIPELINE_SOURCE: 'merge_request_event',
        CI_COMMIT_BRANCH: 'feature',
        CI_DEFAULT_BRANCH: 'main',
        SKIP_DEPLOY: 'true',
      }
      result = ConditionEvaluator.evaluate(condition, variables)
      expect(result.result).toBe(false)

      // Feature branch push, no skip - should be false
      variables = {
        CI_PIPELINE_SOURCE: 'push',
        CI_COMMIT_BRANCH: 'feature',
        CI_DEFAULT_BRANCH: 'main',
        SKIP_DEPLOY: null,
      }
      result = ConditionEvaluator.evaluate(condition, variables)
      expect(result.result).toBe(false)
    })
  })

  describe('missing variables', () => {
    it('should handle undefined variables as null', () => {
      const condition = ConditionParser.parse('$UNDEFINED_VAR == null')
      const variables = {} // UNDEFINED_VAR is not defined

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(true)
    })

    it('should handle undefined variables in comparisons', () => {
      const condition = ConditionParser.parse('$UNDEFINED_VAR == "test"')
      const variables = {} // UNDEFINED_VAR is not defined

      const result = ConditionEvaluator.evaluate(condition, variables)

      expect(result.result).toBe(false) // null != "test"
    })
  })

  describe('findConflictingScenarios', () => {
    it('should find scenarios where condition evaluates differently', () => {
      const condition = ConditionParser.parse(
        '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $EPH_ENV_ID == null',
      )

      const scenarios = [
        { CI_COMMIT_BRANCH: 'main', CI_DEFAULT_BRANCH: 'main', EPH_ENV_ID: null },
        { CI_COMMIT_BRANCH: 'main', CI_DEFAULT_BRANCH: 'main', EPH_ENV_ID: 'test-env' },
        { CI_COMMIT_BRANCH: 'feature', CI_DEFAULT_BRANCH: 'main', EPH_ENV_ID: null },
      ]

      const results = ConditionEvaluator.findConflictingScenarios(condition, scenarios)

      expect(results).toHaveLength(3)
      expect(results[0]!.result).toBe(true) // main branch, no ephemeral env
      expect(results[1]!.result).toBe(false) // main branch, with ephemeral env
      expect(results[2]!.result).toBe(false) // feature branch, no ephemeral env

      // All should have explanations
      results.forEach(result => {
        expect(result.explanation).toBeTruthy()
        expect(typeof result.explanation).toBe('string')
      })
    })
  })

  describe('error handling', () => {
    it('should throw error for invalid condition types', () => {
      const invalidCondition = {
        type: 'invalid',
        variables: new Set<string>(),
      } as any

      expect(() => ConditionEvaluator.evaluate(invalidCondition, {})).toThrow(
        'Unknown condition type: invalid',
      )
    })

    it('should throw error for comparison without operands', () => {
      const invalidCondition = {
        type: 'comparison',
        operator: '==',
        variables: new Set<string>(),
      } as any

      expect(() => ConditionEvaluator.evaluate(invalidCondition, {})).toThrow(
        'Comparison condition missing operands or operator',
      )
    })

    it('should throw error for logical operator without operands', () => {
      const invalidCondition = {
        type: 'logical',
        operator: '&&',
        variables: new Set<string>(),
      } as any

      expect(() => ConditionEvaluator.evaluate(invalidCondition, {})).toThrow(
        'Logical AND operator missing operands',
      )
    })
  })
})
