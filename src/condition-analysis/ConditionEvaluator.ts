import {
  type ComparisonOperator,
  type ConditionEvaluation,
  type LogicalOperator,
  type ParsedCondition,
  type UnaryOperator,
} from './types.js'

/**
 * Evaluates parsed GitLab CI conditions against variable sets
 */
export class ConditionEvaluator {
  /**
   * Evaluate a parsed condition against a set of variables
   */
  static evaluate(
    condition: ParsedCondition,
    variables: Record<string, string | null>,
  ): ConditionEvaluation {
    const result = this.evaluateCondition(condition, variables)
    const explanation = this.generateExplanation(condition, variables, result)

    return {
      condition,
      variables,
      result,
      explanation,
    }
  }

  private static evaluateCondition(
    condition: ParsedCondition,
    variables: Record<string, string | null>,
  ): boolean {
    switch (condition.type) {
      case 'variable':
        return this.evaluateVariable(condition, variables)

      case 'literal':
        return this.evaluateLiteral(condition)

      case 'comparison':
        return this.evaluateComparison(condition, variables)

      case 'logical':
        return this.evaluateLogical(condition, variables)

      default:
        throw new Error(`Unknown condition type: ${(condition as any).type}`)
    }
  }

  private static evaluateVariable(
    condition: ParsedCondition,
    variables: Record<string, string | null>,
  ): boolean {
    if (!condition.variable) {
      throw new Error('Variable condition missing variable name')
    }

    const value = variables[condition.variable]

    // In GitLab CI, variables are truthy if they exist and are not empty
    // null, undefined, and empty string are falsy
    return value !== null && value !== undefined && value !== ''
  }

  private static evaluateLiteral(condition: ParsedCondition): boolean {
    // Literals in boolean context: null/empty = false, anything else = true
    return condition.value !== null && condition.value !== undefined && condition.value !== ''
  }

  private static evaluateComparison(
    condition: ParsedCondition,
    variables: Record<string, string | null>,
  ): boolean {
    if (!condition.left || !condition.right || !condition.operator) {
      throw new Error('Comparison condition missing operands or operator')
    }

    const leftValue = this.resolveValue(condition.left, variables)
    const rightValue = this.resolveValue(condition.right, variables)
    const operator = condition.operator as ComparisonOperator

    return this.compareValues(leftValue, rightValue, operator)
  }

  private static evaluateLogical(
    condition: ParsedCondition,
    variables: Record<string, string | null>,
  ): boolean {
    const operator = condition.operator as LogicalOperator | UnaryOperator

    switch (operator) {
      case '!': {
        if (!condition.right) {
          throw new Error('Unary NOT operator missing operand')
        }
        return !this.evaluateCondition(condition.right, variables)
      }

      case '&&': {
        if (!condition.left || !condition.right) {
          throw new Error('Logical AND operator missing operands')
        }
        return (
          this.evaluateCondition(condition.left, variables) &&
          this.evaluateCondition(condition.right, variables)
        )
      }

      case '||': {
        if (!condition.left || !condition.right) {
          throw new Error('Logical OR operator missing operands')
        }
        return (
          this.evaluateCondition(condition.left, variables) ||
          this.evaluateCondition(condition.right, variables)
        )
      }

      default:
        throw new Error(`Unknown logical operator: ${operator}`)
    }
  }

  private static resolveValue(
    condition: ParsedCondition,
    variables: Record<string, string | null>,
  ): string | null {
    switch (condition.type) {
      case 'variable':
        if (!condition.variable) {
          throw new Error('Variable condition missing variable name')
        }
        return variables[condition.variable] ?? null

      case 'literal':
        return condition.value ?? null

      default:
        throw new Error(`Cannot resolve value for condition type: ${condition.type}`)
    }
  }

  private static compareValues(
    left: string | null,
    right: string | null,
    operator: ComparisonOperator,
  ): boolean {
    switch (operator) {
      case '==':
        return left === right

      case '!=':
        return left !== right

      case '>': {
        if (left === null || right === null) return false
        return this.compareNumericOrString(left, right) > 0
      }

      case '<': {
        if (left === null || right === null) return false
        return this.compareNumericOrString(left, right) < 0
      }

      case '>=': {
        if (left === null || right === null) return false
        return this.compareNumericOrString(left, right) >= 0
      }

      case '<=': {
        if (left === null || right === null) return false
        return this.compareNumericOrString(left, right) <= 0
      }

      case '=~': {
        if (left === null || right === null) return false
        try {
          const regex = new RegExp(right)
          return regex.test(left)
        } catch {
          return false // Invalid regex
        }
      }

      case '!~': {
        if (left === null || right === null) return true
        try {
          const regex = new RegExp(right)
          return !regex.test(left)
        } catch {
          return true // Invalid regex
        }
      }

      default:
        throw new Error(`Unknown comparison operator: ${operator}`)
    }
  }

  private static compareNumericOrString(left: string, right: string): number {
    // Try numeric comparison first
    const leftNum = parseFloat(left)
    const rightNum = parseFloat(right)

    if (!isNaN(leftNum) && !isNaN(rightNum)) {
      return leftNum - rightNum
    }

    // Fall back to string comparison
    return left.localeCompare(right)
  }

  private static generateExplanation(
    condition: ParsedCondition,
    variables: Record<string, string | null>,
    result: boolean,
  ): string {
    const conditionStr = this.conditionToString(condition)
    const variableValues = this.formatVariableValues(condition.variables, variables)

    return `${conditionStr} evaluates to ${result} (${variableValues})`
  }

  private static conditionToString(condition: ParsedCondition): string {
    switch (condition.type) {
      case 'variable':
        return condition.value || condition.variable || 'unknown_var'

      case 'literal':
        return condition.value === null ? 'null' : `"${condition.value}"`

      case 'comparison': {
        if (!condition.left || !condition.right || !condition.operator) {
          return 'invalid_comparison'
        }
        const left = this.conditionToString(condition.left)
        const right = this.conditionToString(condition.right)
        return `${left} ${condition.operator} ${right}`
      }

      case 'logical': {
        const operator = condition.operator

        if (operator === '!') {
          if (!condition.right) return 'invalid_unary'
          return `!${this.conditionToString(condition.right)}`
        }

        if (!condition.left || !condition.right) {
          return 'invalid_logical'
        }

        const leftStr = this.conditionToString(condition.left)
        const rightStr = this.conditionToString(condition.right)

        // Add parentheses for clarity in complex expressions
        return `${leftStr} ${operator} ${rightStr}`
      }

      default:
        return 'unknown_condition'
    }
  }

  private static formatVariableValues(
    variableNames: Set<string>,
    variables: Record<string, string | null>,
  ): string {
    const values = Array.from(variableNames).map(name => {
      const value = variables[name]
      const displayValue =
        value === null ? 'null' : value === undefined ? 'undefined' : `"${value}"`
      return `${name}=${displayValue}`
    })

    return values.join(', ')
  }

  /**
   * Check if a condition would evaluate differently with different variable values
   */
  static findConflictingScenarios(
    condition: ParsedCondition,
    scenarios: Array<Record<string, string | null>>,
  ): Array<{ scenario: Record<string, string | null>; result: boolean; explanation: string }> {
    return scenarios.map(scenario => {
      const evaluation = this.evaluate(condition, scenario)
      return {
        scenario,
        result: evaluation.result,
        explanation: evaluation.explanation,
      }
    })
  }
}
