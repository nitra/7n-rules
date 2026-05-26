/**
 * Тести допоміжного виводу `pass`.
 */
import { afterEach, describe, expect, vi, test } from 'vitest'

import { pass } from '../pass.mjs'

describe('pass', () => {
  const originalLog = console.log

  afterEach(() => {
    console.log = originalLog
  })

  test('друкує префікс успіху та повідомлення', () => {
    const lines = []
    console.log = vi.fn((...args) => {
      lines.push(args.join(' '))
    })
    pass('тест ок')
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('✅')
    expect(lines[0]).toContain('тест ок')
  })
})
