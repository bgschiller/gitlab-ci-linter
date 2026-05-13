import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { Command } from 'commander'
import { addCommonOptions, readCommonOptions } from './commonOptions'

describe('readCommonOptions', () => {
  it('returns sensible defaults for an empty opts blob', () => {
    expect(readCommonOptions({})).toEqual({
      rootDir: undefined,
      gitlabHost: undefined,
      quiet: false,
      color: true,
      severity: 'info',
    })
  })

  it('resolves --root to an absolute path', () => {
    const opts = readCommonOptions({ root: 'rel/path' })
    expect(opts.rootDir).toBe(resolve('rel/path'))
  })

  it('passes through gitlabHost when present', () => {
    expect(readCommonOptions({ gitlabHost: 'gitlab.example.com' }).gitlabHost).toBe(
      'gitlab.example.com',
    )
  })

  it('respects --quiet boolean', () => {
    expect(readCommonOptions({ quiet: true }).quiet).toBe(true)
  })

  it('turns color off when commander reports color === false', () => {
    expect(readCommonOptions({ color: false }).color).toBe(false)
    expect(readCommonOptions({}).color).toBe(true)
  })

  it('prefers --error over --warning over --info for severity', () => {
    expect(readCommonOptions({ error: true, warning: true }).severity).toBe('error')
    expect(readCommonOptions({ warning: true }).severity).toBe('warning')
    expect(readCommonOptions({ info: true }).severity).toBe('info')
    expect(readCommonOptions({}).severity).toBe('info')
  })

  it('ignores non-string root values', () => {
    expect(readCommonOptions({ root: 42 }).rootDir).toBeUndefined()
  })
})

describe('addCommonOptions', () => {
  it('attaches all the shared options to a command', () => {
    const cmd = new Command('lint')
    addCommonOptions(cmd)
    const names = cmd.options.map(o => o.long ?? o.short)
    expect(names).toEqual(
      expect.arrayContaining([
        '--root',
        '--gitlab-host',
        '--quiet',
        '--no-color',
        '--error',
        '--warning',
        '--info',
      ]),
    )
  })

  it('makes severity flags mutually exclusive', () => {
    const cmd = new Command('lint').exitOverride()
    cmd.configureOutput({ writeErr: () => {}, writeOut: () => {} })
    addCommonOptions(cmd).action(() => {})
    expect(() => cmd.parse(['--error', '--warning'], { from: 'user' })).toThrow(
      /option .* cannot be used with/,
    )
  })
})
