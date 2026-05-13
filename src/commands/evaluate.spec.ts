import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countChildJobs,
  extractVariables,
  formatChildPipelinesText,
  groupByStage,
  pickHtmlOutput,
  writeJsonOutput,
  writeTextOutput,
} from './evaluate'
import type { ChildPipelineResult, EvaluationSummaryWithChildren } from '../child-pipeline'

describe('pickHtmlOutput', () => {
  it('returns undefined when the flag is absent', () => {
    expect(pickHtmlOutput(undefined)).toBeUndefined()
  })

  it('returns the default path for a bare --html flag (commander passes `true`)', () => {
    expect(pickHtmlOutput(true)).toBe('pipeline.html')
  })

  it('returns the explicit path when provided as a string', () => {
    expect(pickHtmlOutput('custom.html')).toBe('custom.html')
  })

  it('ignores other truthy non-string values', () => {
    // Defensive: anything that isn't strictly `true` or a string should
    // collapse to "no HTML output" rather than coerce.
    expect(pickHtmlOutput(1 as unknown)).toBeUndefined()
    expect(pickHtmlOutput({} as unknown)).toBeUndefined()
  })
})

describe('extractVariables', () => {
  it('returns the nested variables map when present and an object', () => {
    expect(extractVariables({ variables: { FOO: '1', BAR: '2' } })).toEqual({
      FOO: '1',
      BAR: '2',
    })
  })

  it('treats top-level keys as variables, dropping changes/description', () => {
    expect(
      extractVariables({
        FOO: '1',
        BAR: '2',
        changes: ['a.ts', 'b.ts'],
        description: 'a scenario',
      }),
    ).toEqual({ FOO: '1', BAR: '2' })
  })

  it('returns {} when variables is an array (malformed shape)', () => {
    // Documents a behavior change from the prior inline code, which spread
    // array indices as keys ({0:'a', 1:'b'}). The Array.isArray guard now
    // routes this to the flat-key branch, which also excludes `variables`
    // itself — so a `{variables: [...]}` input is treated as "no variables".
    expect(extractVariables({ variables: ['a', 'b'] })).toEqual({})
  })

  it('returns {} when variables is null', () => {
    expect(extractVariables({ variables: null })).toEqual({})
  })

  it('preserves the flat-key branch even when variables is also present (as an array)', () => {
    expect(extractVariables({ FOO: '1', variables: ['noise'], changes: ['a'] })).toEqual({
      FOO: '1',
    })
  })

  it('returns {} for an empty loaded object', () => {
    expect(extractVariables({})).toEqual({})
  })
})

describe('groupByStage', () => {
  it('groups jobs by stage in insertion order', () => {
    const jobs = [
      { stage: 'build', name: 'b1' },
      { stage: 'test', name: 't1' },
      { stage: 'build', name: 'b2' },
      { stage: 'deploy', name: 'd1' },
    ]
    const map = groupByStage(jobs)
    expect(Array.from(map.keys())).toEqual(['build', 'test', 'deploy'])
    expect(map.get('build')?.map(j => j.name)).toEqual(['b1', 'b2'])
    expect(map.get('test')?.map(j => j.name)).toEqual(['t1'])
  })

  it('returns an empty map for no jobs', () => {
    expect(groupByStage([])).toEqual(new Map())
  })
})

describe('countChildJobs', () => {
  function child(
    jobCount: number,
    totalJobs: number,
    children?: ChildPipelineResult[],
  ): ChildPipelineResult {
    return {
      configPath: 'child.yml',
      triggerJobName: 't',
      depth: 1,
      evaluation: {
        jobs: Array.from({ length: jobCount }, (_, i) => ({
          name: `job${i}`,
          stage: 's',
          when: 'on_success',
        })),
        skipped: [],
        totalJobs,
      },
      ...(children && { children }),
    } as unknown as ChildPipelineResult
  }

  it('counts willRun and total across one level', () => {
    expect(countChildJobs([child(3, 5), child(2, 4)])).toEqual({ willRun: 5, total: 9 })
  })

  it('recursively counts nested children', () => {
    const nested = [child(1, 2)]
    expect(countChildJobs([child(2, 3, nested)])).toEqual({ willRun: 3, total: 5 })
  })

  it('returns zeros for an empty list', () => {
    expect(countChildJobs([])).toEqual({ willRun: 0, total: 0 })
  })
})

