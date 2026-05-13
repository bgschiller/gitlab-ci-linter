import type { LintIssue } from '../types'
import type { ProcessedConfig } from '../ProcessedConfig'

/**
 * Known GitLab CI top-level keywords (not job names)
 */
const GLOBAL_KEYWORDS = new Set([
  'stages',
  'variables',
  'default',
  'workflow',
  'include',
  'image',
  'services',
  'cache',
  'before_script',
  'after_script',
])

/**
 * Known job-level keys
 */
const JOB_KEYS = new Set([
  'script',
  'before_script',
  'after_script',
  'stage',
  'image',
  'services',
  'variables',
  'rules',
  'only',
  'except',
  'when',
  'allow_failure',
  'dependencies',
  'needs',
  'extends',
  'artifacts',
  'cache',
  'tags',
  'timeout',
  'retry',
  'parallel',
  'trigger',
  'resource_group',
  'environment',
  'release',
  'coverage',
  'secrets',
  'inherit',
  'interruptible',
  'id_tokens',
  'dast_configuration',
  'pages',
  'identity',
  'hooks',
])

/**
 * Known keys within 'rules' array items
 */
const RULES_ITEM_KEYS = new Set([
  'if',
  'changes',
  'exists',
  'when',
  'allow_failure',
  'variables',
  'needs',
])

/**
 * Known keys within 'only' and 'except' objects
 */
const ONLY_EXCEPT_KEYS = new Set(['refs', 'variables', 'changes', 'kubernetes'])

/**
 * Known keys within 'artifacts' object
 */
const ARTIFACTS_KEYS = new Set([
  'paths',
  'expire_in',
  'when',
  'name',
  'reports',
  'untracked',
  'exclude',
  'expose_as',
  'public',
])

/**
 * Known keys within 'needs' array items (when object form)
 */
const NEEDS_ITEM_KEYS = new Set(['job', 'artifacts', 'optional', 'project', 'ref', 'pipeline'])

/**
 * Known keys within 'cache' object
 */
const CACHE_KEYS = new Set([
  'key',
  'paths',
  'untracked',
  'when',
  'policy',
  'unprotect',
  'fallback_keys',
])

/**
 * Known keys within 'cache.key' object
 */
const CACHE_KEY_KEYS = new Set(['files', 'prefix'])

/**
 * Known keys within 'retry' object
 */
const RETRY_KEYS = new Set(['max', 'when', 'exit_codes'])

/**
 * Known keys within 'environment' object
 */
const ENVIRONMENT_KEYS = new Set([
  'name',
  'url',
  'on_stop',
  'action',
  'auto_stop_in',
  'kubernetes',
  'deployment_tier',
])

/**
 * Known keys within 'trigger' object
 */
const TRIGGER_KEYS = new Set(['project', 'branch', 'strategy', 'include', 'forward'])

/**
 * Known keys within 'workflow' object
 */
const WORKFLOW_KEYS = new Set(['rules', 'name', 'auto_cancel'])

/**
 * Known keys within 'default' object (same as job keys, but applies globally)
 */
const DEFAULT_KEYS = new Set([
  'image',
  'services',
  'before_script',
  'after_script',
  'tags',
  'cache',
  'artifacts',
  'retry',
  'timeout',
  'interruptible',
  'id_tokens',
])

/**
 * Known keys within 'changes' object (when using complex form)
 */
const CHANGES_KEYS = new Set(['paths', 'compare_to'])

/**
 * Check for unknown or unsupported keys in GitLab CI configuration.
 * This helps detect typos and keys that the linter doesn't evaluate.
 */
export function checkUnknownKeys(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const rawConfig = config.config

  // Check top-level keys
  for (const key of Object.keys(rawConfig)) {
    if (!GLOBAL_KEYWORDS.has(key) && !key.startsWith('.')) {
      // It's likely a job - check job-level keys
      const job = rawConfig[key]
      if (typeof job === 'object' && job !== null && !Array.isArray(job)) {
        checkJobKeys(key, job, issues)
      }
    } else if (key === 'default') {
      // Check default section keys
      const defaultSection = rawConfig[key]
      if (typeof defaultSection === 'object' && defaultSection !== null) {
        checkObjectKeys(defaultSection, DEFAULT_KEYS, 'default', issues)

        // Check nested objects in default
        if (defaultSection.cache) {
          checkCacheKeys(defaultSection.cache, 'default.cache', issues)
        }
        if (defaultSection.artifacts) {
          checkObjectKeys(defaultSection.artifacts, ARTIFACTS_KEYS, 'default.artifacts', issues)
        }
        if (defaultSection.retry && typeof defaultSection.retry === 'object') {
          checkObjectKeys(defaultSection.retry, RETRY_KEYS, 'default.retry', issues)
        }
      }
    } else if (key === 'workflow') {
      // Check workflow section keys
      const workflow = rawConfig[key]
      if (typeof workflow === 'object' && workflow !== null) {
        checkObjectKeys(workflow, WORKFLOW_KEYS, 'workflow', issues)

        // Check workflow.rules
        if (workflow.rules && Array.isArray(workflow.rules)) {
          workflow.rules.forEach((rule: any, index: number) => {
            if (typeof rule === 'object' && rule !== null) {
              checkObjectKeys(rule, RULES_ITEM_KEYS, `workflow.rules[${index}]`, issues)
              checkChangesObject(rule.changes, `workflow.rules[${index}].changes`, issues)
            }
          })
        }
      }
    }
  }

  return issues
}

