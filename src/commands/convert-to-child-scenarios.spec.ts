import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveGitlabCiFile, writeConvertOutput } from './convert-to-child-scenarios'

describe('resolveGitlabCiFile', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gci-linter-conv-'))
  })

  it('returns the file path unchanged when it points to a file', () => {
    const path = join(dir, 'custom.yml')
    writeFileSync(path, 'stages: [build]\n')
    expect(resolveGitlabCiFile(path)).toBe(path)
  })

  it('appends /.gitlab-ci.yml when given a directory that contains it', () => {
    writeFileSync(join(dir, '.gitlab-ci.yml'), 'stages: [build]\n')
    expect(resolveGitlabCiFile(dir)).toBe(join(dir, '.gitlab-ci.yml'))
  })

  it('returns undefined when given a directory without .gitlab-ci.yml', () => {
    const subdir = join(dir, 'empty')
    mkdirSync(subdir)
    expect(resolveGitlabCiFile(subdir)).toBeUndefined()
  })
})

describe('writeConvertOutput', () => {
  let dir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gci-linter-conv-out-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('prints YAML to stdout when no outputFile is given', () => {
    writeConvertOutput(
      {
        scenarios: [{ description: 's1', variables: {}, assertions: { jobs: {} } }],
        metadata: { scenariosConverted: 1 },
      },
      { outputFormat: 'yaml', joined: false },
    )
    expect(logSpy).toHaveBeenCalled()
    const output = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('description: s1')
  })

  it('writes a joined output file when joined=true', () => {
    const outFile = join(dir, 'joined.yaml')
    writeConvertOutput(
      {
        scenarios: [{ description: 's1', variables: {}, assertions: { jobs: {} } }],
        metadata: { scenariosConverted: 1 },
      },
      { outputFile: outFile, outputFormat: 'yaml', joined: true },
    )
    expect(existsSync(outFile)).toBe(true)
    expect(readFileSync(outFile, 'utf8')).toContain('description: s1')
  })

  it('writes one file per scenario when joined=false', () => {
    const outDir = join(dir, 'per-scenario')
    writeConvertOutput(
      {
        scenarios: [
          { description: 's1', variables: {}, assertions: { jobs: { a: 'automatic' } } },
          { description: 's2', variables: {}, assertions: { jobs: { b: 'automatic' } } },
        ],
        metadata: { scenariosConverted: 2 },
      },
      { outputFile: outDir, outputFormat: 'yaml', joined: false },
    )
    const files = readdirSync(outDir).sort()
    expect(files).toHaveLength(2)
  })
})
