/**
 * Тести допоміжного виводу `pass`.
 */
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'

import { pass } from '../pass.mjs'

describe('pass', () => {
  let spy
  const lines = []

  beforeEach(() => {
    lines.length = 0
    spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '))
    })
  })

  afterEach(() => {
    spy.mockRestore()
  })

  test('друкує префікс успіху та повідомлення', () => {
    pass('тест ок')
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('✅')
    expect(lines[0]).toContain('тест ок')
  })
})
