/**
 * Тести «Судді» (`lib/reviewer.mjs`, spec §5/§8.4). `run` і `fingerprint`
 * ін'єктуються — без реальних lint/coverage.
 */
import { describe, expect, test } from 'vitest'

import { DEFAULT_GATES, runReview } from '../reviewer.mjs'

/**
 * Фейковий runner: статус за іменем gate (останній arg команди).
 * @param {Record<string, number>} statuses мапа gate→status
 * @returns {(cmd: string, args: string[]) => { status: number }} runner
 */
function runner(statuses) {
  return (cmd, args) => ({ status: statuses[args.at(-1)] ?? 0 })
}

describe('runReview', () => {
  test('усі gate-и зелені → pass + fingerprint', () => {
    const v = runReview({ run: runner({ lint: 0 }), cwd: '/x', fingerprint: () => 'FP' })
    expect(v.pass).toBe(true)
    expect(v.gates.map(g => g.name)).toEqual(['lint'])
    expect(v.fingerprint).toBe('FP')
  })

  test('lint падає → fail, fingerprint null', () => {
    const v = runReview({ run: runner({ lint: 1 }), cwd: '/x', fingerprint: () => 'FP' })
    expect(v.pass).toBe(false)
    expect(v.gates).toEqual([{ name: 'lint', ok: false }])
    expect(v.fingerprint).toBe(null)
  })

  test('fail-fast — другий gate падає, третій не запускається', () => {
    const gates = [
      { name: 'a', cmd: ['echo', 'a'] },
      { name: 'b', cmd: ['echo', 'b'] },
      { name: 'c', cmd: ['echo', 'c'] }
    ]
    const v = runReview({ run: runner({ a: 0, b: 1, c: 0 }), cwd: '/x', gates, fingerprint: () => 'FP' })
    expect(v.pass).toBe(false)
    expect(v.gates).toEqual([{ name: 'a', ok: true }, { name: 'b', ok: false }])
    expect(v.fingerprint).toBe(null)
  })

  test('кастомні gate-и', () => {
    const gates = [{ name: 'custom', cmd: ['echo', 'hi'] }]
    const v = runReview({ run: () => ({ status: 0 }), cwd: '/x', gates, fingerprint: () => null })
    expect(v.pass).toBe(true)
    expect(v.gates).toEqual([{ name: 'custom', ok: true }])
  })

  test('DEFAULT_GATES — лише lint (coverage поза turnstile)', () => {
    expect(DEFAULT_GATES.map(g => g.name)).toEqual(['lint'])
  })
})
