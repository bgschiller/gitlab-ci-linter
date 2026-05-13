import { resolve } from 'path'
import { type Command, Option } from 'commander'

export type Severity = 'error' | 'warning' | 'info'

export interface CommonOptions {
  rootDir?: string
  gitlabHost?: string
  quiet: boolean
  color: boolean
  severity: Severity
}

/**
 * Attach the options every subcommand accepts: source-resolution flags
 * (`--root`, `--gitlab-host`), output-control flags (`--quiet`, `--no-color`),
 * and severity filter (`--error`/`--warning`/`--info`, mutually exclusive).
 *
 * The matching extractor is {@link readCommonOptions}; together they keep
 * the per-command actions free of shared-flag boilerplate.
 */
export function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('--root <path>', 'Root directory for resolving local includes')
    .option('--gitlab-host <host>', 'GitLab host (defaults to gitlab.com)')
    .option('-q, --quiet', 'Quiet mode: exit codes only')
    .option('--no-color', 'Disable colored output')
    .addOption(
      new Option('--error', 'Show only errors').conflicts(['warning', 'info']).default(false),
    )
    .addOption(
      new Option('--warning', 'Show warnings and errors')
        .conflicts(['error', 'info'])
        .default(false),
    )
    .addOption(
      new Option('--info', 'Show all issues (default)')
        .conflicts(['error', 'warning'])
        .default(false),
    )
}

/**
 * Pull the shared options off a Commander-parsed opts blob, applying the
 * documented defaults (severity=info, color=on, quiet=off) and resolving
 * `--root` to an absolute path.
 */
export function readCommonOptions(opts: Record<string, unknown>): CommonOptions {
  const root = opts['root']
  const host = opts['gitlabHost']
  return {
    rootDir: typeof root === 'string' ? resolve(root) : undefined,
    gitlabHost: typeof host === 'string' ? host : undefined,
    quiet: opts['quiet'] === true,
    color: opts['color'] !== false,
    severity: pickSeverity(opts),
  }
}

function pickSeverity(opts: Record<string, unknown>): Severity {
  if (opts['error']) return 'error'
  if (opts['warning']) return 'warning'
  return 'info'
}
