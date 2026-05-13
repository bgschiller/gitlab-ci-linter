import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { type Command, Option } from 'commander'
import { addCommonOptions, readCommonOptions } from '../cli/commonOptions'
import { getBool, getNumber, getString, getStringArray, getStringRecord } from '../cli/opts'
import { buildLinter, resolveSource } from '../cli/source'
import { collectVar, parseCommaList } from '../cli/varsFile'
import { type ScenarioGenerationResult, TestScenarioGenerator } from '../scenario-generator'

export function registerGenerateScenariosCommand(program: Command): Command {
  return addCommonOptions(
    program
      .command('generate-scenarios')
      .description('Generate a coverage-minimized scenario matrix for the pipeline')
      .argument('[source...]', 'Path to .gitlab-ci.yml, or GitLab URL, or "<project> <ref>"')
      .option(
        '-o, --output <path>',
        'Output file (single scenario) or directory (one per scenario)',
      )
      .addOption(
        new Option('--format <fmt>', 'Output format').choices(['yaml', 'json']).default('yaml'),
      )
      .option(
        '--max-scenarios <n>',
        'Cap the number of scenarios emitted (default: no cap)',
        (raw: string): number => {
          const n = parseInt(raw, 10)
          return !isNaN(n) && n > 0 ? n : Number.POSITIVE_INFINITY
        },
      )
      .option('--jobs <list>', 'Comma-separated job names to target', parseCommaList)
      .option('--var <key=value>', 'Pin a pipeline variable (repeatable)', collectVar, {})
      .option('--no-assertions', 'Emit scenarios without job assertions')
      .option('--min-coverage', 'Minimize scenarios while preserving job coverage')
      .option('--children', 'Include child-pipeline jobs in generated assertions')
      .option('--joined', 'Emit a single combined output file instead of one-per-scenario')
      .option(
        '--changes-sample-suffix <path>',
        'Override the sample file path appended to generic glob patterns (default: src/index.ts)',
      ),
  ).action(generateScenariosAction)
}

async function generateScenariosAction(
  source: string[],
  opts: Record<string, unknown>,
): Promise<void> {
  const common = readCommonOptions(opts)
  const linter = buildLinter(resolveSource(source), {
    rootDir: common.rootDir,
    gitlabHost: common.gitlabHost,
  })

  const variables = getStringRecord(opts, 'var')
  const maxScenarios = getNumber(opts, 'maxScenarios') ?? Number.POSITIVE_INFINITY
  const targetJobs = getStringArray(opts, 'jobs')
  const changesSampleSuffix = getString(opts, 'changesSampleSuffix')
  const outputFormat: 'json' | 'yaml' = opts['format'] === 'json' ? 'json' : 'yaml'
  const outputFile = getString(opts, 'output')
  const joined = getBool(opts, 'joined')

  const result = await linter.generateScenarios({
    maxScenarios,
    targetJobs,
    includeAssertions: opts['assertions'] !== false,
    minimizeCoverage: getBool(opts, 'minCoverage'),
    includeChildren: getBool(opts, 'children'),
    ...(Object.keys(variables).length > 0 && { pinnedVariables: variables }),
    ...(changesSampleSuffix !== undefined && { changesSampleSuffix }),
  })

  if (!outputFile) {
    console.log(TestScenarioGenerator.formatOutput(result, outputFormat))
    warnIfLimitedToStderr(result, '\n')
    return
  }

  writeScenariosToOutput(result, outputFile, joined, outputFormat)
  console.log(`  Jobs analyzed: ${result.metadata.totalJobsAnalyzed}`)
  console.log(`  Variables found: ${result.metadata.variablesFound.length}`)
  console.log(`  Unique outcomes: ${result.metadata.uniqueOutcomes}`)
  warnIfLimitedToStderr(result, '  ')
}

export function writeScenariosToOutput(
  result: ScenarioGenerationResult,
  outputFile: string,
  joined: boolean,
  outputFormat: 'json' | 'yaml',
): void {
  if (joined) {
    writeFileSync(outputFile, TestScenarioGenerator.formatOutput(result, outputFormat))
    console.log(`Generated ${result.scenarios.length} scenarios to: ${outputFile}`)
    return
  }
  mkdirSync(outputFile, { recursive: true })
  result.scenarios.forEach((scenario, i) => {
    const fileName = TestScenarioGenerator.formatScenarioFileName(scenario, i, outputFormat)
    const content = TestScenarioGenerator.formatSingleScenario(scenario, outputFormat)
    writeFileSync(join(outputFile, fileName), content + '\n')
  })
  console.log(`Generated ${result.scenarios.length} scenarios to: ${outputFile}/`)
}

export function warnIfLimitedToStderr(
  result: { metadata: { totalBeforeLimit?: number }; scenarios: unknown[] },
  prefix: string,
): void {
  if (!result.metadata.totalBeforeLimit) return
  console.warn(
    `${prefix}⚠ ${result.metadata.totalBeforeLimit} scenarios possible, but limited to ${result.scenarios.length} by --max-scenarios. ` +
      `Increase with --max-scenarios ${result.metadata.totalBeforeLimit} for full coverage.`,
  )
}
