#!/usr/bin/env node

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Command } from 'commander'
import { registerConvertToChildScenariosCommand } from './commands/convert-to-child-scenarios'
import { registerEvaluateCommand } from './commands/evaluate'
import { registerFlattenCommand } from './commands/flatten'
import { registerGenerateScenariosCommand } from './commands/generate-scenarios'
import { registerLintCommand } from './commands/lint'
import { registerTestCommand } from './commands/test'

/**
 * Build the gitlab-ci-linter Commander program. Kept separate from the bin
 * entry point so tests can construct the program without triggering
 * `parseAsync(process.argv)`.
 */
export function buildProgram(): Command {
  const program = new Command()
    .name('gitlab-ci-linter')
    .description('Lint, evaluate, and test GitLab CI configurations')
    .version(readPackageVersion())
    .showHelpAfterError()

  registerLintCommand(program)
  registerFlattenCommand(program)
  registerEvaluateCommand(program)
  registerTestCommand(program)
  registerGenerateScenariosCommand(program)
  registerConvertToChildScenariosCommand(program)

  return program
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const path of [join(here, '../package.json'), join(here, 'package.json')]) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8')).version as string
    } catch {
      // Try next path
    }
  }
  return '0.0.0'
}

async function main(): Promise<void> {
  try {
    await buildProgram().parseAsync(process.argv)
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
