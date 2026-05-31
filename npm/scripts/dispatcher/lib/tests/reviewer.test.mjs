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
    const v = runReview({ run: runner({ lint: 0, coverage: 0 }), cwd: '/x', fingerprint: () => 'FP' })
    expect(v.pass).toBe(true)
    expect(v.gates.map(g => g.name)).toEqual(['lint', 'coverage'])
    expect(v.fingerprint).toBe('FP')
  })

  test('lint падає → fail-fast, coverage не запускається, fingerprint null', () => {
    const v = runReview({ run: runner({ lint: 1 }), cwd: '/x', fingerprint: () => 'FP' })
    expect(v.pass).toBe(false)
    expect(v.gates).toEqual([{ name: 'lint', ok: false }])
    expect(v.fingerprint).toBe(null)
  })

  test('coverage падає → pass false', () => {
    const v = runReview({ run: runner({ lint: 0, coverage: 1 }), cwd: '/x', fingerprint: () => 'FP' })
    expect(v.pass).toBe(false)
    expect(v.gates.at(-1)).toEqual({ name: 'coverage', ok: false })
  })

  test('кастомні gate-и', () => {
    const gates = [{ name: 'custom', cmd: ['echo', 'hi'] }]
    const v = runReview({ run: () => ({ status: 0 }), cwd: '/x', gates, fingerprint: () => null })
    expect(v.pass).toBe(true)
    expect(v.gates).toEqual([{ name: 'custom', ok: true }])
  })

  test('DEFAULT_GATES — lint + coverage', () => {
    expect(DEFAULT_GATES.map(g => g.name)).toEqual(['lint', 'coverage'])
  })
})
