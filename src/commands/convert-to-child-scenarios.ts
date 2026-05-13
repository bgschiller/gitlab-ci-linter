import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { type Command, Option } from 'commander'
import { addCommonOptions, readCommonOptions } from '../cli/commonOptions'
import { getBool, getString, getStringArray } from '../cli/opts'
import { parseCommaList } from '../cli/varsFile'
import { GitLabCILinter } from '../GitLabCILinter'
import { ScenarioConverter } from '../scenario-converter'

export function registerConvertToChildScenariosCommand(program: Command): Command {
  return addCommonOptions(
    program
      .command('convert-to-child-scenarios')
      .description("Convert scenarios into a parent pipeline's child-pipeline form")
      .argument('[source...]', 'Optional parent .gitlab-ci.yml for trigger-job validation')
      .requiredOption('--scenarios <path>', 'Scenarios file or directory to convert')
      .requiredOption('--trigger-job <name>', 'Name of the trigger job in the parent pipeline')
      .requiredOption('--child-path <path>', 'Child pipeline include path')
      .option('--branch-mapping <spec>', 'Branch-mapping spec, parsed by ScenarioConverter')
      .option(
        '--exclude-component-jobs <list>',
        'Comma-separated job names to exclude from the converted output',
        parseCommaList,
      )
      .option(
        '-o, --output <path>',
        'Output file (single scenario) or directory (one per scenario)',
      )
      .addOption(
        new Option('--format <fmt>', 'Output format').choices(['yaml', 'json']).default('yaml'),
      )
      .option('--include-root-counts', 'Include parent-level counts in converted scenarios')
      .option('--joined', 'Emit a single combined output file instead of one-per-scenario'),
  ).action(convertToChildScenariosAction)
}

async function convertToChildScenariosAction(
  source: string[],
  opts: Record<string, unknown>,
): Promise<void> {
  const common = readCommonOptions(opts)
  // Commander enforces these via requiredOption — guard with fallback to keep the type narrow.
  const scenariosPath = getString(opts, 'scenarios') ?? ''
  const triggerJob = getString(opts, 'triggerJob') ?? ''
  const childPath = getString(opts, 'childPath') ?? ''

  const childScenarios = ScenarioConverter.loadScenariosFromPath(scenariosPath)
  if (childScenarios.length === 0) {
    console.error(`Error: No scenarios found in ${scenariosPath}`)
    process.exit(2)
  }

  const parentConfig = await loadOptionalParentConfig(source, common.rootDir, common.gitlabHost)
  const outputFormat: 'json' | 'yaml' = opts['format'] === 'json' ? 'json' : 'yaml'
  const rawBranchMapping = getString(opts, 'branchMapping')

  const result = ScenarioConverter.convert(parentConfig, triggerJob, childScenarios, {
    childPath,
    branchMapping: rawBranchMapping
      ? ScenarioConverter.parseBranchMapping(rawBranchMapping)
      : undefined,
    format: outputFormat,
    excludeJobs: getStringArray(opts, 'excludeComponentJobs'),
    includeRootCounts: getBool(opts, 'includeRootCounts'),
  })

  writeConvertOutput(result, {
    outputFile: getString(opts, 'output'),
    outputFormat,
    joined: getBool(opts, 'joined'),
  })
}

async function loadOptionalParentConfig(
  source: string[],
  rootDir: string | undefined,
  gitlabHost: string | undefined,
): Promise<any> {
  const filePath = source[0]
  if (!filePath || !existsSync(filePath)) return null
  const resolvedFilePath = resolveGitlabCiFile(filePath)
  if (!resolvedFilePath) return null
  const content = readFileSync(resolvedFilePath, 'utf8')
  const tempLinter = new GitLabCILinter(content, resolve(resolvedFilePath), { rootDir, gitlabHost })
  return (tempLinter as { processor: { process(): unknown } }).processor.process()
}

export function resolveGitlabCiFile(filePath: string): string | undefined {
  if (!statSync(filePath).isDirectory()) return filePath
  const gitlabCiPath = join(filePath, '.gitlab-ci.yml')
  return existsSync(gitlabCiPath) ? gitlabCiPath : undefined
}

export function writeConvertOutput(
  result: { scenarios: any[]; metadata: any },
  opts: { outputFile?: string; outputFormat: 'json' | 'yaml'; joined: boolean },
): void {
  if (!opts.outputFile) {
    console.log(ScenarioConverter.formatOutput(result, opts.outputFormat))
    return
  }
  if (opts.joined) {
    writeFileSync(opts.outputFile, ScenarioConverter.formatOutput(result, opts.outputFormat))
    console.log(`Converted ${result.metadata.scenariosConverted} scenarios to: ${opts.outputFile}`)
    return
  }
  mkdirSync(opts.outputFile, { recursive: true })
  for (let i = 0; i < result.scenarios.length; i++) {
    const scenario = result.scenarios[i]
    const fileName = ScenarioConverter.formatScenarioFileName(scenario, i, opts.outputFormat)
    const content = ScenarioConverter.formatSingleScenario(scenario, opts.outputFormat)
    writeFileSync(join(opts.outputFile, fileName), content + '\n')
  }
  console.log(`Converted ${result.metadata.scenariosConverted} scenarios to: ${opts.outputFile}/`)
}