/**
 * Check keys within a job definition
 */
function checkJobKeys(jobName: string, job: Record<string, any>, issues: LintIssue[]): void {
  checkObjectKeys(job, JOB_KEYS, jobName, issues)

  // Check nested objects
  if (job['rules'] && Array.isArray(job['rules'])) {
    job['rules'].forEach((rule: any, index: number) => {
      if (typeof rule === 'object' && rule !== null) {
        checkObjectKeys(rule, RULES_ITEM_KEYS, `${jobName}.rules[${index}]`, issues)
        checkChangesObject(rule.changes, `${jobName}.rules[${index}].changes`, issues)
      }
    })
  }

  if (job['only'] && typeof job['only'] === 'object' && !Array.isArray(job['only'])) {
    checkObjectKeys(job['only'], ONLY_EXCEPT_KEYS, `${jobName}.only`, issues)
    checkChangesObject(job['only'].changes, `${jobName}.only.changes`, issues)
  }

  if (job['except'] && typeof job['except'] === 'object' && !Array.isArray(job['except'])) {
    checkObjectKeys(job['except'], ONLY_EXCEPT_KEYS, `${jobName}.except`, issues)
    checkChangesObject(job['except'].changes, `${jobName}.except.changes`, issues)
  }

  if (job['artifacts'] && typeof job['artifacts'] === 'object') {
    checkObjectKeys(job['artifacts'], ARTIFACTS_KEYS, `${jobName}.artifacts`, issues)
  }

  if (job['needs'] && Array.isArray(job['needs'])) {
    job['needs'].forEach((need: any, index: number) => {
      if (typeof need === 'object' && need !== null) {
        checkObjectKeys(need, NEEDS_ITEM_KEYS, `${jobName}.needs[${index}]`, issues)
      }
    })
  }

  if (job['cache']) {
    checkCacheKeys(job['cache'], `${jobName}.cache`, issues)
  }

  if (job['retry'] && typeof job['retry'] === 'object') {
    checkObjectKeys(job['retry'], RETRY_KEYS, `${jobName}.retry`, issues)
  }

  if (job['environment'] && typeof job['environment'] === 'object') {
    checkObjectKeys(job['environment'], ENVIRONMENT_KEYS, `${jobName}.environment`, issues)
  }

  if (job['trigger'] && typeof job['trigger'] === 'object') {
    checkObjectKeys(job['trigger'], TRIGGER_KEYS, `${jobName}.trigger`, issues)
  }
}

/**
 * Check cache object keys (can be object or array of objects)
 */
function checkCacheKeys(cache: any, location: string, issues: LintIssue[]): void {
  if (Array.isArray(cache)) {
    cache.forEach((cacheItem: any, index: number) => {
      if (typeof cacheItem === 'object' && cacheItem !== null) {
        checkObjectKeys(cacheItem, CACHE_KEYS, `${location}[${index}]`, issues)
        if (cacheItem.key && typeof cacheItem.key === 'object') {
          checkObjectKeys(cacheItem.key, CACHE_KEY_KEYS, `${location}[${index}].key`, issues)
        }
      }
    })
  } else if (typeof cache === 'object' && cache !== null) {
    checkObjectKeys(cache, CACHE_KEYS, location, issues)
    if (cache.key && typeof cache.key === 'object') {
      checkObjectKeys(cache.key, CACHE_KEY_KEYS, `${location}.key`, issues)
    }
  }
}

/**
 * Check changes object (when using complex form with paths/compare_to)
 */
function checkChangesObject(changes: any, location: string, issues: LintIssue[]): void {
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    checkObjectKeys(changes, CHANGES_KEYS, location, issues)
  }
}

/**
 * Check if an object contains any unknown keys
 */
function checkObjectKeys(
  obj: Record<string, any>,
  knownKeys: Set<string>,
  location: string,
  issues: LintIssue[],
): void {
  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      issues.push({
        severity: 'warning',
        message: `Unknown key '${key}' in ${location}. This key may be unsupported or a typo.`,
        location,
      })
    }
  }
}