describe('formatChildPipelinesText', () => {
  function child(overrides: Partial<ChildPipelineResult> = {}): ChildPipelineResult {
    return {
      configPath: 'child.yml',
      triggerJobName: 'trigger',
      depth: 1,
      evaluation: {
        jobs: [
          { name: 'build', stage: 'build', when: 'on_success' },
          { name: 'test', stage: 'test', when: 'manual' },
        ],
        skipped: [],
        totalJobs: 2,
      },
      ...overrides,
    } as unknown as ChildPipelineResult
  }

  it('renders a single child with stages and jobs (no color)', () => {
    const lines = formatChildPipelinesText([child()], false)
    expect(lines.some(l => l.includes('Child: child.yml'))).toBe(true)
    expect(lines.some(l => l.includes('build:'))).toBe(true)
    expect(lines.some(l => l.includes('build'))).toBe(true)
    expect(lines.some(l => l.includes('test (manual)'))).toBe(true)
  })

  it('surfaces the error message for a failed child', () => {
    const lines = formatChildPipelinesText([child({ error: 'missing include' })], false)
    expect(lines.some(l => l.includes('error: missing include'))).toBe(true)
  })

  it('recursively renders grandchildren', () => {
    const grandchild = child({ configPath: 'grandchild.yml' })
    const parent = child({ children: [grandchild] } as Partial<ChildPipelineResult>)
    const lines = formatChildPipelinesText([parent], false)
    expect(lines.some(l => l.includes('Child: grandchild.yml'))).toBe(true)
  })
})

describe('writeJsonOutput', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('emits the basic shape: jobs, summary', () => {
    const result = {
      jobs: [{ name: 'a', stage: 'build', when: 'on_success' }],
      skipped: [],
      totalJobs: 1,
    }
    writeJsonOutput(result, false)
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(payload.jobs).toEqual([{ name: 'a', stage: 'build', when: 'on_success' }])
    expect(payload.summary).toEqual({ totalJobs: 1, willRun: 1, skipped: 0 })
    expect(payload.skipped).toBeUndefined()
  })

  it('includes skipped jobs and matchedRule when requested', () => {
    const result = {
      jobs: [{ name: 'a', stage: 'build', when: 'on_success', matchedRule: 2 }],
      skipped: [{ name: 'b', stage: 'test', reason: 'no_changes' }],
      totalJobs: 2,
    }
    writeJsonOutput(result, true)
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(payload.jobs[0].matchedRule).toBe(2)
    expect(payload.skipped).toEqual([{ name: 'b', stage: 'test', reason: 'no_changes' }])
  })

  it('emits childPipelines and the childPipelinesCount summary line', () => {
    const result: EvaluationSummaryWithChildren = {
      jobs: [{ name: 'a', stage: 'build', when: 'on_success' } as never],
      skipped: [],
      totalJobs: 1,
      childPipelines: [
        {
          configPath: 'child.yml',
          triggerJobName: 'trigger',
          depth: 1,
          evaluation: {
            jobs: [{ name: 'c', stage: 'build', when: 'on_success' }],
            skipped: [],
            totalJobs: 1,
          },
        } as never,
      ],
    } as EvaluationSummaryWithChildren
    writeJsonOutput(result, false)
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(payload.childPipelines).toHaveLength(1)
    expect(payload.summary.childPipelinesCount).toBe(1)
  })
})

describe('writeTextOutput', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('prints "No jobs will run" when there are no jobs and no child runs', () => {
    writeTextOutput({ jobs: [], skipped: [], totalJobs: 0 }, false, false)
    expect(logSpy).toHaveBeenCalledWith('No jobs will run')
  })

  it('groups jobs by stage in the header', () => {
    writeTextOutput(
      {
        jobs: [
          { name: 'b', stage: 'build', when: 'on_success' },
          { name: 't', stage: 'test', when: 'manual' },
        ],
        skipped: [],
        totalJobs: 2,
      },
      false,
      false,
    )
    const allLogs = logSpy.mock.calls.map(c => c[0] as string).join('\n')
    expect(allLogs).toContain('Jobs that will run (2/2)')
    expect(allLogs).toContain('build:')
    expect(allLogs).toContain('- b')
    expect(allLogs).toContain('test:')
    expect(allLogs).toContain('- t (manual)')
  })

  it('lists skipped jobs when showSkipped is true', () => {
    writeTextOutput(
      {
        jobs: [{ name: 'a', stage: 'build', when: 'on_success' }],
        skipped: [{ name: 'b', stage: 'test', reason: 'no_changes' }],
        totalJobs: 2,
      },
      true,
      false,
    )
    const allLogs = logSpy.mock.calls.map(c => c[0] as string).join('\n')
    expect(allLogs).toContain('Skipped jobs (1)')
    expect(allLogs).toContain('- b: no_changes')
  })

  it('includes "(no reason)" when a skipped job has no reason', () => {
    writeTextOutput(
      { jobs: [], skipped: [{ name: 'b', stage: 't', reason: '' }], totalJobs: 1 },
      true,
      false,
    )
    const allLogs = logSpy.mock.calls.map(c => c[0] as string).join('\n')
    expect(allLogs).toContain('- b: no reason')
  })
})
