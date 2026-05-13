/**
 * GitLab CI Condition Analysis
 *
 * This module provides parsing and evaluation capabilities for GitLab CI condition expressions.
 * It supports parsing complex conditions with variables, comparisons, and logical operators,
 * and can evaluate these conditions against different variable scenarios to identify
 * potential pipeline failures.
 */

export { ConditionParser } from './ConditionParser.js'
export { ConditionEvaluator } from './ConditionEvaluator.js'
export { ScenarioGenerator } from './ScenarioGenerator.js'
export type {
  ParsedCondition,
  VariableScenario,
  ConditionAnalysis,
  ConditionEvaluation,
  ParsingError,
  ComparisonOperator,
  LogicalOperator,
  UnaryOperator,
  Token,
  TokenType,
  GitLabVariable,
  GITLAB_VARIABLES,
  VARIABLE_PATTERNS,
} from './types.js'
