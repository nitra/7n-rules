/**
 * Тести `discoverCheckableRules`: різні комбінації структури `rules/<id>/{fix,policy}/`.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { discoverCheckableRules } from '../discover-checkable-rules.mjs'
import { ensureDir, withTmpDir } from '../../utils/test-helpers.mjs'

/**
 * Створює `<dir>/rules/<id>/js/<concern>.mjs`.
 * @param {string} dir абсолютний шлях тимчасового каталогу
 * @param {string} ruleId id правила
 * @param {string} concern імʼя концерну
 * @returns {Promise<void>}
 */
async function addJsConcern(dir, ruleId, concern) {
  await ensureDir(join(dir, 'rules', ruleId, 'js'))
  await writeFile(join(dir, 'rules', ruleId, 'js', `${concern}.mjs`), 'export const check = () => 0\n', 'utf8')
}

/**
 * Створює `<dir>/rules/<id>/policy/<concern>/{concern.rego,target.json}`.
 * @param {string} dir абсолютний шлях тимчасового каталогу
 * @param {string} ruleId id правила
 * @param {string} concern імʼя концерну
 * @param {string} [filesSpec] вміст target.json як JSON
 * @returns {Promise<void>}
 */
async function addPolicyConcern(dir, ruleId, concern, filesSpec = '{"files":{"single":"package.json"}}') {
  await ensureDir(join(dir, 'rules', ruleId, 'policy', concern))
  await writeFile(join(dir, 'rules', ruleId, 'policy', concern, `${concern}.rego`), '', 'utf8')
  await writeFile(join(dir, 'rules', ruleId, 'policy', concern, 'target.json'), filesSpec, 'utf8')
}

describe('discoverCheckableRules', () => {
  test('повертає [] для відсутнього каталогу', async () => {
    await withTmpDir(async dir => {
      const out = await discoverCheckableRules(join(dir, 'nope'))
      expect(out).toEqual([])
    })
  })

  test('правило з тільки policy-концерном', async () => {
    await withTmpDir(async dir => {
      await addPolicyConcern(dir, 'bun', 'package_json')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([{ id: 'bun', jsConcerns: [], policyConcerns: [{ name: 'package_json' }] }])
    })
  })

  test('правило з JS-концерном у js/', async () => {
    await withTmpDir(async dir => {
      await addJsConcern(dir, 'text', 'cspell')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([{ id: 'text', jsConcerns: [{ name: 'cspell' }], policyConcerns: [] }])
    })
  })

  test('правило з кількома JS-концернами в js/ — всі присутні, відсортовані', async () => {
    await withTmpDir(async dir => {
      await addJsConcern(dir, 'text', 'shellcheck')
      await addJsConcern(dir, 'text', 'cspell')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([
        {
          id: 'text',
          jsConcerns: [{ name: 'cspell' }, { name: 'shellcheck' }],
          policyConcerns: []
        }
      ])
    })
  })

  test('пропускає правило без js/ і без policy/', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'rules', 'docs-only'))
      await writeFile(join(dir, 'rules', 'docs-only', 'docs-only.mdc'), '', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([])
    })
  })

  test('пропускає js/_lib/ як концерн (prefix _)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'rules', 'abie', 'js', '_lib'))
      await writeFile(join(dir, 'rules', 'abie', 'js', '_lib.mjs'), 'export const check = () => 0\n', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      // _lib.mjs пропускається як concern — починається з _
      expect(out).toEqual([])
    })
  })

  test('пропускає *.test.mjs у js/', async () => {
    await withTmpDir(async dir => {
      await addJsConcern(dir, 'text', 'cspell')
      await writeFile(join(dir, 'rules', 'text', 'js', 'cspell.test.mjs'), '', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out[0].jsConcerns).toEqual([{ name: 'cspell' }])
    })
  })

  test('пропускає policy/<name>/ без target.json', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'rules', 'k8s', 'policy', 'orphan'))
      await writeFile(join(dir, 'rules', 'k8s', 'policy', 'orphan', 'orphan.rego'), '', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([])
    })
  })
})
