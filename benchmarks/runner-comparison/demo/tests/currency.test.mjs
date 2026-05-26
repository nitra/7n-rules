import { describe, it, expect } from 'vitest'
import { formatCents, addCents, percentOf } from '../src/currency.mjs'

describe('formatCents', () => {
  it('0 → "USD 0.00"', () => {
    expect(formatCents(0)).toBe('USD 0.00')
  })
  it('100 → "USD 1.00"', () => {
    expect(formatCents(100)).toBe('USD 1.00')
  })
  it('199 → "USD 1.99"', () => {
    expect(formatCents(199)).toBe('USD 1.99')
  })
  it('5 → "USD 0.05"', () => {
    expect(formatCents(5)).toBe('USD 0.05')
  })
  it('-250 → "-USD 2.50"', () => {
    expect(formatCents(-250)).toBe('-USD 2.50')
  })
  it('custom currency', () => {
    expect(formatCents(100, { currency: 'EUR' })).toBe('EUR 1.00')
  })
  it('non-number → ""', () => {
    expect(formatCents('100')).toBe('')
  })
  it('NaN → ""', () => {
    expect(formatCents(NaN)).toBe('')
  })
  it('Infinity → ""', () => {
    expect(formatCents(Infinity)).toBe('')
  })
})

describe('addCents', () => {
  it('100 + 50 = 150', () => {
    expect(addCents(100, 50)).toBe(150)
  })
  it('rounds inputs', () => {
    expect(addCents(1.4, 2.6)).toBe(4)
  })
  it('non-number → 0', () => {
    expect(addCents('a', 1)).toBe(0)
  })
  it('negative + positive', () => {
    expect(addCents(-50, 100)).toBe(50)
  })
})

describe('percentOf', () => {
  it('10% of 1000 = 100', () => {
    expect(percentOf(1000, 10)).toBe(100)
  })
  it('25% of 200 = 50', () => {
    expect(percentOf(200, 25)).toBe(50)
  })
  it('rounds', () => {
    expect(percentOf(333, 10)).toBe(33)
  })
  it('non-number → 0', () => {
    expect(percentOf('x', 10)).toBe(0)
  })
})
