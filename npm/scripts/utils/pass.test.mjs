/**
 * Тести допоміжного виводу `pass`.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { pass } from './pass.mjs'

describe('pass', () => {
  const originalLog = console.log

  afterEach(() => {
    console.log = originalLog
  })

  test('друкує префікс успіху та повідомлення', () => {
    const lines = []
    console.log = mock((...args) => {
      lines.push(args.join(' '))
    })
    pass('тест ок')
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('✅')
    expect(lines[0]).toContain('тест ок')
  })
})
