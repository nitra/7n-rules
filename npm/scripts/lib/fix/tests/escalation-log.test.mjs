/**
 * Юніт-тести escalation-log.mjs — резолв шляху (kill-switch / override / дефолт)
 * і формат запису рунга (`recheckOk` обнуляє `remainingViolation`, обрізка полів).
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from 'node:process'

import { escalationLogPath, logEscalation } from '../escalation-log.mjs'

const KEY = 'N_CURSOR_FIX_ESCALATION_LOG'
let prev
beforeEach(() => {
  prev = env[KEY]
})
afterEach(() => {
  if (prev === undefined) delete env[KEY]
  else env[KEY] = prev
})

describe('escalationLogPath', () => {
  test('kill-switch вимикає лог (→ null)', () => {
    for (const v of ['0', 'false', 'OFF', 'no']) {
      env[KEY] = v
      expect(escalationLogPath()).toBeNull()
    }
  })

  test('явний шлях має пріоритет', () => {
    const explicit = '/explicit/override-escalation.jsonl'
    env[KEY] = explicit
    expect(escalationLogPath()).toBe(explicit)
  })

  test('дефолт — .n-cursor/fix-escalation.jsonl', () => {
    delete env[KEY]
    expect(escalationLogPath().endsWith('.n-cursor/fix-escalation.jsonl')).toBe(true)
  })
})

describe('logEscalation', () => {
  test('kill-switch → нічого не пишеться (no-op)', () => {
    env[KEY] = '0'
    expect(() => logEscalation({ ruleId: 'x', ts: 't', rung: 0, tier: 'local-min', recheckOk: true })).not.toThrow()
  })

  test('пише JSONL-рядок; recheckOk обнуляє remainingViolation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'esc-'))
    const file = join(dir, 'log.jsonl')
    env[KEY] = file
    try {
      logEscalation({
        ts: '2026-06-19T00:00:00.000Z',
        ruleId: 'rego',
        rung: 2,
        tier: 'cloud-min',
        model: 'openai/min',
        withFeedback: true,
        callOk: true,
        callError: null,
        recheckOk: true,
        remainingViolation: 'should be dropped',
        diagnosis: 'prev local model produced no changes',
        ms: 1234
      })
      const rec = JSON.parse(readFileSync(file, 'utf8').trim())
      expect(rec).toMatchObject({ ruleId: 'rego', tier: 'cloud-min', recheckOk: true, diagnosis: expect.any(String) })
      expect(rec.remainingViolation).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('recheckOk=false зберігає remainingViolation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'esc-'))
    const file = join(dir, 'log.jsonl')
    env[KEY] = file
    try {
      logEscalation({
        ts: 't',
        ruleId: 'bun',
        rung: 0,
        tier: 'local-min',
        model: 'omlx/x',
        withFeedback: false,
        callOk: false,
        callError: 'no changes',
        recheckOk: false,
        remainingViolation: 'still red',
        diagnosis: null,
        ms: 5
      })
      const rec = JSON.parse(readFileSync(file, 'utf8').trim())
      expect(rec.remainingViolation).toBe('still red')
      expect(rec.callError).toBe('no changes')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
