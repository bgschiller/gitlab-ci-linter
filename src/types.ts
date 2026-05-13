export type GitLabWhen = 'on_success' | 'on_failure' | 'always' | 'manual' | 'delayed' | 'never'

export interface LintIssue {
  severity: 'error' | 'warning' | 'info'
  message: string
  location?: string
}

export interface GitLabArtifacts {
  paths?: string[]
  expire_in?: string
  when?: 'on_success' | 'on_failure' | 'always'
  name?: string
  reports?: Record<string, any>
  untracked?: boolean
  exclude?: string[]
}

export interface GitLabJob {
  stage?: string
  script?: string[]
  before_script?: string[]
  after_script?: string[]
  rules?: GitLabRule[]
  only?: GitLabOnly
  except?: GitLabExcept
  when?: GitLabWhen
  allow_failure?: boolean
  dependencies?: string[]
  needs?: string[] | GitLabNeed[]
  extends?: string | string[]
  variables?: Record<string, string>
  artifacts?: GitLabArtifacts
  tags?: string[] | string
  [key: string]: any
}

export interface GitLabChangesObject {
  paths?: string[]
  compare_to?: string
}

export interface GitLabRule {
  if?: string
  changes?: (string | any)[] | GitLabChangesObject
  exists?: (string | any)[]
  when?: GitLabWhen
  allow_failure?: boolean
  variables?: Record<string, string>
}

export interface GitLabOnly {
  refs?: string[]
  variables?: string[]
  changes?: (string | any)[]
  kubernetes?: 'active'
}

export interface GitLabExcept {
  refs?: string[]
  variables?: string[]
  changes?: (string | any)[]
  kubernetes?: 'active'
}

export interface GitLabNeed {
  job: string
  artifacts?: boolean
  optional?: boolean
}

export interface GitLabWorkflow {
  rules?: GitLabRule[]
}

export interface GitLabInclude {
  local?: string
  file?: string | string[]
  template?: string
  remote?: string
  project?: string
  ref?: string
  /** Component include path, e.g., "$CI_SERVER_FQDN/namespace/project/component@version" */
  component?: string
  /** Input values for component includes */
  inputs?: Record<string, unknown>
  /**
   * Conditional rules that determine whether this include is loaded.
   * Evaluated against the scenario's variables when an evaluation context is
   * provided to the processor; ignored otherwise (all includes load).
   */
  rules?: GitLabRule[]
}

export interface GitLabCI {
  stages?: string[]
  variables?: Record<string, string>
  workflow?: GitLabWorkflow
  include?: GitLabInclude | GitLabInclude[] | string | string[]
  [jobName: string]: any
}

export interface PipelineContext {
  event: 'push' | 'merge_request' | 'schedule' | 'web' | 'api'
  ref: string
  changes?: string[]
  variables: Record<string, string>
}
