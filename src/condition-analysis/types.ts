/**
 * Types for GitLab CI condition analysis and scenario generation
 */

export interface ParsedCondition {
  type: 'comparison' | 'logical' | 'variable' | 'literal'
  operator?: ComparisonOperator | LogicalOperator | UnaryOperator
  left?: ParsedCondition
  right?: ParsedCondition
  value?: string | null
  variable?: string
  variables: Set<string>
}

export type ComparisonOperator = '==' | '!=' | '>' | '<' | '>=' | '<=' | '=~' | '!~'
export type LogicalOperator = '&&' | '||'
export type UnaryOperator = '!'

export interface VariableScenario {
  variables: Record<string, string | null>
  description: string
  tags: string[] // e.g., ['main-branch', 'production', 'scheduled']
}

export interface ConditionAnalysis {
  dependentConditions: ParsedCondition[]
  dependencyConditions: ParsedCondition[]
  conflictingScenarios: VariableScenario[]
  failureExplanation: string
  suggestions: string[]
}

export interface ConditionEvaluation {
  condition: ParsedCondition
  variables: Record<string, string | null>
  result: boolean
  explanation: string
}

export interface ParsingError extends Error {
  position?: number
  token?: string
  expected?: string[]
}

/**
 * Predefined pipeline context templates that mirror GitLab's actual variable behavior.
 *
 * Each template represents a real pipeline source type with the correct variable
 * values (including null for variables GitLab doesn't set in that context).
 *
 * See: https://docs.gitlab.com/ci/variables/predefined_variables/
 */
export interface PipelineContextTemplate {
  description: string
  tags: string[]
  variables: Record<string, string | null>
}

