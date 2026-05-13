import { mkdtempSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { warnIfLimitedToStderr, writeScenariosToOutput } from './generate-scenarios'

describe('warnIfLimitedToStderr', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('says nothing when totalBeforeLimit is unset', () => {
    warnIfLimitedToStderr({ metadata: {}, scenarios: [] }, '\n')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('emits the limit-reached warning with the given prefix', () => {
    warnIfLimitedToStderr({ metadata: { totalBeforeLimit: 100 }, scenarios: new Array(10) }, '\n')
    const message = warnSpy.mock.calls[0]?.[0] as string
    expect(message).toContain('100 scenarios possible')
    expect(message).toContain('limited to 10')
    expect(message).toContain('--max-scenarios 100')
  })

  it('prepends the indent prefix when one is given', () => {
    warnIfLimitedToStderr({ metadata: { totalBeforeLimit: 50 }, scenarios: new Array(5) }, '  ')
    const message = warnSpy.mock.calls[0]?.[0] as string
    expect(message.startsWith('  ⚠')).toBe(true)
  })
})

describe('writeScenariosToOutput', () => {
  let dir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gci-linter-gen-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  function makeResult(count = 2): Parameters<typeof writeScenariosToOutput>[0] {
    return {
      scenarios: Array.from({ length: count }, (_, i) => ({
        description: `s${i + 1}`,
        variables: {},
        assertions: { jobs: { a: 'automatic' } },
      })),
      metadata: {
        totalJobsAnalyzed: 1,
        variablesFound: [],
        uniqueOutcomes: count,
      },
    } as unknown as Parameters<typeof writeScenariosToOutput>[0]
  }

  it('writes a single joined file when joined=true', () => {
    const out = join(dir, 'scenarios.yaml')
    writeScenariosToOutput(makeResult(2), out, true, 'yaml')
    expect(readFileSync(out, 'utf8')).toContain('s1')
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('Generated 2 scenarios to: '))).toBe(
      true,
    )
  })

  it('writes one file per scenario when joined=false', () => {
    const out = join(dir, 'per')
    writeScenariosToOutput(makeResult(3), out, false, 'yaml')
    const files = readdirSync(out).sort()
    expect(files).toHaveLength(3)
  })

  it('respects the json format', () => {
    const out = join(dir, 'scenarios.json')
    writeScenariosToOutput(makeResult(1), out, true, 'json')
    expect(() => JSON.parse(readFileSync(out, 'utf8'))).not.toThrow()
  })
})
