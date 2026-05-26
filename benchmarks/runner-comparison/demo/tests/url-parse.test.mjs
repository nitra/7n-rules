import { describe, it, expect } from 'vitest'
import { parseQuery, buildQuery } from '../src/url-parse.mjs'

describe('parseQuery', () => {
  it('empty string → {}', () => { expect(parseQuery('')).toEqual({}) })
  it('non-string → {}', () => { expect(parseQuery(null)).toEqual({}) })
  it('strips leading ?', () => { expect(parseQuery('?a=1')).toEqual({ a: '1' }) })
  it('two pairs', () => { expect(parseQuery('a=1&b=2')).toEqual({ a: '1', b: '2' }) })
  it('key without =', () => { expect(parseQuery('flag')).toEqual({ flag: '' }) })
  it('decodes percent-encoding', () => { expect(parseQuery('q=hello%20world')).toEqual({ q: 'hello world' }) })
  it('empty pair skipped', () => { expect(parseQuery('a=1&&b=2')).toEqual({ a: '1', b: '2' }) })
  it('value with =', () => { expect(parseQuery('eq=a=b')).toEqual({ eq: 'a=b' }) })
})

describe('buildQuery', () => {
  it('null → empty', () => { expect(buildQuery(null)).toBe('') })
  it('one pair', () => { expect(buildQuery({ a: 1 })).toBe('a=1') })
  it('skips undefined', () => { expect(buildQuery({ a: 1, b: undefined })).toBe('a=1') })
  it('skips null', () => { expect(buildQuery({ a: 1, b: null })).toBe('a=1') })
  it('encodes', () => { expect(buildQuery({ q: 'hello world' })).toBe('q=hello%20world') })
  it('multiple', () => { expect(buildQuery({ a: 1, b: 2 })).toBe('a=1&b=2') })
})
