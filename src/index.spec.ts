import { describe, expect, it } from 'vitest'
import { buildProgram } from './index'

/**
 * Parse args through Commander without invoking the action handlers, then
 * return the opts blob for the named subcommand. Mirrors how the bin entry
 * point invokes the program but stops short of executing the command body.
 */
function parseSubcommandOpts(argv: string[], subcommand: string): Record<string, unknown> {
  const program = buildProgram()
  // Stub each command's action so parsing doesn't execute the real handler.
  // We only care about the parsed options.
  for (const cmd of program.commands) cmd.action(() => {})
  program.parse(argv, { from: 'user' })
  const cmd = program.commands.find(c => c.name() === subcommand)
  if (!cmd) throw new Error(`Subcommand '${subcommand}' not found`)
  return cmd.opts()
}

describe('generate-scenarios --changes-sample-suffix', () => {
  it('parses the value when provided', () => {
    const opts = parseSubcommandOpts(
      [
        'generate-scenarios',
        '.gitlab-ci.yml',
        '--changes-sample-suffix',
        'src/main/java/Sample.java',
      ],
      'generate-scenarios',
    )
    expect(opts['changesSampleSuffix']).toBe('src/main/java/Sample.java')
  })

  it('leaves changesSampleSuffix undefined when the flag is absent', () => {
    const opts = parseSubcommandOpts(['generate-scenarios', '.gitlab-ci.yml'], 'generate-scenarios')
    expect(opts['changesSampleSuffix']).toBeUndefined()
  })

  it('rejects --changes-sample-suffix with no following value', () => {
    // Commander treats a value-bearing option at the end of argv as a parse
    // error and writes to stderr via configureOutput; capture so the test
    // log stays clean.
    const program = buildProgram()
    program.exitOverride()
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} })
    for (const cmd of program.commands) {
      cmd.action(() => {})
      cmd.exitOverride()
      cmd.configureOutput({ writeErr: () => {}, writeOut: () => {} })
    }
    expect(() =>
      program.parse(['generate-scenarios', '.gitlab-ci.yml', '--changes-sample-suffix'], {
        from: 'user',
      }),
    ).toThrow(/argument missing|option .* argument/i)
  })
})
