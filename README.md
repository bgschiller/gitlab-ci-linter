# gitlab-ci-linter

A linter for GitLab CI YAML files. Resolves `include`, `extends`, variables, and `!reference` tags to simulate how GitLab interprets the configuration, then checks for common issues (manual jobs that stall pipelines, circular dependencies, conflicting rules, missing artifact paths, insecure patterns, and more).

See [docs/USAGE.md](./docs/USAGE.md) for command reference.

## Install

```bash
npm install -g gitlab-ci-linter
```

Or run directly with `npx`:

```bash
npx gitlab-ci-linter .gitlab-ci.yml
```

## Usage

```bash
gitlab-ci-linter .gitlab-ci.yml            # lint (default)
gitlab-ci-linter flatten .gitlab-ci.yml    # show fully resolved config
gitlab-ci-linter --error .gitlab-ci.yml    # only error-level issues
gitlab-ci-linter --quiet .gitlab-ci.yml    # CI mode: exit codes only
```

Exit codes: `0` clean, `1` warnings, `2` errors.

## Development

```bash
pnpm install
pnpm build              # bundle to dist/index.js
pnpm test               # run vitest
pnpm dev .gitlab-ci.yml # run from source via tsx
```

The build is a single esbuild step (`build.mjs`) that bundles `src/index.ts` into `dist/index.js` as an ESM Node binary with `dependencies` externalized.

## License

MIT
