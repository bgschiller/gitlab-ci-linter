# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GitLab CI Linter is a TypeScript-based CLI tool that analyzes GitLab CI YAML files to detect configuration issues and provide a flattened view of the processed configuration. It resolves includes, extends, variables, and references to simulate how GitLab would interpret the CI file.

> **For CLI usage documentation**, see [USAGE.md](./docs/USAGE.md) - comprehensive guide to commands, options, and workflows.

## Development Commands

### Build and Test

- `pnpm build` - Compile TypeScript to JavaScript in `dist/` directory
- `pnpm test` - Run all tests with Vitest
- `pnpm dev [file]` - Run development version directly with tsx

### Running the CLI

- `./dist/index.js [file]` - Run built version (requires `pnpm build` first)
- `pnpm dev [file]` - Run development version directly
- `./dist/index.js [file]` - Run built version explicitly

### CLI Options and Commands

- `./dist/index.js lint [file]` - Default: Check for common issues
- `./dist/index.js flatten [file]` - Show flattened GitLab CI configuration
- `--error` - Show only error-level issues
- `--warning` - Show only warning and error-level issues
- `--info` - Show all issues (default)
- `--quiet, -q` - Quiet mode for CI/CD integration (exit codes only)
- `--no-color` - Disable colored output

### Example Usage

```bash
# Basic linting
pnpm build && ./dist/index.js example.gitlab-ci.yml

# Show only errors
./dist/index.js --error .gitlab-ci.yml

# Flatten configuration to see processed result
./dist/index.js flatten .gitlab-ci.yml

# Run in quiet mode for CI/CD (returns exit codes: 0=clean, 1=warnings, 2=errors)
./dist/index.js --quiet .gitlab-ci.yml
```

## Architecture

The GitLab CI Linter uses a hybrid architecture combining classes for stateful operations and functions for pure transformations/validations.

### Core Components

#### Entry Point & Types

- **`src/index.ts`**: CLI entry point with argument parsing and command routing
- **`src/types.ts`**: TypeScript interfaces for GitLab CI structures

#### Main API Classes

- **`src/GitLabCILinter.ts`**: Public API class - thin wrapper orchestrating processing and linting
- **`src/ProcessedConfig.ts`**: Processed configuration with helper methods for rule access
- **`src/Linter.ts`**: Orchestrates all lint rules and manages rule execution

#### Processing Pipeline (`src/processors/`)

- **`ConfigProcessor.ts`**: Class that orchestrates the entire processing pipeline
- **`IncludeResolver.ts`**: Class for stateful include resolution (local files, GitLab API, templates)
- **`expandVariables.ts`**: Pure function for variable expansion (`$VAR` and `${VAR}` patterns)
- **`resolveExtends.ts`**: Pure function for merging job templates with extending jobs
- **`resolveReferences.ts`**: Pure function for handling `!reference` YAML tags

#### Lint Rules (`src/rules/`)

- **`checkManualJobs.ts`**: Validates manual jobs have `allow_failure: true`
- **`checkJobStageAssignments.ts`**: Validates jobs reference declared stages
- **`checkCircularDependencies.ts`**: Detects dependency cycles using DFS algorithm
- **`checkDependencyRules.ts`**: Complex dependency rule validation and simulation
- **`checkArtifactPaths.ts`**: Validates artifact paths, expiration, and patterns
- **`checkConflictingRules.ts`**: Detects contradictory conditions and problematic rule patterns
- **`checkMissingDependencies.ts`**: Suggests missing dependencies based on usage patterns
- **`checkConditionalDependencies.ts`**: Validates conditional dependency rules
- **`checkKubernetesResources.ts`**: Validates k8s resource limits and formats
- **`checkSecurityIssues.ts`**: Detects security issues and insecure patterns

### Key Processing Pipeline

The processing follows a clear pipeline orchestrated by `ConfigProcessor`:

1. **Parse YAML** - Load and parse the GitLab CI file
2. **Resolve Includes** - `IncludeResolver` loads local files, GitLab API references, and templates
3. **Expand Variables** - `expandVariables()` replaces `$VAR` and `${VAR}` patterns throughout config
4. **Resolve Extends** - `resolveExtends()` merges job templates with extending jobs
5. **Resolve References** - `resolveReferences()` handles `!reference` YAML tags
6. **Create ProcessedConfig** - Wrap processed configuration with helper methods
7. **Apply Lint Rules** - `Linter` executes all lint rules against the processed configuration

### External Dependencies

- **GitLab CLI (`glab`)**: Used for API calls to fetch remote includes and templates
- **`curl`**: Used as fallback for fetching remote files
- **File system access**: For resolving local includes

### Lint Rules Implemented

The linter includes comprehensive rule validation with severity levels (error/warning/info). Each rule is implemented as a pure function in `src/rules/`:

1. **Manual jobs validation** (`checkManualJobs.ts`) - Detects jobs that could stall pipelines without `allow_failure: true`
2. **Job stage validation** (`checkJobStageAssignments.ts`) - Validates jobs use declared stages or default GitLab stages
3. **Circular dependency detection** (`checkCircularDependencies.ts`) - Detects dependency cycles using DFS algorithm
4. **Dependency rule validation** (`checkDependencyRules.ts`) - Complex analysis of job dependency rules and execution scenarios
5. **Artifact validation** (`checkArtifactPaths.ts`) - Checks expire_in formats, paths, and overly broad collection patterns
6. **Conflicting rules detection** (`checkConflictingRules.ts`) - Detects contradictory conditions and problematic rule patterns
7. **Missing dependencies analysis** (`checkMissingDependencies.ts`) - Suggests dependencies based on artifact usage and naming patterns
8. **Conditional dependencies validation** (`checkConditionalDependencies.ts`) - Validates change-based dependency patterns
9. **Kubernetes resource validation** (`checkKubernetesResources.ts`) - Validates resource limits and formats for k8s runners
10. **Security issues detection** (`checkSecurityIssues.ts`) - Identifies secrets in logs, insecure commands, hardcoded credentials
11. **Invalid needs detection** (`checkInvalidNeeds.ts`) - Detects `needs` or `dependencies` referencing non-existent jobs

## Testing Strategy

Tests use Vitest with a comprehensive suite covering both individual components and integration scenarios:

### Unit Tests

- **Processing functions**: Each processor function (`expandVariables`, `resolveExtends`, `resolveReferences`) has dedicated tests
- **Processing classes**: `IncludeResolver`, `ConfigProcessor`, and `ProcessedConfig` are thoroughly tested
- **Lint rules**: Each rule in `src/rules/` has comprehensive test coverage with edge cases
- **Integration**: `GitLabCILinter` and `Linter` classes are tested end-to-end

### Test Structure

- All test files use inline YAML strings to create controlled test scenarios
- Tests cover complex real-world scenarios (preprod/prod dependencies, circular includes)
- Each rule is tested in isolation with focused inputs and expected outputs
- Processing pipeline is tested step-by-step and as a whole

### Coverage Areas

- Variable expansion in various contexts (nested objects, arrays, conditional structures)
- Extends resolution (single, multiple, chained inheritance)
- Include resolution (local files, GitLab API, templates, circular dependency protection)
- All lint rule scenarios with edge cases and false positive prevention
- YAML flattening and configuration processing accuracy

## Configuration

- **TypeScript**: Targets ES2022 with CommonJS modules, outputs to `dist/` with source maps and declarations
- **Vitest**: Node environment with globals enabled for testing
- **Dependencies**: Only `yaml` for parsing, minimal external dependencies
- **CLI**: Shebang-enabled executable in `bin/gitlab-lint` after build

## Development Notes

### When Adding New Lint Rules

1. **Create the rule function** in `src/rules/checkNewRule.ts`:

   - Pure function taking `ProcessedConfig` and returning `LintIssue[]`
   - Include appropriate severity level (error/warning/info)
   - Add comprehensive JSDoc documentation

2. **Add comprehensive tests** in `src/rules/checkNewRule.test.ts`:

   - Use inline YAML strings to create controlled test scenarios
   - Cover edge cases and false positive scenarios
   - Test all severity levels and message variations

3. **Register the rule** in `src/Linter.ts`:

   - Import the new rule function
   - Add it to the rules array in the `lint()` method

4. **Update documentation**:
   - Add the rule to the list in this CLAUDE.md file
   - Include a brief description of what it detects

### Key Architecture Patterns

#### Separation of Concerns

- **Pure functions** for transformations (`expandVariables`, `resolveExtends`, `resolveReferences`)
- **Classes for state** (`IncludeResolver`, `ConfigProcessor`, `ProcessedConfig`)
- **Composition over inheritance** throughout the codebase

#### Processing Patterns

- **Pipeline processing** with clear stages in `ConfigProcessor`
- **Circular dependency protection** in include resolution
- **Custom YAML tag handling** for `!reference` tags
- **Nested object traversal** for variable expansion
- **DFS algorithm** for dependency cycle detection in rules

#### Rule Design

- **Pure functions** taking `ProcessedConfig` and returning `LintIssue[]`
- **Conservative filtering** to minimize false positives
- **Severity levels** (error/warning/info) for appropriate issue classification
- **Detailed messages** with suggestions for resolution

### Testing Large Real-World Files

Run the built binary against a large, real-world `.gitlab-ci.yml` to validate that new rules don't introduce excessive false positives on complex configurations:

```bash
pnpm build && ./dist/index.js path/to/large/.gitlab-ci.yml
```
