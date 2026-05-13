import { describe, expect, it } from 'vitest'
import {
  filterIssuesBySeverity,
  formatIssue,
  formatLocationLine,
  formatSourcePrefix,
  plural,
  quietLintExitCode,
} from './lint'
import type { LintIssue } from '../types'

function issue(
  severity: 'error' | 'warning' | 'info',
  overrides: Partial<LintIssue> = {},
): LintIssue {
  return {
    severity,
    message: 'msg',
    location: undefined,
    ...overrides,
  } as LintIssue
}

describe('plural', () => {
  it('returns the bare word for n === 1', () => {
    expect(plural(1, 'issue')).toBe('issue')
  })
  it('returns the suffixed word for 0', () => {
    expect(plural(0, 'issue')).toBe('issues')
  })
  it('returns the suffixed word for n > 1', () => {
    expect(plural(2, 'error')).toBe('errors')
  })
})

describe('filterIssuesBySeverity', () => {
  const issues: LintIssue[] = [
    issue('error', { message: 'e' }),
    issue('warning', { message: 'w' }),
    issue('info', { message: 'i' }),
  ]

  it('keeps everything at info level', () => {
    expect(filterIssuesBySeverity(issues, 'info').map(i => i.message)).toEqual(['e', 'w', 'i'])
  })

  it('drops info at warning level', () => {
    expect(filterIssuesBySeverity(issues, 'warning').map(i => i.message)).toEqual(['e', 'w'])
  })

  it('keeps only errors at error level', () => {
    expect(filterIssuesBySeverity(issues, 'error').map(i => i.message)).toEqual(['e'])
  })

  it('treats unknown severities as below threshold', () => {
    const mixed = [issue('error'), { severity: 'mystery', message: '?' } as unknown as LintIssue]
    expect(filterIssuesBySeverity(mixed, 'info')).toHaveLength(1)
  })
})

describe('quietLintExitCode', () => {
  it('returns 2 when any error is present', () => {
    expect(quietLintExitCode([issue('error'), issue('warning')])).toBe(2)
  })
  it('returns 1 when only warnings are present', () => {
    expect(quietLintExitCode([issue('warning'), issue('info')])).toBe(1)
  })
  it('returns 0 when only info issues are present', () => {
    expect(quietLintExitCode([issue('info')])).toBe(0)
  })
  it('returns 0 for an empty list', () => {
    expect(quietLintExitCode([])).toBe(0)
  })
})

describe('formatSourcePrefix', () => {
  it('returns empty string when source is undefined', () => {
    expect(formatSourcePrefix(undefined, true)).toBe('')
  })
  it('returns empty string when source is "parent"', () => {
    expect(formatSourcePrefix('parent', true)).toBe('')
  })
  it('returns plain prefix when color is off', () => {
    expect(formatSourcePrefix('apps/x/.gitlab-ci.yml', false)).toBe(
      '[child: apps/x/.gitlab-ci.yml] ',
    )
  })
  it('wraps prefix in dim ANSI codes when color is on', () => {
    const out = formatSourcePrefix('child.yml', true)
    expect(out).toContain('\x1b[2m')
    expect(out).toContain('[child: child.yml]')
    expect(out).toContain('\x1b[0m')
  })
})

describe('formatLocationLine', () => {
  it('returns empty string when location is undefined', () => {
    expect(formatLocationLine(undefined, true)).toBe('')
  })
  it('returns plain line when color is off', () => {
    expect(formatLocationLine('file.yml:42', false)).toBe('\n  at file.yml:42')
  })
  it('wraps in dim when color is on', () => {
    const out = formatLocationLine('file.yml:42', true)
    expect(out).toContain('\x1b[2m')
    expect(out).toContain('at file.yml:42')
  })
})

describe('formatIssue', () => {
  it('formats a plain issue without color', () => {
    expect(formatIssue(issue('error', { message: 'broken' }), false)).toBe('error: broken')
  })
  it('appends location line when present', () => {
    expect(formatIssue(issue('warning', { message: 'm', location: 'f:1' }), false)).toBe(
      'warning: m\n  at f:1',
    )
  })
  it('prefixes [child: ...] for issues that originate in a child pipeline', () => {
    const childIssue = { ...issue('info', { message: 'm' }), source: 'apps/x/.gitlab-ci.yml' }
    expect(formatIssue(childIssue as LintIssue, false)).toBe(
      '[child: apps/x/.gitlab-ci.yml] info: m',
    )
  })
  it('applies severity color when useColor is true', () => {
    const out = formatIssue(issue('error', { message: 'broken' }), true)
    expect(out).toContain('\x1b[31m') // red
    expect(out).toContain('error')
    expect(out).toContain('broken')
  })
  it('falls back to info color for unknown severities', () => {
    const odd = {
      ...issue('info'),
      severity: 'mystery' as unknown as LintIssue['severity'],
      message: 'x',
    }
    const out = formatIssue(odd, true)
    expect(out).toContain('\x1b[36m') // cyan = info color
  })
})
