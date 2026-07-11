/**
 * Тести harness-фасаду (Фаза A4): валідація профілю, резолв профіль+виклик у opts,
 * делегація в правильний раннер із правильними позиційними аргументами (раннери — fake).
 */

import { describe, expect, test, vi } from 'vitest'
import { createHarness, HARNESS_SCHEMA_VERSION, validateProfile } from '../lib/harness.mjs'

const RE_NOT_FOUND = /профіль не знайдено/
const RE_INVALID = /невалідний профіль/

const verifyStub = () => ({ ok: true })

/**
 * Harness із fake-раннерами, що фіксують свої аргументи.
 * @param {Record<string, object>} profiles іменовані профілі
 * @returns {{ harness: object, calls: object }} harness + акумулятор викликів
 */
function withFakes(profiles) {
  const calls = {}
  const deps = {
    runAgentFix: vi.fn((...args) => {
      calls.fix = args
      return Promise.resolve({ applied: true })
    }),
    runAgentSkill: vi.fn((...args) => {
      calls.skill = args
      return Promise.resolve({ ok: true })
    }),
    runOneShot: vi.fn((...args) => {
      calls.oneShot = args
      return Promise.resolve({ content: 'x' })
    })
  }
  return { harness: createHarness({ profiles, deps }), calls }
}

describe('validateProfile', () => {
  test('валідний fix/skill/one-shot профіль', () => {
    expect(validateProfile({ kind: 'fix' }).ok).toBe(true)
    expect(validateProfile({ kind: 'skill', schema_version: HARNESS_SCHEMA_VERSION }).ok).toBe(true)
    expect(validateProfile({ kind: 'one-shot' }).ok).toBe(true)
  })

  test('невідомий kind → помилка', () => {
    const r = validateProfile({ kind: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('невідомий kind')
  })

  test('несумісний schema_version → помилка', () => {
    const r = validateProfile({ kind: 'fix', schema_version: 999 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('schema_version')
  })

  test('не-обʼєкт → помилка', () => {
    expect(validateProfile(null).ok).toBe(false)
    expect(validateProfile('x').ok).toBe(false)
  })
})

describe('createHarness.run — делегація', () => {
  test('fix: профіль-дефолти + per-виклик поля → позиційні (ruleId, violation, cwd) + opts', async () => {
    const { harness, calls } = withFakes({
      'fix-cloud': { kind: 'fix', tier: 'cloud-min', anchoredEdits: true, verifyMax: 2 }
    })
    const verify = verifyStub
    await harness.run({
      profile: 'fix-cloud',
      ruleId: 'n-ci4',
      violation: '❌',
      cwd: '/proj',
      verify,
      targetFiles: ['a.mjs']
    })
    const [ruleId, violation, cwd, opts] = calls.fix
    expect([ruleId, violation, cwd]).toEqual(['n-ci4', '❌', '/proj'])
    expect(opts).toMatchObject({ tier: 'cloud-min', anchoredEdits: true, verifyMax: 2, verify, targetFiles: ['a.mjs'] })
    expect(opts).not.toHaveProperty('kind')
    expect(opts).not.toHaveProperty('schema_version')
  })

  test('skill: prompt позиційний, решта — opts', async () => {
    const { harness, calls } = withFakes({ writer: { kind: 'skill', tier: 'max' } })
    await harness.run({ profile: 'writer', prompt: 'напиши тест', cwd: '/proj' })
    const [prompt, opts] = calls.skill
    expect(prompt).toBe('напиши тест')
    expect(opts).toMatchObject({ tier: 'max', cwd: '/proj' })
  })

  test('one-shot: усе в одному obj-arg', async () => {
    const { harness, calls } = withFakes({ classify: { kind: 'one-shot', modelTier: 'min' } })
    await harness.run({ profile: 'classify', messages: [{ role: 'user', content: 'hi' }] })
    const [opts] = calls.oneShot
    expect(opts).toMatchObject({ modelTier: 'min', messages: [{ role: 'user', content: 'hi' }] })
  })

  test('per-виклик поле перекриває профіль', async () => {
    const { harness, calls } = withFakes({ 'fix-cloud': { kind: 'fix', tier: 'cloud-min', timeoutMs: 120_000 } })
    await harness.run({ profile: 'fix-cloud', ruleId: 'r', violation: 'v', cwd: '/p', timeoutMs: 5000 })
    expect(calls.fix[3].timeoutMs).toBe(5000)
  })

  test('інлайн-профіль (обʼєкт замість імені) працює', async () => {
    const { harness, calls } = withFakes({})
    await harness.run({ profile: { kind: 'fix', tier: 'local-min' }, ruleId: 'r', violation: 'v', cwd: '/p' })
    expect(calls.fix[3].tier).toBe('local-min')
  })

  test('невідоме імʼя профілю → кидає', async () => {
    const { harness } = withFakes({ a: { kind: 'fix' } })
    await expect(harness.run({ profile: 'missing', ruleId: 'r', violation: 'v', cwd: '/p' })).rejects.toThrow(
      RE_NOT_FOUND
    )
  })

  test('невалідний профіль → кидає до раннера', async () => {
    const { harness, calls } = withFakes({ bad: { kind: 'wat' } })
    await expect(harness.run({ profile: 'bad' })).rejects.toThrow(RE_INVALID)
    expect(calls.fix).toBeUndefined()
  })

  test('profileNames повертає імена', () => {
    const { harness } = withFakes({ a: { kind: 'fix' }, b: { kind: 'skill' } })
    expect(harness.profileNames().toSorted()).toEqual(['a', 'b'])
  })
})
