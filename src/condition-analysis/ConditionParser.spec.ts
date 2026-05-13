import { describe, expect, it } from 'vitest'
import { ConditionParser } from './ConditionParser.js'

describe('ConditionParser', () => {
  describe('basic conditions', () => {
    it('should parse simple variable equality', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_BRANCH == "main"')

      expect(condition.type).toBe('comparison')
      expect(condition.operator).toBe('==')
      expect(condition.left?.type).toBe('variable')
      expect(condition.left?.variable).toBe('CI_COMMIT_BRANCH')
      expect(condition.right?.type).toBe('literal')
      expect(condition.right?.value).toBe('main')
      expect(condition.variables).toEqual(new Set(['CI_COMMIT_BRANCH']))
    })

    it('should parse variable inequality', () => {
      const condition = ConditionParser.parse('$EPH_ENV_ID != null')

      expect(condition.type).toBe('comparison')
      expect(condition.operator).toBe('!=')
      expect(condition.left?.type).toBe('variable')
      expect(condition.left?.variable).toBe('EPH_ENV_ID')
      expect(condition.right?.type).toBe('literal')
      expect(condition.right?.value).toBe(null)
      expect(condition.variables).toEqual(new Set(['EPH_ENV_ID']))
    })

    it('should parse variable with curly braces syntax', () => {
      const condition = ConditionParser.parse('${CI_DEFAULT_BRANCH} == "main"')

      expect(condition.type).toBe('comparison')
      expect(condition.left?.type).toBe('variable')
      expect(condition.left?.variable).toBe('CI_DEFAULT_BRANCH')
      expect(condition.variables).toEqual(new Set(['CI_DEFAULT_BRANCH']))
    })

    it('should parse variable comparison to another variable', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH')

      expect(condition.type).toBe('comparison')
      expect(condition.operator).toBe('==')
      expect(condition.left?.type).toBe('variable')
      expect(condition.left?.variable).toBe('CI_COMMIT_BRANCH')
      expect(condition.right?.type).toBe('variable')
      expect(condition.right?.variable).toBe('CI_DEFAULT_BRANCH')
      expect(condition.variables).toEqual(new Set(['CI_COMMIT_BRANCH', 'CI_DEFAULT_BRANCH']))
    })
  })

  describe('logical operators', () => {
    it('should parse logical AND', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_BRANCH == "main" && $EPH_ENV_ID == null')

      expect(condition.type).toBe('logical')
      expect(condition.operator).toBe('&&')
      expect(condition.left?.type).toBe('comparison')
      expect(condition.right?.type).toBe('comparison')
      expect(condition.variables).toEqual(new Set(['CI_COMMIT_BRANCH', 'EPH_ENV_ID']))
    })

    it('should parse logical OR', () => {
      const condition = ConditionParser.parse(
        '$CI_PIPELINE_SOURCE == "push" || $CI_PIPELINE_SOURCE == "web"',
      )

      expect(condition.type).toBe('logical')
      expect(condition.operator).toBe('||')
      expect(condition.left?.type).toBe('comparison')
      expect(condition.right?.type).toBe('comparison')
      expect(condition.variables).toEqual(new Set(['CI_PIPELINE_SOURCE']))
    })

    it('should parse logical NOT', () => {
      const condition = ConditionParser.parse('!($CI_COMMIT_BRANCH == "main")')

      expect(condition.type).toBe('logical')
      expect(condition.operator).toBe('!')
      expect(condition.right?.type).toBe('comparison')
      expect(condition.variables).toEqual(new Set(['CI_COMMIT_BRANCH']))
    })

    it('should handle operator precedence', () => {
      // AND has higher precedence than OR
      const condition = ConditionParser.parse('$A == "1" || $B == "2" && $C == "3"')

      expect(condition.type).toBe('logical')
      expect(condition.operator).toBe('||')
      expect(condition.left?.type).toBe('comparison')
      expect(condition.right?.type).toBe('logical')
      expect(condition.right?.operator).toBe('&&')
    })
  })

  describe('parentheses and grouping', () => {
    it('should parse parentheses for grouping', () => {
      const condition = ConditionParser.parse(
        '($CI_PIPELINE_SOURCE == "push" || $CI_PIPELINE_SOURCE == "web") && $DEPLOY_ENV != "production"',
      )

      expect(condition.type).toBe('logical')
      expect(condition.operator).toBe('&&')
      expect(condition.left?.type).toBe('logical')
      expect(condition.left?.operator).toBe('||')
      expect(condition.right?.type).toBe('comparison')
    })

    it('should handle nested parentheses', () => {
      const condition = ConditionParser.parse('(($A == "1" || $B == "2") && $C == "3")')

      expect(condition.type).toBe('logical')
      expect(condition.operator).toBe('&&')
      expect(condition.left?.type).toBe('logical')
      expect(condition.left?.operator).toBe('||')
    })
  })

  describe('different comparison operators', () => {
    it('should parse greater than', () => {
      const condition = ConditionParser.parse('$VERSION_NUM > "1.0"')

      expect(condition.type).toBe('comparison')
      expect(condition.operator).toBe('>')
    })

    it('should parse less than or equal', () => {
      const condition = ConditionParser.parse('$RETRY_COUNT <= "3"')

      expect(condition.type).toBe('comparison')
      expect(condition.operator).toBe('<=')
    })

    it('should parse regex match', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_REF_NAME =~ /^release-.*/')

      expect(condition.type).toBe('comparison')
      expect(condition.operator).toBe('=~')
    })

    it('should parse regex not match', () => {
      const condition = ConditionParser.parse('$CI_COMMIT_REF_NAME !~ /^hotfix-.*/')

      expect(condition.type).toBe('comparison')
      expect(condition.operator).toBe('!~')
    })
  })

  describe('string handling', () => {
    it('should parse single quoted strings', () => {
      const condition = ConditionParser.parse("$ENVIRONMENT == 'production'")

      expect(condition.right?.type).toBe('literal')
      expect(condition.right?.value).toBe('production')
    })

    it('should parse double quoted strings', () => {
      const condition = ConditionParser.parse('$ENVIRONMENT == "staging"')

      expect(condition.right?.type).toBe('literal')
      expect(condition.right?.value).toBe('staging')
    })

    it('should handle escaped characters in strings', () => {
      const condition = ConditionParser.parse('$MESSAGE == "Hello \\"world\\""')

      expect(condition.right?.type).toBe('literal')
      expect(condition.right?.value).toBe('Hello "world"')
    })

    it('should handle unquoted strings', () => {
      const condition = ConditionParser.parse('$ENVIRONMENT == production')

      expect(condition.right?.type).toBe('literal')
      expect(condition.right?.value).toBe('production')
    })
  })

  describe('complex real-world conditions', () => {
    it('should parse typical GitLab CI condition', () => {
      const condition = ConditionParser.parse(
        '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $EPH_ENV_ID == null',
      )

      expect(condition.type).toBe('logical')
      expect(condition.operator).toBe('&&')
      expect(condition.variables).toEqual(
        new Set(['CI_COMMIT_BRANCH', 'CI_DEFAULT_BRANCH', 'EPH_ENV_ID']),
      )

      // Verify structure
      const left = condition.left!
      expect(left.type).toBe('comparison')
      expect(left.left?.variable).toBe('CI_COMMIT_BRANCH')
      expect(left.right?.variable).toBe('CI_DEFAULT_BRANCH')

      const right = condition.right!
      expect(right.type).toBe('comparison')
      expect(right.left?.variable).toBe('EPH_ENV_ID')
      expect(right.right?.value).toBe(null)
    })

    it('should parse schedule exclusion condition', () => {
      const condition = ConditionParser.parse('$CI_PIPELINE_SOURCE != "schedule"')

      expect(condition.type).toBe('comparison')
      expect(condition.operator).toBe('!=')
      expect(condition.left?.variable).toBe('CI_PIPELINE_SOURCE')
      expect(condition.right?.value).toBe('schedule')
    })

    it('should parse merge request condition', () => {
      const condition = ConditionParser.parse(
        '($CI_PIPELINE_SOURCE == "merge_request_event" || $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH) && $SKIP_DEPLOY != "true"',
      )

      expect(condition.type).toBe('logical')
      expect(condition.operator).toBe('&&')
      expect(condition.variables).toEqual(
        new Set(['CI_PIPELINE_SOURCE', 'CI_COMMIT_BRANCH', 'CI_DEFAULT_BRANCH', 'SKIP_DEPLOY']),
      )

      // Should properly parse the OR condition in parentheses
      const left = condition.left!
      expect(left.type).toBe('logical')
      expect(left.operator).toBe('||')
    })
  })

  describe('error handling', () => {
    it('should throw error for unterminated string', () => {
      expect(() => ConditionParser.parse('$VAR == "unterminated')).toThrow('Unterminated string')
    })

    it('should throw error for unmatched parentheses', () => {
      expect(() => ConditionParser.parse('($VAR == "test"')).toThrow('Expected RPAREN')
    })

    it('should throw error for invalid syntax', () => {
      expect(() => ConditionParser.parse('$VAR ==')).toThrow()
    })

    it('should throw error for unterminated variable expression', () => {
      expect(() => ConditionParser.parse('${VAR == "test"')).toThrow(
        'Unterminated variable expression',
      )
    })

    it('should provide helpful error messages', () => {
      try {
        ConditionParser.parse('$VAR == "value" &&')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('Failed to parse condition')
      }
    })
  })

  describe('whitespace handling', () => {
    it('should handle extra whitespace', () => {
      const condition = ConditionParser.parse('  $CI_COMMIT_BRANCH   ==   "main"  ')

      expect(condition.type).toBe('comparison')
      expect(condition.left?.variable).toBe('CI_COMMIT_BRANCH')
      expect(condition.right?.value).toBe('main')
    })

    it('should handle no whitespace', () => {
      const condition = ConditionParser.parse('$VAR=="value"')

      expect(condition.type).toBe('comparison')
      expect(condition.left?.variable).toBe('VAR')
      expect(condition.right?.value).toBe('value')
    })
  })

  describe('variable extraction', () => {
    it('should correctly extract all variables from complex conditions', () => {
      const condition = ConditionParser.parse('($A == $B && $C != "test") || $D =~ "pattern"')

      expect(condition.variables).toEqual(new Set(['A', 'B', 'C', 'D']))
    })

    it('should handle duplicate variables', () => {
      const condition = ConditionParser.parse('$VAR == "a" || $VAR == "b"')

      expect(condition.variables).toEqual(new Set(['VAR']))
    })
  })
})