export const PIPELINE_CONTEXT_TEMPLATES: PipelineContextTemplate[] = [
  // === Push events ===
  {
    description: 'Push to default branch (production deployment)',
    tags: ['main-branch', 'push', 'production'],
    variables: {
      CI_PIPELINE_SOURCE: 'push',
      CI_COMMIT_BRANCH: 'main',
      CI_COMMIT_REF_NAME: 'main',
      CI_COMMIT_REF_PROTECTED: 'true',
      CI_DEFAULT_BRANCH: 'main',
      CI_COMMIT_TAG: null,
      CI_MERGE_REQUEST_ID: null,
      CI_MERGE_REQUEST_IID: null,
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: null,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: null,
      CI_MERGE_REQUEST_EVENT_TYPE: null,
    },
  },
  {
    description: 'Push to development branch (staging deployment)',
    tags: ['dev-branch', 'push', 'staging'],
    variables: {
      CI_PIPELINE_SOURCE: 'push',
      CI_COMMIT_BRANCH: 'develop',
      CI_COMMIT_REF_NAME: 'develop',
      CI_COMMIT_REF_PROTECTED: 'false',
      CI_DEFAULT_BRANCH: 'main',
      CI_COMMIT_TAG: null,
      CI_MERGE_REQUEST_ID: null,
      CI_MERGE_REQUEST_IID: null,
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: null,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: null,
      CI_MERGE_REQUEST_EVENT_TYPE: null,
    },
  },
  {
    description: 'Push to feature branch',
    tags: ['feature-branch', 'push'],
    variables: {
      CI_PIPELINE_SOURCE: 'push',
      CI_COMMIT_BRANCH: 'feature/new-feature',
      CI_COMMIT_REF_NAME: 'feature/new-feature',
      CI_COMMIT_REF_PROTECTED: 'false',
      CI_DEFAULT_BRANCH: 'main',
      CI_COMMIT_TAG: null,
      CI_MERGE_REQUEST_ID: null,
      CI_MERGE_REQUEST_IID: null,
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: null,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: null,
      CI_MERGE_REQUEST_EVENT_TYPE: null,
    },
  },

  // === Merge request events ===
  // Note: CI_COMMIT_BRANCH is null for MR pipelines (GitLab does not set it)
  {
    description: 'Merge request targeting default branch',
    tags: ['main-branch', 'merge-request'],
    variables: {
      CI_PIPELINE_SOURCE: 'merge_request_event',
      CI_COMMIT_BRANCH: null,
      CI_COMMIT_REF_NAME: 'feature/test',
      CI_COMMIT_REF_PROTECTED: 'false',
      CI_DEFAULT_BRANCH: 'main',
      CI_COMMIT_TAG: null,
      CI_MERGE_REQUEST_ID: '123',
      CI_MERGE_REQUEST_IID: '42',
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main',
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature/test',
      CI_MERGE_REQUEST_EVENT_TYPE: 'detached',
    },
  },
  {
    description: 'Merge request targeting non-default branch',
    tags: ['merge-request', 'non-default-target'],
    variables: {
      CI_PIPELINE_SOURCE: 'merge_request_event',
      CI_COMMIT_BRANCH: null,
      CI_COMMIT_REF_NAME: 'feature/test',
      CI_COMMIT_REF_PROTECTED: 'false',
      CI_DEFAULT_BRANCH: 'main',
      CI_COMMIT_TAG: null,
      CI_MERGE_REQUEST_ID: '124',
      CI_MERGE_REQUEST_IID: '43',
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'develop',
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature/test',
      CI_MERGE_REQUEST_EVENT_TYPE: 'detached',
    },
  },

  // === Tag push ===
  {
    description: 'Tag push (release)',
    tags: ['tag', 'release'],
    variables: {
      CI_PIPELINE_SOURCE: 'push',
      CI_COMMIT_BRANCH: null,
      CI_COMMIT_REF_NAME: 'v1.0.0',
      CI_COMMIT_REF_PROTECTED: 'true',
      CI_DEFAULT_BRANCH: 'main',
      CI_COMMIT_TAG: 'v1.0.0',
      CI_MERGE_REQUEST_ID: null,
      CI_MERGE_REQUEST_IID: null,
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: null,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: null,
      CI_MERGE_REQUEST_EVENT_TYPE: null,
    },
  },

  // === Schedule ===
  {
    description: 'Scheduled pipeline on default branch',
    tags: ['scheduled', 'main-branch'],
    variables: {
      CI_PIPELINE_SOURCE: 'schedule',
      CI_COMMIT_BRANCH: 'main',
      CI_COMMIT_REF_NAME: 'main',
      CI_COMMIT_REF_PROTECTED: 'true',
      CI_DEFAULT_BRANCH: 'main',
      CI_COMMIT_TAG: null,
      CI_MERGE_REQUEST_ID: null,
      CI_MERGE_REQUEST_IID: null,
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: null,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: null,
      CI_MERGE_REQUEST_EVENT_TYPE: null,
    },
  },

  // === Web (manual) ===
  {
    description: 'Manual web pipeline on default branch',
    tags: ['main-branch', 'manual', 'web'],
    variables: {
      CI_PIPELINE_SOURCE: 'web',
      CI_COMMIT_BRANCH: 'main',
      CI_COMMIT_REF_NAME: 'main',
      CI_COMMIT_REF_PROTECTED: 'true',
      CI_DEFAULT_BRANCH: 'main',
      CI_COMMIT_TAG: null,
      CI_MERGE_REQUEST_ID: null,
      CI_MERGE_REQUEST_IID: null,
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: null,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: null,
      CI_MERGE_REQUEST_EVENT_TYPE: null,
    },
  },

  // === API/Trigger ===
  {
    description: 'API/trigger pipeline',
    tags: ['api', 'trigger'],
    variables: {
      CI_PIPELINE_SOURCE: 'api',
      CI_COMMIT_BRANCH: 'main',
      CI_COMMIT_REF_NAME: 'main',
      CI_COMMIT_REF_PROTECTED: 'true',
      CI_DEFAULT_BRANCH: 'main',
      CI_COMMIT_TAG: null,
      CI_MERGE_REQUEST_ID: null,
      CI_MERGE_REQUEST_IID: null,
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: null,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: null,
      CI_MERGE_REQUEST_EVENT_TYPE: null,
    },
  },
]

/**
 * Common GitLab CI variable patterns and their typical values
 */
