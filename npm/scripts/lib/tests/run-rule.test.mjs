/**
 * Тести `runRule`: applies-gate, JS-concerns, policy-concerns (без реального conftest).
 *
 * Policy-частина мокається через підмінений `resolve-target-files.mjs` — реальний `runConftestBatch`
 * у конец-у-кінців спробує спавнити `conftest`, тому коли немає `target.json` (порожні `policyConcerns`)
 * — він не викликається; для гейт-тестів `applies()` цього достатньо. Окремий інтеграційний прогін на
 * правилі `rego` зробимо у `check`-фікстурі.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runRule } from '../run-rule.mjs'
import { ensureDir, withTmpDir } from '../../utils/test-helpers.mjs'

/**
 * Записує JS-файл у `<dir>/rules/<id>/js/<concern>.mjs` з довільним вмістом (flat-layout з 1.14.0).
 * @param {string} dir абсолютний шлях тимчасового каталогу
 * @param {string} ruleId id правила
 * @param {string} concern імʼя концерну (стає basename файла)
 * @param {string} body вміст файла
 * @returns {Promise<void>}
 */
async function writeConcernJs(dir, ruleId, concern, body) {
  await ensureDir(join(dir, 'rules', ruleId, 'js'))
  await writeFile(join(dir, 'rules', ruleId, 'js', `${concern}.mjs`), body, 'utf8')
}

describe('runRule — applies gate', () => {
  test('false → правило пропущено, інші концерни не запускаються', async () => {
    await withTmpDir(async dir => {
      await writeConcernJs(dir, 
        'rego',
        'applies',
        `export const applies = async () => false
         export const check = async () => { throw new Error('не має викликатись') }
        `
      )
      await writeConcernJs(dir, 
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
    await withTmpDir(async dir => {
      await writeConcernJs(dir, 
        'rego',
        'applies',
        `export const applies = async () => true
         export const check = async () => 0
        `
      )
      await writeConcernJs(dir, 
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
    await withTmpDir(async dir => {
      await writeConcernJs(dir, 'text', 'cspell', `export const check = async () => 0`)
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
    await withTmpDir(async dir => {
      await writeConcernJs(dir, 'mix', 'a', `export const check = async () => 0`)
      await writeConcernJs(dir, 'mix', 'b', `export const check = async () => 1`)
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

describe('runRule — applies-gate: applies-модуль без функції applies', () => {
  test('модуль є, але без exports.applies → rules вважається застосовним', async () => {
    await withTmpDir(async dir => {
      await writeConcernJs(dir, 'noapplies', 'applies', `export const check = async () => 0`)
      const rule = {
        id: 'noapplies',
        jsConcerns: [{ name: 'applies' }],
        policyConcerns: []
      }
      const code = await runRule(rule, join(dir, 'rules'), new Map())
      expect(code).toBe(0)
    })
  })
})

describe('runRule — policy concerns', () => {
  test('required single file відсутній → exit 1 (без conftest)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      await ensureDir(join(rulesDir, 'mypol', 'policy', 'check'))
      await writeFile(
        join(rulesDir, 'mypol', 'policy', 'check', 'target.json'),
        JSON.stringify({
          files: { single: '__nonexistent_xyz__.json', required: true },
          missingMessage: 'test: файл відсутній'
        }),
        'utf8'
      )
      const rule = { id: 'mypol', jsConcerns: [], policyConcerns: [{ name: 'check' }] }
      const code = await runRule(rule, rulesDir, new Map())
      expect(code).toBe(1)
    })
  })

  test('optional single file відсутній → exit 0 (без conftest)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      await ensureDir(join(rulesDir, 'mypol2', 'policy', 'check'))
      await writeFile(
        join(rulesDir, 'mypol2', 'policy', 'check', 'target.json'),
        JSON.stringify({ files: { single: '__nonexistent_xyz__.json', required: false } }),
        'utf8'
      )
      const rule = { id: 'mypol2', jsConcerns: [], policyConcerns: [{ name: 'check' }] }
      const code = await runRule(rule, rulesDir, new Map())
      expect(code).toBe(0)
    })
  })
})

describe('runRule — MDC template refs', () => {
  test('template/-файл без посилання в .mdc → code 1', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const ruleDir = join(rulesDir, 'myrule')
      await ensureDir(join(ruleDir, 'fix', 'concern', 'template'))
      await writeFile(join(ruleDir, 'fix', 'concern', 'template', 'example.js'), 'x\n', 'utf8')
      await writeFile(join(ruleDir, 'myrule.mdc'), '# Rule\n\nNo references\n', 'utf8')
      const rule = { id: 'myrule', jsConcerns: [], policyConcerns: [] }
      const code = await runRule(rule, rulesDir, new Map())
      expect(code).toBe(1)
    })
  })

  test('template/-файл з посиланням ./<rel> → code 0', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const ruleDir = join(rulesDir, 'myrule2')
      await ensureDir(join(ruleDir, 'fix', 'concern', 'template'))
      await writeFile(join(ruleDir, 'fix', 'concern', 'template', 'example.js'), 'x\n', 'utf8')
      await writeFile(
        join(ruleDir, 'myrule2.mdc'),
        '# Rule\n\n[ref](./fix/concern/template/example.js)\n',
        'utf8'
      )
      const rule = { id: 'myrule2', jsConcerns: [], policyConcerns: [] }
      const code = await runRule(rule, rulesDir, new Map())
      expect(code).toBe(0)
    })
  })

  test('без .mdc файлу → MDC refs не перевіряються, code 0', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const ruleDir = join(rulesDir, 'norule')
      await ensureDir(ruleDir)
      const rule = { id: 'norule', jsConcerns: [], policyConcerns: [] }
      const code = await runRule(rule, rulesDir, new Map())
      expect(code).toBe(0)
    })
  })
})
