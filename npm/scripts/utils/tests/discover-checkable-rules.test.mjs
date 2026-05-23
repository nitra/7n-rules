/**
 * Тести `discoverCheckableRules`: різні комбінації структури `rules/<id>/{fix,policy}/`.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { discoverCheckableRules } from '../discover-checkable-rules.mjs'
import { ensureDir, withTmpCwd } from '../test-helpers.mjs'

/**
 * Створює `rules/<id>/js/<concern>.mjs`.
 * @param {string} ruleId id правила
 * @param {string} concern імʼя концерну
 * @returns {Promise<void>}
 */
async function addJsConcern(ruleId, concern) {
  await ensureDir(join('rules', ruleId, 'js'))
  await writeFile(join('rules', ruleId, 'js', `${concern}.mjs`), 'export const check = () => 0\n', 'utf8')
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

  test('правило з JS-концерном у js/', async () => {
    await withTmpCwd(async dir => {
      await addJsConcern('text', 'cspell')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([{ id: 'text', jsConcerns: [{ name: 'cspell' }], policyConcerns: [] }])
    })
  })

  test('правило з кількома JS-концернами в js/ — всі присутні, відсортовані', async () => {
    await withTmpCwd(async dir => {
      await addJsConcern('text', 'shellcheck')
      await addJsConcern('text', 'cspell')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([
        {
          id: 'text',
          jsConcerns: [
            { name: 'cspell' },
            { name: 'shellcheck' }
          ],
          policyConcerns: []
        }
      ])
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

  test('пропускає js/_lib/ як концерн (prefix _)', async () => {
    await withTmpCwd(async dir => {
      await ensureDir(join('rules', 'abie', 'js', '_lib'))
      await writeFile(join('rules', 'abie', 'js', '_lib.mjs'), 'export const check = () => 0\n', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      // _lib.mjs пропускається як concern — починається з _
      expect(out).toEqual([])
    })
  })

  test('пропускає *.test.mjs у js/', async () => {
    await withTmpCwd(async dir => {
      await addJsConcern('text', 'cspell')
      await writeFile(join('rules', 'text', 'js', 'cspell.test.mjs'), '', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out[0].jsConcerns).toEqual([{ name: 'cspell' }])
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
