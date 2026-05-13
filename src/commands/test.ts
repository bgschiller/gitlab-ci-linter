import { type Command } from 'commander'
import { addCommonOptions, readCommonOptions } from '../cli/commonOptions'
import { getBool, getString } from '../cli/opts'
import { buildLinter, resolveSource } from '../cli/source'
import { reportVarsFileError } from '../cli/varsFile'
import { ScenarioLoader } from '../scenario-loader'
import { type TestResult, TestRunner, type TestScenario } from '../test-runner'

export function registerTestCommand(program: Command): Command {
  return addCommonOptions(
    program
      .command('test')
      .description('Run pre-recorded scenarios and assert pipeline outcomes')
      .argument('[source...]', 'Path to .gitlab-ci.yml, or GitLab URL, or "<project> <ref>"')
      .requiredOption('--vars-file <path>', 'Path to a scenarios file or directory')
      .option('--json', 'Emit JSON output')
      .option('--no-children', 'Do not evaluate child pipelines'),
  ).action(testAction)
}

async function testAction(source: string[], opts: Record<string, unknown>): Promise<void> {
  const common = readCommonOptions(opts)
  const includeChildren = opts['children'] !== false
  const linter = buildLinter(resolveSource(source), {
    rootDir: common.rootDir,
    gitlabHost: common.gitlabHost,
    evaluateChildren: includeChildren,
  })

  const varsFile = getString(opts, 'varsFile') ?? ''
  const scenarios = loadAndValidateTestScenarios(varsFile)

  const results: TestResult[] = []
  for (const scenario of scenarios) {
    results.push(await linter.test(scenario, includeChildren))
  }

  const useJson = getBool(opts, 'json')
  const [single, ...rest] = results
  if (single !== undefined && rest.length === 0) {
    outputSingleResult(single, common.quiet, useJson, common.color)
  } else {
    outputAggregateResult(results, common.quiet, useJson, common.color)
  }
}

function outputSingleResult(
  result: TestResult,
  quiet: boolean,
  useJson: boolean,
  useColor: boolean,
): never {
  if (quiet) process.exit(result.passed ? 0 : 1)
  if (useJson) {
    console.log(JSON.stringify(TestRunner.toJson(result), null, 2))
  } else {
    for (const line of TestRunner.formatTestResult(result, useColor)) console.log(line)
  }
  process.exit(result.passed ? 0 : 1)
}

function outputAggregateResult(
  results: TestResult[],
  quiet: boolean,
  useJson: boolean,
  useColor: boolean,
): never {
  const aggregate = TestRunner.aggregateResults(results)
  if (quiet) process.exit(aggregate.passed ? 0 : 1)
  if (useJson) {
    console.log(JSON.stringify(TestRunner.toAggregateJson(aggregate), null, 2))
  } else {
    for (const line of TestRunner.formatAggregateResult(aggregate, useColor)) console.log(line)
  }
  process.exit(aggregate.passed ? 0 : 1)
}

function loadAndValidateTestScenarios(varsFile: string): TestScenario[] {
  const scenarios = loadScenariosOrExit(varsFile)
  if (scenarios.length === 0) {
    console.error(`Error: No test scenarios found in '${varsFile}'`)
    process.exit(2)
  }
  scenarios.forEach((scenario, i) => {
    const validationError = TestRunner.validateScenario(scenario)
    if (validationError) {
      const label = scenario.description ?? `scenario ${i + 1}`
      console.error(`Error: Invalid test scenario (${label}): ${validationError}`)
      process.exit(2)
    }
  })
  return scenarios
}

function loadScenariosOrExit(varsFile: string): TestScenario[] {
  try {
    return ScenarioLoader.loadScenariosFromPath(varsFile)
  } catch (error) {
    reportVarsFileError(varsFile, error, 2)
  }
}
