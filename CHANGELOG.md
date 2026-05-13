# gitlab-ci-linter

## 2.5.0

Initial open-source release.

`gitlab-ci-linter` resolves GitLab CI YAML files — including `include`, `extends`,
variables, and `!reference` tags — and reports common configuration issues:
manual jobs that stall pipelines, circular dependencies, conflicting rules,
missing artifact paths, dependency mismatches across `changes:` filters,
Kubernetes resource problems, and basic security smells.

The tool ships as a single `gitlab-ci-linter` Node binary. See
[docs/USAGE.md](./docs/USAGE.md) for the full command reference.
