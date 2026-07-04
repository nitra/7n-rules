/**
 * Тести `createCheckReporter`: накопичення коду виходу та вивід помилок.
 */
import { afterEach, describe, expect, vi, test } from 'vitest'

import { createCheckReporter } from '../check-reporter.mjs'

describe('createCheckReporter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('getExitCode 0 доки не було fail', () => {
    const r = createCheckReporter()
    r.pass('ok')
    expect(r.getExitCode()).toBe(0)
  })

  test('після fail getExitCode 1 і друкується ❌', () => {
    const lines = []
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '))
    })
    const r = createCheckReporter()
    r.fail('щось не так')
    expect(r.getExitCode()).toBe(1)
    expect(lines.some(l => l.includes('❌') && l.includes('щось не так'))).toBe(true)
  })
})
