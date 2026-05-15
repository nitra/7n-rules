/**
 * Тести `discoverCheckableRules`: різні комбінації структури `rules/<id>/{js,policy}/`.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { discoverCheckableRules } from './discover-checkable-rules.mjs'
import { ensureDir, withTmpCwd } from './test-helpers.mjs'

/**
 * Створює `rules/<id>/js/<concern>/check.mjs`.
 * @param {string} ruleId id правила
 * @param {string} concern імʼя концерну (підкаталог js/)
 * @param {string} fileName наприклад `check.mjs` або `check-foo.mjs`
 * @returns {Promise<void>}
 */
async function addJsConcern(ruleId, concern, fileName = 'check.mjs') {
  await ensureDir(join('rules', ruleId, 'js', concern))
  await writeFile(join('rules', ruleId, 'js', concern, fileName), 'export const check = () => 0\n', 'utf8')
}

/**
 * Створює `rules/<id>/policy/<concern>/{concern.rego,target.json}`.
 * @param {string} ruleId id правила
 * @param {string} concern імʼя концерну
 * @param {string} [filesSpec] вміст target.json як JSON
 * @returns {Promise<void>}
 */
async function addPolicyConcern(ruleId, concern, filesSpec = '{"files":{"single":"package.json"}}') {
  await ensureDir(join('rules', ruleId, 'policy', concern))
  await writeFile(join('rules', ruleId, 'policy', concern, `${concern}.rego`), '', 'utf8')
  await writeFile(join('rules', ruleId, 'policy', concern, 'target.json'), filesSpec, 'utf8')
}

describe('discoverCheckableRules', () => {
  test('повертає [] для відсутнього каталогу', async () => {
    await withTmpCwd(async dir => {
      const out = await discoverCheckableRules(join(dir, 'nope'))
      expect(out).toEqual([])
    })
  })

  test('правило з тільки policy-концерном', async () => {
    await withTmpCwd(async dir => {
      await addPolicyConcern('bun', 'package_json')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([{ id: 'bun', jsConcerns: [], policyConcerns: [{ name: 'package_json' }] }])
    })
  })

  test('правило з тільки JS-концерном (новий формат)', async () => {
    await withTmpCwd(async dir => {
      await addJsConcern('text', 'cspell')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([{ id: 'text', jsConcerns: [{ name: 'cspell', files: ['check.mjs'] }], policyConcerns: [] }])
    })
  })

  test('ігнорує flat js/check.mjs без subdir-концерну (legacy більше не підтримується)', async () => {
    await withTmpCwd(async dir => {
      await ensureDir(join('rules', 'flat-only', 'js'))
      await writeFile(join('rules', 'flat-only', 'js', 'check.mjs'), 'export const check = () => 0\n', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([])
    })
  })

  test('пропускає правило без js/ і без policy/', async () => {
    await withTmpCwd(async dir => {
      await ensureDir(join('rules', 'docs-only'))
      await writeFile(join('rules', 'docs-only', 'docs-only.mdc'), '', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([])
    })
  })

  test('пропускає js/utils/ як концерн', async () => {
    await withTmpCwd(async dir => {
      await ensureDir(join('rules', 'abie', 'js', 'utils'))
      await writeFile(join('rules', 'abie', 'js', 'utils', 'check.mjs'), 'export const check = () => 0\n', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([])
    })
  })

  test('пропускає *.test.mjs у концерні', async () => {
    await withTmpCwd(async dir => {
      await addJsConcern('text', 'cspell')
      await writeFile(join('rules', 'text', 'js', 'cspell', 'check.test.mjs'), '', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out[0].jsConcerns[0].files).toEqual(['check.mjs'])
    })
  })

  test('пропускає policy/<name>/ без target.json', async () => {
    await withTmpCwd(async dir => {
      await ensureDir(join('rules', 'k8s', 'policy', 'orphan'))
      await writeFile(join('rules', 'k8s', 'policy', 'orphan', 'orphan.rego'), '', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([])
    })
  })
})
