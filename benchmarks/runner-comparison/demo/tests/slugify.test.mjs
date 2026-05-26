import { describe, it, expect } from 'vitest'
import { slugify } from '../src/slugify.mjs'

describe('slugify', () => {
  it('lowercases', () => { expect(slugify('Hello')).toBe('hello') })
  it('trims', () => { expect(slugify('  hi  ')).toBe('hi') })
  it('replaces spaces with single dash', () => { expect(slugify('a  b  c')).toBe('a-b-c') })
  it('strips non-word chars', () => { expect(slugify('hi!@#world')).toBe('hiworld') })
  it('collapses multiple dashes', () => { expect(slugify('a---b')).toBe('a-b') })
  it('keeps underscores', () => { expect(slugify('a_b')).toBe('a_b') })
  it('returns empty for non-string', () => { expect(slugify(null)).toBe('') })
  it('returns empty for number', () => { expect(slugify(42)).toBe('') })
  it('truncates to 64', () => { expect(slugify('x'.repeat(100)).length).toBe(64) })
  it('preserves exact 64-char string', () => { expect(slugify('x'.repeat(64)).length).toBe(64) })
  it('handles digits', () => { expect(slugify('hello 123')).toBe('hello-123') })
  it('handles tab/newline as space', () => { expect(slugify('a\tb\nc')).toBe('a-b-c') })
})
