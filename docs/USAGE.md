# GitLab CI Linter - Usage Guide

Comprehensive guide to using gitlab-ci-linter for validating, analyzing, and testing GitLab CI configurations.

## Table of Contents

- [Quick Start](#quick-start)
- [Commands](#commands)
  - [lint](#lint-command) - Check for configuration issues
  - [flatten](#flatten-command) - Show processed configuration
  - [evaluate](#evaluate-command) - Determine which jobs run
  - [test](#test-command) - Run assertions against scenarios
  - [generate-scenarios](#generate-scenarios-command) - Auto-generate test scenarios
  - [convert-to-child-scenarios](#convert-to-child-scenarios-command) - Convert child CI scenarios to parent format
- [Input Sources](#input-sources)
- [Common Workflows](#common-workflows)
- [Exit Codes](#exit-codes)

---

## Quick Start

```bash
# Build the tool
npx nx build gitlab-ci-linter

# Basic linting
./dist/index.js .gitlab-ci.yml

# See which jobs run for a given context
./dist/index.js evaluate --var CI_COMMIT_BRANCH=main .gitlab-ci.yml

# Generate test scenarios automatically
./dist/index.js generate-scenarios .gitlab-ci.yml
```

---

## Commands

### lint Command

**Purpose**: Check GitLab CI configuration for common issues, best practices violations, and potential errors.

```bash
gitlab-ci-linter [lint] [options] <file>
```

The `lint` command is the default when no command is specified.

#### Options

| Option                 | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `--error`              | Show only error-level issues                                         |
| `--warning`            | Show only warning and error-level issues                             |
| `--info`               | Show all issues including info (default)                             |
| `--children`           | Include child pipelines in linting (lints all `trigger.include.local`) |
| `--quiet, -q`          | Quiet mode - only return exit code                                   |
| `--no-color`           | Disable colored output                                               |
| `--root <path>`        | Set root directory for resolving local includes                      |
| `--gitlab-host <host>` | GitLab host for component resolution                                 |

#### Examples

```bash
# Basic linting (default command)
gitlab-ci-linter .gitlab-ci.yml

# Show only errors (ignore warnings/info)
gitlab-ci-linter --error .gitlab-ci.yml

# Lint including all child pipelines
gitlab-ci-linter lint --children .gitlab-ci.yml

# Quiet mode for CI/CD pipelines
gitlab-ci-linter --quiet .gitlab-ci.yml && echo "No issues!"

# Lint with custom root for subproject CI files
gitlab-ci-linter --root /path/to/repo subdir/.gitlab-ci.yml
```

#### What It Checks

- Manual jobs without `allow_failure: true`
- Jobs referencing undeclared stages
- Circular dependencies in `needs`/`dependencies`
- Invalid artifact paths and expiration formats
- Conflicting rule conditions
- Security issues (exposed secrets, insecure commands)
- Invalid `needs` references to non-existent jobs
- Kubernetes resource limit formats

---

### flatten Command

**Purpose**: Show the fully processed GitLab CI configuration after resolving includes, extends, variables, and references.

```bash
gitlab-ci-linter flatten [options] <file>
```

#### Options

| Option                 | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `--job <name>`         | Output only the specified job's configuration   |
| `--root <path>`        | Set root directory for resolving local includes |
| `--gitlab-host <host>` | GitLab host for component resolution            |

#### Examples

```bash
# Show full flattened configuration
gitlab-ci-linter flatten .gitlab-ci.yml

# Show only a specific job's resolved config
gitlab-ci-linter flatten --job deploy-production .gitlab-ci.yml

# Save flattened config to file
gitlab-ci-linter flatten .gitlab-ci.yml > flattened.yml
```

#### Use Cases

- **Debug include resolution**: See what configuration is actually loaded from includes
- **Verify extends inheritance**: Confirm job templates are merged correctly
- **Check variable expansion**: See resolved variable values
- **Understand `!reference` resolution**: View what values are pulled in

---

### evaluate Command

**Purpose**: Determine which jobs will run given a specific pipeline context (variables, changed files).

```bash
gitlab-ci-linter evaluate [options] <file>
```

#### Options

| Option               | Description                                |
| -------------------- | ------------------------------------------ |
| `--var KEY=VALUE`    | Set environment variable (can be repeated) |
| `--vars-file <path>` | Load variables from JSON or YAML file      |
| `--changes <files>`  | Comma-separated list of changed files      |
| `--json`             | Output detailed JSON instead of job list   |
| `--html [file]`      | Generate interactive HTML visualization    |
| `--show-skipped`     | Include skipped jobs in output             |

#### Examples

```bash
# Evaluate for main branch push
gitlab-ci-linter evaluate \
  --var CI_COMMIT_BRANCH=main \
  --var CI_PIPELINE_SOURCE=push \
  .gitlab-ci.yml

# Evaluate with changed files
gitlab-ci-linter evaluate \
  --var CI_COMMIT_BRANCH=feature/test \
  --changes "src/app.ts,package.json" \
  .gitlab-ci.yml

# Load context from file
gitlab-ci-linter evaluate --vars-file context.yaml .gitlab-ci.yml

# Generate HTML pipeline visualization
gitlab-ci-linter evaluate \
  --var CI_COMMIT_BRANCH=main \
  --html pipeline.html \
  .gitlab-ci.yml

# JSON output for programmatic use
gitlab-ci-linter evaluate --json --show-skipped \
  --var CI_COMMIT_BRANCH=main \
  .gitlab-ci.yml
```

#### Vars File Format

```yaml
# context.yaml
variables:
  CI_COMMIT_BRANCH: main
  CI_PIPELINE_SOURCE: push
  CI_DEFAULT_BRANCH: main
changes:
  - src/app.ts
  - package.json
```

---

### test Command

**Purpose**: Run assertions against job evaluation results to verify expected pipeline behavior.

```bash
gitlab-ci-linter test [options] <file>
```

#### Options

| Option               | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| `--vars-file <path>` | Test scenario file with variables and assertions (required) |
| `--json`             | Output detailed JSON results                                |
| `--quiet, -q`        | Quiet mode - only return exit code                          |

#### Examples

```bash
# Run test scenario
gitlab-ci-linter test --vars-file scenario.yaml .gitlab-ci.yml

# JSON output for CI integration
gitlab-ci-linter test --vars-file scenario.yaml --json .gitlab-ci.yml

# Quiet mode (exit code only)
gitlab-ci-linter test --vars-file scenario.yaml --quiet .gitlab-ci.yml
```

#### Test Scenario Format

```yaml
# scenario.yaml
description: 'Main branch push - production deployment'
variables:
  CI_COMMIT_BRANCH: main
  CI_PIPELINE_SOURCE: push
  CI_DEFAULT_BRANCH: main
changes:
  - src/app.ts
assertions:
  jobs:
    build-job: automatic # Job runs automatically
    deploy-staging: manual # Job requires manual trigger
    deploy-production: skipped # Job won't run
  counts:
    automatic: 5
    manual: 2
    skipped: 3
```

#### Job Status Values

| Status      | Description                                                           |
| ----------- | --------------------------------------------------------------------- |
| `automatic` | Job runs automatically (`when: on_success/always/on_failure/delayed`) |
| `manual`    | Job requires manual trigger (`when: manual`)                          |
| `skipped`   | Job won't run (rules don't match)                                     |

---

### generate-scenarios Command

**Purpose**: Automatically generate test scenarios by analyzing job rules and conditions.

```bash
gitlab-ci-linter generate-scenarios [options] <file>
```

#### Options

| Option                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `--output, -o <file>`   | Write scenarios to file instead of stdout     |
| `--format <json\|yaml>` | Output format (default: yaml)                 |
| `--max-scenarios <n>`   | Maximum scenarios to generate (default: 25)   |
| `--jobs <job1,job2>`    | Focus on specific jobs (comma-separated)      |
| `--no-assertions`       | Exclude assertions from output                |
| `--min-coverage`        | Generate minimal set covering unique outcomes |

#### Examples

```bash
# Generate scenarios to stdout
gitlab-ci-linter generate-scenarios .gitlab-ci.yml

# Write to file with JSON format
gitlab-ci-linter generate-scenarios \
  --output scenarios.json \
  --format json \
  .gitlab-ci.yml

# Focus on specific jobs
gitlab-ci-linter generate-scenarios \
  --jobs build,deploy-staging,deploy-production \
  --max-scenarios 10 \
  .gitlab-ci.yml

# Minimal coverage (unique outcomes only)
gitlab-ci-linter generate-scenarios --min-coverage .gitlab-ci.yml

# Generate without assertions (just variable combinations)
gitlab-ci-linter generate-scenarios --no-assertions .gitlab-ci.yml
```

#### Output Format

```yaml
description: 'Main branch push (production deployment)'
variables:
  CI_COMMIT_BRANCH: main
  CI_PIPELINE_SOURCE: push
  CI_DEFAULT_BRANCH: main
assertions:
  jobs:
    build-job: automatic
    deploy-staging: manual
    deploy-production: skipped
  counts:
    automatic: 1
    manual: 1
    skipped: 1
---
description: 'Feature branch push'
variables:
  CI_COMMIT_BRANCH: feature/test
  CI_PIPELINE_SOURCE: push
  CI_DEFAULT_BRANCH: main
assertions:
  jobs:
    build-job: automatic
    deploy-staging: skipped
    deploy-production: skipped
```

---

### convert-to-child-scenarios Command

**Purpose**: Convert standalone child pipeline test scenarios into parent pipeline scenarios with nested `childPipelines` assertions.

This is useful when migrating test scenarios from a child repository (testing the child CI directly) to a parent monorepo structure (testing via a trigger job).

```bash
gitlab-ci-linter convert-to-child-scenarios [options] [parent-ci-file]
```

#### Options

| Option                            | Description                                                         |
| --------------------------------- | ------------------------------------------------------------------- |
| `--scenarios <path>`              | Directory or file containing child CI test scenarios (required)     |
| `--trigger-job <name>`            | Name of the trigger job in parent CI (required)                     |
| `--child-path <path>`             | Path prefix to add to changes (e.g., "apps/extension/") (required) |
| `--output, -o <path>`             | Write scenarios to directory (one file per scenario) or stdout      |
| `--joined`                        | Write all scenarios to a single file (requires `--output`)          |
| `--format <json\|yaml>`           | Output format (default: yaml)                                       |
| `--branch-mapping <map>`          | Branch name mapping (e.g., "master:main,develop:dev")               |
| `--exclude-component-jobs <jobs>` | Comma-separated job names to exclude from root-level assertions     |
| `--include-root-counts`           | Include root-level counts in assertions (omitted by default)        |

#### Examples

```bash
# Basic conversion (writes one file per scenario to a directory)
gitlab-ci-linter convert-to-child-scenarios \
  --scenarios /path/to/extension/.ci/test-scenarios \
  --trigger-job trigger-extension \
  --child-path "apps/extension/" \
  --output ./converted-scenarios/ \
  .gitlab-ci.yml

# With branch mapping and joined output (single file)
gitlab-ci-linter convert-to-child-scenarios \
  --scenarios child-scenarios.yaml \
  --trigger-job trigger-child \
  --child-path "packages/child/" \
  --branch-mapping "master:main,develop:development" \
  --output converted.yaml --joined \
  .gitlab-ci.yml

# Exclude unresolvable component jobs from root assertions
gitlab-ci-linter convert-to-child-scenarios \
  --scenarios .ci/ci-scenarios/myservice/ \
  --trigger-job trigger-myservice \
  --child-path "apps/myservice/" \
  --exclude-component-jobs ci-scenario-tests \
  --output .ci/ci-scenarios/myservice/ \
  .gitlab-ci.yml

# Without validating against parent CI
gitlab-ci-linter convert-to-child-scenarios \
  --scenarios scenarios/ \
  --trigger-job trigger-app \
  --child-path "apps/web/"
```

#### Automatic Variable Injection

For merge request scenarios (`CI_PIPELINE_SOURCE: merge_request_event`), the converter automatically adds `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` if missing, deriving it from `CI_DEFAULT_BRANCH`. This ensures root CI workflows that set `TARGET_CONTEXT` from this variable work correctly in child pipelines.

#### Root-Level Counts

Root-level `counts` assertions are **omitted by default** because they're fragile when the root CI includes components that can't be locally evaluated (e.g., `ci-scenario-tests`). Use `--include-root-counts` to opt-in if you want strict count checking at the root level.

#### Input/Output Transformation

**Input** (child pipeline scenario testing `apps/extension/.gitlab-ci.yml` directly):

```yaml
description: 'Merge request to master branch'
variables:
  CI_PIPELINE_SOURCE: merge_request_event
  CI_COMMIT_BRANCH: feature/test-branch
  CI_MERGE_REQUEST_TARGET_BRANCH_NAME: master
changes:
  - src/js/features/assistant/index.ts
  - package.json
assertions:
  jobs:
    build-chrome: automatic
    lint: automatic
    test-unit-chromium-bg-shared: automatic
  counts:
    automatic: 3
    total: 3
```

**Output** (parent pipeline scenario testing via trigger job):

```yaml
description: 'Merge request to master branch'
variables:
  CI_PIPELINE_SOURCE: merge_request_event
  CI_COMMIT_BRANCH: feature/test-branch
  CI_MERGE_REQUEST_TARGET_BRANCH_NAME: main # master → main via branch-mapping
changes:
  - apps/extension/src/js/features/assistant/index.ts # prefixed with child-path
  - apps/extension/package.json
assertions:
  jobs:
    trigger-extension: automatic # parent trigger job
  # root-level counts omitted by default (use --include-root-counts to add)
  childPipelines:
    trigger-extension:
      jobs:
        build-chrome: automatic
        lint: automatic
        test-unit-chromium-bg-shared: automatic
      counts:
        automatic: 3
        total: 3
```

#### Use Cases

- **Monorepo migration**: When moving a standalone repository into a monorepo with trigger jobs
- **Test scenario reuse**: Convert existing test scenarios without rewriting them
- **CI structure changes**: When refactoring from direct CI to triggered child pipelines

---

## Input Sources

gitlab-ci-linter supports multiple input sources:

### Local Files

```bash
gitlab-ci-linter .gitlab-ci.yml
gitlab-ci-linter path/to/ci-config.yml
gitlab-ci-linter /absolute/path/.gitlab-ci.yml
```

### Directories

```bash
# Automatically looks for .gitlab-ci.yml in directory
gitlab-ci-linter path/to/project/
```

### GitLab URLs

```bash
# Commit URL (gitlab.com)
gitlab-ci-linter https://gitlab.com/acme/widgets/-/commit/abc123

# File URL (self-hosted GitLab)
gitlab-ci-linter https://gitlab.example.com/acme/widgets/-/blob/main/.gitlab-ci.yml

# Tree URL
gitlab-ci-linter https://gitlab.example.com/acme/widgets/-/tree/main
```

### Project and Ref

```bash
gitlab-ci-linter <project-path> <ref>

# Examples
gitlab-ci-linter acme/my-project main
gitlab-ci-linter acme/my-project abc123def456
gitlab-ci-linter acme/my-project feature/my-branch
```

---

## Common Workflows

### Workflow 1: Pre-commit Validation

Validate CI configuration before committing changes:

```bash
# Quick lint check
gitlab-ci-linter --error .gitlab-ci.yml

# Verify the configuration flattens correctly
gitlab-ci-linter flatten .gitlab-ci.yml > /dev/null
```

### Workflow 2: Test-Driven CI Development

Create and verify CI behavior with automated tests:

```bash
# 1. Generate test scenarios from current config
gitlab-ci-linter generate-scenarios \
  --output tests/ci-scenarios.yaml \
  .gitlab-ci.yml

# 2. Review and adjust assertions as needed
# (edit tests/ci-scenarios.yaml)

# 3. Run tests to verify behavior
gitlab-ci-linter test --vars-file tests/ci-scenarios.yaml .gitlab-ci.yml

# 4. After CI changes, re-run tests to catch regressions
gitlab-ci-linter test --vars-file tests/ci-scenarios.yaml .gitlab-ci.yml
```

### Workflow 3: Debugging Pipeline Behavior

Understand why jobs run or don't run:

```bash
# 1. Evaluate with your specific context
gitlab-ci-linter evaluate \
  --var CI_COMMIT_BRANCH=feature/my-branch \
  --var CI_PIPELINE_SOURCE=push \
  --show-skipped \
  .gitlab-ci.yml

# 2. Generate HTML visualization for complex pipelines
gitlab-ci-linter evaluate \
  --var CI_COMMIT_BRANCH=main \
  --html pipeline.html \
  .gitlab-ci.yml
open pipeline.html

# 3. Check a specific job's resolved configuration
gitlab-ci-linter flatten --job deploy-production .gitlab-ci.yml
```

### Workflow 4: CI/CD Integration

Add to your CI pipeline for automated validation:

```yaml
# .gitlab-ci.yml
lint-ci-config:
  stage: validate
  script:
    - gitlab-ci-linter --error .gitlab-ci.yml
  rules:
    - changes:
        - .gitlab-ci.yml
        - gitlab-ci/**/*

test-ci-scenarios:
  stage: validate
  script:
    - gitlab-ci-linter test --vars-file tests/ci-scenarios.yaml .gitlab-ci.yml
  rules:
    - changes:
        - .gitlab-ci.yml
        - gitlab-ci/**/*
        - tests/ci-scenarios.yaml
```

### Workflow 5: Coverage Analysis

Ensure test scenarios cover all important paths:

```bash
# Generate minimal coverage scenarios
gitlab-ci-linter generate-scenarios \
  --min-coverage \
  --output coverage-scenarios.yaml \
  .gitlab-ci.yml

# Check metadata for coverage info
gitlab-ci-linter generate-scenarios \
  --min-coverage \
  -o /dev/null \
  .gitlab-ci.yml
# Output: Generated X scenarios ... Unique outcomes: Y
```

### Workflow 6: Comparing Branches

Compare CI behavior between branches:

```bash
# Evaluate main branch
gitlab-ci-linter evaluate --json \
  --var CI_COMMIT_BRANCH=main \
  acme/my-project main > main-jobs.json

# Evaluate feature branch
gitlab-ci-linter evaluate --json \
  --var CI_COMMIT_BRANCH=feature/test \
  acme/my-project feature/test > feature-jobs.json

# Compare (using jq or diff)
diff main-jobs.json feature-jobs.json
```

---

## Exit Codes

### lint Command

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 0    | No issues found (or only info-level) |
| 1    | Warning-level issues found           |
| 2    | Error-level issues found             |

### test Command

| Code | Meaning                                        |
| ---- | ---------------------------------------------- |
| 0    | All assertions passed                          |
| 1    | One or more assertions failed                  |
| 2    | Error (invalid file, missing assertions, etc.) |

### Other Commands

| Code | Meaning |
| ---- | ------- |
| 0    | Success |
| 1    | Error   |

---

## Tips and Best Practices

1. **Start with `generate-scenarios`**: Let the tool analyze your CI config and create initial test scenarios, then refine them.

2. **Use `--min-coverage`**: When generating scenarios, this ensures you test all unique job outcome combinations without redundancy.

3. **Test critical paths**: Always have test scenarios for:

   - Main branch pushes
   - Feature branch pushes
   - Merge request events
   - Scheduled pipelines
   - Manual triggers

4. **Integrate early**: Add linting to your CI pipeline to catch issues before they affect production.

5. **Use HTML visualization**: For complex pipelines, the `--html` output makes it easy to understand job relationships and flow.

6. **Version your test scenarios**: Keep `ci-scenarios.yaml` in version control alongside your `.gitlab-ci.yml`.
