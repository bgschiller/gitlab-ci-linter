# Bug: `dependency-rules` rule crashes on object-form `changes:`

## Summary

The `checkDependencyRules` rule crashes with `TypeError: changes.some is not a function`
when a job rule uses the object form of `changes:` (with `paths` and `compare_to` keys)
instead of the simple array form.

## Reproduction

Any `.gitlab-ci.yml` that uses the object form of `changes:` will trigger the crash:

```yaml
job_a:
  script: echo "hello"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        compare_to: refs/heads/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME
        paths:
          - libs/**/*
          - tools/**/*
      when: on_success
```

Running the linter produces:

```
Rule 'dependency-rules' failed: TypeError: changes.some is not a function
```

## Root Cause

In `src/rules/checkDependencyRules.ts`, the `evaluateChanges` function (line 264)
assumes `changes` is always an array:

```typescript
function evaluateChanges(changes: (string | any)[], context: PipelineContext): boolean {
  // ...
  return changes.some(pattern => {   // ← crashes when changes is an object
```

But GitLab CI allows two forms for `changes:`, as defined in `src/types.ts` line 45:

```typescript
changes?: (string | any)[] | GitLabChangesObject
```

The array form:
```yaml
changes:
  - libs/**/*
  - tools/**/*
```

The object form (used for MR pipelines with `compare_to`):
```yaml
changes:
  compare_to: refs/heads/main
  paths:
    - libs/**/*
    - tools/**/*
```

The `evaluateChanges` function only handles the array form. When it receives a
`GitLabChangesObject`, calling `.some()` on it fails because objects don't have
that method.

## Correct Implementation Already Exists

The `modernRuleEvaluator.ts` in `src/rule-evaluation/` already handles both forms
correctly via `extractChangesPatterns`:

```typescript
function extractChangesPatterns(changes: GitLabRule['changes']): string[] {
  if (!changes) return []
  if (Array.isArray(changes)) {
    return changes.filter((p): p is string => typeof p === 'string')
  }
  if (typeof changes === 'object' && 'paths' in changes && Array.isArray(changes.paths)) {
    return changes.paths.filter((p): p is string => typeof p === 'string')
  }
  return []
}
```

The same pattern should be applied in `checkDependencyRules.ts`.

## Affected Functions

Two functions in `checkDependencyRules.ts` need the fix:

1. **`evaluateChanges`** (line 264) — called from `evaluateRule` (line 190)
2. **`extractChangePatterns`** (line 494) — called from `analyzeRuleDifferences` (line 427)

Both assume `changes` is an array. `extractChangePatterns` explicitly checks
`Array.isArray(rule.changes)` so it silently skips object-form changes rather than
crashing, but it still fails to extract the patterns for analysis.

## Impact

Because this rule crashes, the linter cannot detect dependency conflicts caused by
mismatched `changes:` filters between jobs with `needs:` relationships. This is
exactly the class of bug that has caused real pipeline failures in the wild,
where `packages_publish_reupload` had a `changes:` filter that
`packages_publish` did not.

## Suggested Fix

Extract the pattern-normalization logic into a shared helper (or reuse
`extractChangesPatterns` from `modernRuleEvaluator.ts`) and apply it in both
`evaluateChanges` and `extractChangePatterns` within `checkDependencyRules.ts`.
