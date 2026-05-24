/**
 * Тести `createCheckReporter`: накопичення коду виходу та вивід помилок.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { createCheckReporter } from '../check-reporter.mjs'

describe('createCheckReporter', () => {
  const originalLog = console.log

  afterEach(() => {
    console.log = originalLog
  })

  test('getExitCode 0 доки не було fail', () => {
    const r = createCheckReporter()
    r.pass('ok')
    expect(r.getExitCode()).toBe(0)
  })

  test('після fail getExitCode 1 і друкується ❌', () => {
    const lines = []
    console.log = mock((...args) => {
      lines.push(args.join(' '))
    })
    const r = createCheckReporter()
    r.fail('щось не так')
    expect(r.getExitCode()).toBe(1)
    expect(lines.some(l => l.includes('❌') && l.includes('щось не так'))).toBe(true)
  })
})