export const GITLAB_VARIABLES = {
  // Branch and commit info
  CI_COMMIT_BRANCH: ['main', 'develop', 'feature/test', 'hotfix/urgent', 'release/1.0', null],
  CI_COMMIT_REF_NAME: ['main', 'develop', 'feature/test', 'v1.0.0', 'hotfix/urgent'],
  CI_DEFAULT_BRANCH: ['main', 'master', 'develop'],
  CI_COMMIT_TAG: [null, 'v1.0.0', 'release-1.0', '1.2.3'],
  CI_COMMIT_SHA: ['abc123def456', '789xyz012abc', null],

  // Pipeline info
  CI_PIPELINE_SOURCE: ['push', 'web', 'schedule', 'api', 'merge_request_event', 'trigger'],
  CI_PIPELINE_TRIGGERED: ['true', 'false', null],
  CI_PIPELINE_ID: ['12345', '67890', null],
  CI_JOB_STAGE: ['build', 'test', 'deploy', 'cleanup'],

  // Merge request info
  CI_MERGE_REQUEST_ID: [null, '123', '456', '789'],
  CI_MERGE_REQUEST_TARGET_BRANCH_NAME: [null, 'main', 'develop', 'release/1.0'],
  CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: [null, 'feature/test', 'hotfix/bug'],
  CI_MERGE_REQUEST_EVENT_TYPE: [null, 'detached', 'merged_result'],

  // Environment and deployment
  CI_ENVIRONMENT_NAME: [null, 'production', 'staging', 'development', 'testing'],
  CI_ENVIRONMENT_SLUG: [null, 'production', 'staging', 'dev', 'test'],
  CI_ENVIRONMENT_URL: [null, 'https://app.example.com', 'https://staging.example.com'],

  // Runner and execution context
  CI_RUNNER_TAGS: [null, 'docker', 'kubernetes', 'shared'],
  CI_JOB_NAME: [null, 'build', 'test', 'deploy', 'cleanup'],
  CI_JOB_TOKEN: [null, 'token123', 'secure-token-456'],

  // Common custom variables (application-specific)
  DEPLOY_ENV: [null, 'production', 'staging', 'development', 'testing'],
  EPH_ENV_ID: [null, 'eph-123', 'test-env-456', 'pr-789'],
  SKIP_DEPLOY: [null, 'true', 'false'],
  RUN_TESTS: [null, 'true', 'false', '1', '0'],
  DEBUG: [null, 'true', 'false', '1', '0'],
  NODE_ENV: [null, 'production', 'development', 'test'],

  // Security and compliance
  SECURITY_SCAN: [null, 'true', 'false', 'required'],
  COMPLIANCE_CHECK: [null, 'enabled', 'disabled', 'audit'],

  // Feature flags
  FEATURE_FLAG_NEW_UI: [null, 'true', 'false', 'beta'],
  EXPERIMENTAL_FEATURES: [null, 'enabled', 'disabled'],

  // Version and build info
  VERSION: [null, '1.0.0', '2.1.3', 'beta'],
  BUILD_NUMBER: [null, '123', '456', '789'],
  RELEASE_VERSION: [null, 'v1.0.0', 'v2.1.0', 'latest'],
} as const

/**
 * Variable pattern recognition for better default value assignment
 */
export const VARIABLE_PATTERNS = {
  // Branch patterns
  BRANCH_PATTERNS: [/CI_.*BRANCH$/, /.*_BRANCH$/, /BRANCH_.*$/],

  // Environment patterns
  ENV_PATTERNS: [/.*_ENV$/, /ENV_.*$/, /CI_ENVIRONMENT_.*$/, /DEPLOY_.*$/],

  // ID patterns
  ID_PATTERNS: [/.*_ID$/, /ID_.*$/, /.*_UUID$/, /UUID_.*$/],

  // Boolean flag patterns
  FLAG_PATTERNS: [
    /SKIP_.*$/,
    /RUN_.*$/,
    /ENABLE_.*$/,
    /.*_ENABLED$/,
    /.*_FLAG$/,
    /DEBUG.*$/,
    /FEATURE_.*$/,
  ],

  // Version patterns
  VERSION_PATTERNS: [/.*VERSION$/, /VERSION_.*$/, /.*_VER$/, /VER_.*$/],

  // URL patterns
  URL_PATTERNS: [/.*_URL$/, /URL_.*$/, /.*_ENDPOINT$/, /ENDPOINT_.*$/],
} as const

export type GitLabVariable = keyof typeof GITLAB_VARIABLES

/**
 * Token types for the lexer
 */
export interface Token {
  type: TokenType
  value: string
  position: number
}

export enum TokenType {
  VARIABLE = 'VARIABLE',
  STRING = 'STRING',
  NULL = 'NULL',
  COMPARISON_OP = 'COMPARISON_OP',
  LOGICAL_OP = 'LOGICAL_OP',
  UNARY_OP = 'UNARY_OP',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  WHITESPACE = 'WHITESPACE',
  EOF = 'EOF',
  UNKNOWN = 'UNKNOWN',
}
