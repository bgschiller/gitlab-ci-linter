import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectVar,
  loadVarsFile,
  parseCommaList,
  reportVarsFileError,
  stringifyUnknown,
} from './varsFile'

describe('loadVarsFile', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gci-linter-varsfile-'))
  })

  it('parses JSON when extension is .json', () => {
    const path = join(dir, 'vars.json')
    writeFileSync(path, JSON.stringify({ FOO: 'bar' }))
    expect(loadVarsFile(path)).toEqual({ FOO: 'bar' })
  })

  it('parses YAML when extension is .yaml', () => {
    const path = join(dir, 'vars.yaml')
    writeFileSync(path, 'FOO: bar\n')
    expect(loadVarsFile(path)).toEqual({ FOO: 'bar' })
  })

  it('parses YAML when extension is .yml', () => {
    const path = join(dir, 'vars.yml')
    writeFileSync(path, 'FOO: bar\n')
    expect(loadVarsFile(path)).toEqual({ FOO: 'bar' })
  })

  it('throws when the parsed value is not an object', () => {
    const path = join(dir, 'list.yaml')
    writeFileSync(path, '- one\n- two\n')
    expect(() => loadVarsFile(path)).toThrow(/did not parse to an object/)
  })

  it('throws SyntaxError when JSON is malformed', () => {
    const path = join(dir, 'broken.json')
    writeFileSync(path, '{ this is not json }')
    expect(() => loadVarsFile(path)).toThrow(SyntaxError)
  })
})

describe('reportVarsFileError', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('exit')
    }) as never)
  })
  afterEach(() => {
    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('classifies SyntaxError as invalid JSON', () => {
    expect(() => reportVarsFileError('v.json', new SyntaxError('boom'), 1)).toThrow()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Invalid JSON in vars file 'v.json'/),
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('classifies ENOENT errors as missing file', () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    expect(() => reportVarsFileError('v.yml', err, 2)).toThrow()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/not found: 'v.yml'/))
  })

  it("classifies 'Path not found' Errors as missing file", () => {
    const err = new Error('Path not found: /nope')
    expect(() => reportVarsFileError('v.yml', err, 1)).toThrow()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/not found: 'v.yml'/))
  })

  it('classifies YAMLParseError as invalid YAML', () => {
    const err = Object.assign(new Error('bad yaml'), { name: 'YAMLParseError' })
    expect(() => reportVarsFileError('v.yml', err, 1)).toThrow()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Invalid YAML in vars file 'v.yml'/),
    )
  })

  it('falls back to a generic message for unknown errors', () => {
    expect(() => reportVarsFileError('v.yml', new Error('weird'), 1)).toThrow()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/reading vars file 'v.yml': weird/))
  })

  it('handles non-Error throwables', () => {
    expect(() => reportVarsFileError('v.yml', 'not an error', 1)).toThrow()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/reading vars file 'v.yml': not an error/),
    )
  })
})

describe('collectVar', () => {
  it('aggregates KEY=VALUE into a record', () => {
    let acc: Record<string, string> = {}
    acc = collectVar('FOO=1', acc)
    acc = collectVar('BAR=two', acc)
    expect(acc).toEqual({ FOO: '1', BAR: 'two' })
  })

  it('ignores entries without an equals sign', () => {
    expect(collectVar('not_kv', { A: '1' })).toEqual({ A: '1' })
  })

  it('preserves empty values after equals', () => {
    expect(collectVar('FOO=', {})).toEqual({ FOO: '' })
  })

  it('splits only on the first equals', () => {
    expect(collectVar('FOO=a=b=c', {})).toEqual({ FOO: 'a=b=c' })
  })
})

describe('parseCommaList', () => {
  it('splits and trims', () => {
    expect(parseCommaList(' a, b ,c')).toEqual(['a', 'b', 'c'])
  })
  it('returns a single-element array when no commas', () => {
    expect(parseCommaList('only')).toEqual(['only'])
  })
})

describe('stringifyUnknown', () => {
  it('extracts message from Error instances', () => {
    expect(stringifyUnknown(new Error('boom'))).toBe('boom')
  })
  it('returns strings as-is', () => {
    expect(stringifyUnknown('hello')).toBe('hello')
  })
  it('converts numbers via toString', () => {
    expect(stringifyUnknown(42)).toBe('42')
    expect(stringifyUnknown(0)).toBe('0')
  })
  it('converts booleans to literal strings', () => {
    expect(stringifyUnknown(true)).toBe('true')
    expect(stringifyUnknown(false)).toBe('false')
  })
  it('handles null and undefined explicitly', () => {
    expect(stringifyUnknown(null)).toBe('null')
    expect(stringifyUnknown(undefined)).toBe('undefined')
  })
  it('JSON-stringifies plain objects rather than producing [object Object]', () => {
    expect(stringifyUnknown({ foo: 'bar' })).toBe('{"foo":"bar"}')
  })
  it('JSON-stringifies arrays', () => {
    expect(stringifyUnknown([1, 2, 3])).toBe('[1,2,3]')
  })
  it('falls back to Object.prototype.toString for circular references', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(stringifyUnknown(circular)).toBe('[object Object]')
  })
  it('falls back to Object.prototype.toString when JSON.stringify returns undefined (e.g. functions)', () => {
    expect(stringifyUnknown(() => 1)).toBe('[object Function]')
  })
})
