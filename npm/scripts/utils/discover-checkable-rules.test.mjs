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
 * Створює плаский legacy `rules/<id>/js/check.mjs`.
 * @param {string} ruleId id правила
 * @returns {Promise<void>}
 */
async function addLegacyJs(ruleId) {
  await ensureDir(join('rules', ruleId, 'js'))
  await writeFile(join('rules', ruleId, 'js', 'check.mjs'), 'export const check = () => 0\n', 'utf8')
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
      expect(out).toEqual([
        { id: 'text', jsConcerns: [{ name: 'cspell', files: ['check.mjs'], legacy: false }], policyConcerns: [] }
      ])
    })
  })

  test('legacy JS — плаский js/check.mjs', async () => {
    await withTmpCwd(async dir => {
      await addLegacyJs('rego')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([
        { id: 'rego', jsConcerns: [{ name: 'legacy', files: ['check.mjs'], legacy: true }], policyConcerns: [] }
      ])
    })
  })

  test('гібрид під час міграції: legacy js/check.mjs ігнорується, якщо є subdir-концерни', async () => {
    await withTmpCwd(async dir => {
      // Симулюємо стан коли flat check.mjs ще лишився (для backward-compat тестів),
      // а нові концерни вже додані. Discovery має взяти ТІЛЬКИ subdir-концерни — інакше
      // CLI прогонить логіку двічі (раз у flat, раз через концерни).
      await addLegacyJs('abie')
      await addJsConcern('abie', 'firebase')
      await addJsConcern('abie', 'env_dns', 'check-env-dns.mjs')
      await addPolicyConcern('abie', 'health_check_policy')
      await addPolicyConcern('abie', 'http_route_base')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([
        {
          id: 'abie',
          jsConcerns: [
            { name: 'env_dns', files: ['check-env-dns.mjs'], legacy: false },
            { name: 'firebase', files: ['check.mjs'], legacy: false }
          ],
          policyConcerns: [{ name: 'health_check_policy' }, { name: 'http_route_base' }]
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
