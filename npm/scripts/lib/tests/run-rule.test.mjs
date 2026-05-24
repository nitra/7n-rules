/**
 * Тести `runRule`: applies-gate, JS-concerns, policy-concerns (без реального conftest).
 *
 * Policy-частина мокається через підмінений `resolve-target-files.mjs` — реальний `runConftestBatch`
 * у конец-у-кінців спробує спавнити `conftest`, тому коли немає `target.json` (порожні `policyConcerns`)
 * — він не викликається; для гейт-тестів `applies()` цього достатньо. Окремий інтеграційний прогін на
 * правилі `rego` зробимо у `check`-фікстурі.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runRule } from '../run-rule.mjs'
import { ensureDir, withTmpCwd } from '../../utils/test-helpers.mjs'

/**
 * Записує JS-файл у `rules/<id>/js/<concern>.mjs` з довільним вмістом (flat-layout з 1.14.0).
 * @param {string} ruleId id правила
 * @param {string} concern імʼя концерну (стає basename файла)
 * @param {string} body вміст файла
 * @returns {Promise<void>}
 */
async function writeConcernJs(ruleId, concern, body) {
  await ensureDir(join('rules', ruleId, 'js'))
  await writeFile(join('rules', ruleId, 'js', `${concern}.mjs`), body, 'utf8')
}

describe('runRule — applies gate', () => {
  test('false → правило пропущено, інші концерни не запускаються', async () => {
    await withTmpCwd(async dir => {
      await writeConcernJs(
        'rego',
        'applies',
        `export const applies = async () => false
         export const check = async () => { throw new Error('не має викликатись') }
        `
      )
      await writeConcernJs(
        'rego',
        'other',
        `export const check = async () => { throw new Error('не має викликатись') }`
      )
      const rule = {
        id: 'rego',
        jsConcerns: [{ name: 'applies' }, { name: 'other' }],
        policyConcerns: []
      }
      const code = await runRule(rule, join(dir, 'rules'), new Map())
      expect(code).toBe(0)
    })
  })

  test('true → всі концерни запускаються', async () => {
    await withTmpCwd(async dir => {
      await writeConcernJs(
        'rego',
        'applies',
        `export const applies = async () => true
         export const check = async () => 0
        `
      )
      await writeConcernJs(
        'rego',
        'other',
        `let called = false
         export const check = async () => { called = true; return 0 }
         export const wasCalled = () => called`
      )
      const rule = {
        id: 'rego',
        jsConcerns: [{ name: 'applies' }, { name: 'other' }],
        policyConcerns: []
      }
      const code = await runRule(rule, join(dir, 'rules'), new Map())
      expect(code).toBe(0)
    })
  })

  test('відсутній applies-концерн → правило просто запускається', async () => {
    await withTmpCwd(async dir => {
      await writeConcernJs('text', 'cspell', `export const check = async () => 0`)
      const rule = {
        id: 'text',
        jsConcerns: [{ name: 'cspell' }],
        policyConcerns: []
      }
      const code = await runRule(rule, join(dir, 'rules'), new Map())
      expect(code).toBe(0)
    })
  })
})

describe('runRule — exit-код агрегується', () => {
  test('1, якщо хоча б один JS-концерн повернув ненульовий', async () => {
    await withTmpCwd(async dir => {
      await writeConcernJs('mix', 'a', `export const check = async () => 0`)
      await writeConcernJs('mix', 'b', `export const check = async () => 1`)
      const rule = {
        id: 'mix',
        jsConcerns: [{ name: 'a' }, { name: 'b' }],
        policyConcerns: []
      }
      const code = await runRule(rule, join(dir, 'rules'), new Map())
      expect(code).toBe(1)
    })
  })
})
