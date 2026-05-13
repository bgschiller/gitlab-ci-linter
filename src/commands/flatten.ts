import { type Command } from 'commander'
import { addCommonOptions, readCommonOptions } from '../cli/commonOptions'
import { getString } from '../cli/opts'
import { buildLinter, resolveSource } from '../cli/source'

export function registerFlattenCommand(program: Command): Command {
  return addCommonOptions(
    program
      .command('flatten')
      .description('Show the fully resolved, flattened GitLab CI configuration')
      .argument('[source...]', 'Path to .gitlab-ci.yml, or GitLab URL, or "<project> <ref>"')
      .option('--job <name>', 'Flatten a single job by name'),
  ).action(flattenAction)
}

async function flattenAction(source: string[], opts: Record<string, unknown>): Promise<void> {
  const common = readCommonOptions(opts)
  const linter = buildLinter(resolveSource(source), {
    rootDir: common.rootDir,
    gitlabHost: common.gitlabHost,
  })
  console.log(await linter.flatten(getString(opts, 'job')))
}
