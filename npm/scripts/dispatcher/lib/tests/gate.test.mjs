/**
 * Тести `flow gate` (`lib/gate.mjs`). `computeGate` — чиста; handler через
 * тимчасовий стан, `now` ін'єкція.
 */
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { computeGate, gate } from '../gate.mjs'
import { flowStatePath, readState, writeState } from '../state-store.mjs'

const noop = () => {}
const FIXED = () => 1_700_000_000_000

describe('computeGate', () => {
  test('усі гейти зелені, без findings → PASS, score 100', () => {
    const r = computeGate({ gates: [{ name: 'lint', ok: true }], review: { findings: [] } })
    expect(r.verdict).toBe('PASS')
    expect(r.score).toBe(100)
  })
  test('провалений gate → FAIL', () => {
    const r = computeGate({ gates: [{ name: 'lint', ok: false }] })
    expect(r.verdict).toBe('FAIL')
    expect(r.reasons.join(' ')).toMatch(/lint/)
  })
  test('high-severity finding → FAIL', () => {
    const r = computeGate({ gates: [{ name: 'lint', ok: true }], review: { findings: [{ severity: 'high' }] } })
    expect(r.verdict).toBe('FAIL')
  })
  test('med-finding → CONCERNS', () => {
    const r = computeGate({ gates: [{ name: 'lint', ok: true }], review: { findings: [{ severity: 'med' }] } })
    expect(r.verdict).toBe('CONCERNS')
  })
  test('verify не запускався (порожні gates) → CONCERNS', () => {
    const r = computeGate({})
    expect(r.verdict).toBe('CONCERNS')
    expect(r.reasons.join(' ')).toMatch(/verify/)
  })
  test('score клампиться на 0 (багато провалів)', () => {
    const r = computeGate({ gates: [{ name: 'a', ok: false }, { name: 'b', ok: false }], review: { findings: [{ severity: 'high' }, { severity: 'high' }] } })
    expect(r.score).toBe(0)
  })
})

describe('gate', () => {
  test('без стану → 1', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      expect(await gate([], { cwd: wt, log: noop })).toBe(1)
    })
  })
  test('FAIL → код 1, пише gate у стан', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      writeState(flowStatePath(wt), { branch: 'feat/x', gates: [{ name: 'lint', ok: false }] })
      const code = await gate([], { cwd: wt, log: noop, now: FIXED })
      expect(code).toBe(1)
      expect(readState(flowStatePath(wt)).gate.verdict).toBe('FAIL')
    })
  })
  test('PASS → код 0', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-y')
      writeState(flowStatePath(wt), { branch: 'feat/y', gates: [{ name: 'lint', ok: true }] })
      expect(await gate([], { cwd: wt, log: noop, now: FIXED })).toBe(0)
      expect(readState(flowStatePath(wt)).gate.verdict).toBe('PASS')
    })
  })
})
