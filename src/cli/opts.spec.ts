import { describe, expect, it } from 'vitest'
import { getBool, getNumber, getString, getStringArray, getStringRecord } from './opts'

describe('getString', () => {
  it('returns the value when it is a string', () => {
    expect(getString({ foo: 'bar' }, 'foo')).toBe('bar')
  })
  it('returns undefined for missing keys', () => {
    expect(getString({}, 'foo')).toBeUndefined()
  })
  it('returns undefined for non-string values', () => {
    expect(getString({ foo: 42 }, 'foo')).toBeUndefined()
    expect(getString({ foo: true }, 'foo')).toBeUndefined()
    expect(getString({ foo: null }, 'foo')).toBeUndefined()
  })
})

describe('getBool', () => {
  it('returns true only for strict-boolean true', () => {
    expect(getBool({ foo: true }, 'foo')).toBe(true)
  })
  it('returns false for any other value', () => {
    expect(getBool({ foo: false }, 'foo')).toBe(false)
    expect(getBool({ foo: 'true' }, 'foo')).toBe(false)
    expect(getBool({ foo: 1 }, 'foo')).toBe(false)
    expect(getBool({}, 'foo')).toBe(false)
  })
})

describe('getNumber', () => {
  it('returns the value when it is a number', () => {
    expect(getNumber({ foo: 42 }, 'foo')).toBe(42)
    expect(getNumber({ foo: 0 }, 'foo')).toBe(0)
  })
  it('returns undefined for non-numbers', () => {
    expect(getNumber({ foo: '42' }, 'foo')).toBeUndefined()
    expect(getNumber({}, 'foo')).toBeUndefined()
  })
})

describe('getStringArray', () => {
  it('returns the array when present', () => {
    expect(getStringArray({ foo: ['a', 'b'] }, 'foo')).toEqual(['a', 'b'])
  })
  it('filters non-string elements', () => {
    expect(getStringArray({ foo: ['a', 1, 'b', null] }, 'foo')).toEqual(['a', 'b'])
  })
  it('returns undefined for non-arrays', () => {
    expect(getStringArray({ foo: 'not-array' }, 'foo')).toBeUndefined()
    expect(getStringArray({}, 'foo')).toBeUndefined()
  })
})

describe('getStringRecord', () => {
  it('returns the record when value is a plain object', () => {
    expect(getStringRecord({ foo: { A: '1', B: '2' } }, 'foo')).toEqual({ A: '1', B: '2' })
  })
  it('returns empty record for missing key', () => {
    expect(getStringRecord({}, 'foo')).toEqual({})
  })
  it('returns empty record for arrays', () => {
    expect(getStringRecord({ foo: ['a'] }, 'foo')).toEqual({})
  })
  it('returns empty record for primitives', () => {
    expect(getStringRecord({ foo: 'bar' }, 'foo')).toEqual({})
    expect(getStringRecord({ foo: 42 }, 'foo')).toEqual({})
    expect(getStringRecord({ foo: null }, 'foo')).toEqual({})
  })
})
