/**
 * Тести `discoverCheckableRules`: різні комбінації concern-dirs у `rules/<id>/`.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { discoverCheckableRules } from '../discover-checkable-rules.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

/**
 * Створює concern-dir у `<dir>/rules/<id>/<concern>/`.
 * @param {string} dir tmp-корінь
 * @param {string} ruleId id правила
 * @param {string} concern ім'я concern-а
 * @param {object} [meta] поля для concern.json (окрім $schema); за замовчуванням `{ check: true }`
 */
async function addConcern(dir, ruleId, concern, meta) {
  const resolvedMeta = meta ?? { check: true }
  const concernDir = join(dir, 'rules', ruleId, concern)
  await mkdir(concernDir, { recursive: true })
  await writeJson(join(concernDir, 'concern.json'), {
    $schema: 'https://unpkg.com/@7n/rules/schemas/concern.json',
    ...resolvedMeta
  })
}

describe('discoverCheckableRules', () => {
  test('повертає [] для відсутнього каталогу', async () => {
    await withTmpDir(async dir => {
      const out = await discoverCheckableRules(join(dir, 'nope'))
      expect(out).toEqual([])
    })
  })

  test('правило з тільки policy-concern', async () => {
    await withTmpDir(async dir => {
      await addConcern(dir, 'bun', 'package_json', {
        policy: { files: { single: 'package.json' }, namespace: 'bun.package_json' }
      })
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toHaveLength(1)
      expect(out[0].id).toBe('bun')
      expect(out[0].concerns).toHaveLength(1)
      expect(out[0].concerns[0].name).toBe('package_json')
      expect(out[0].concerns[0].policy).toBeTruthy()
    })
  })

  test('правило з check-concern', async () => {
    await withTmpDir(async dir => {
      await addConcern(dir, 'text', 'cspell', { check: true })
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toHaveLength(1)
      expect(out[0].id).toBe('text')
      expect(out[0].concerns).toHaveLength(1)
      expect(out[0].concerns[0].name).toBe('cspell')
      expect(out[0].concerns[0].check).toBe(true)
    })
  })

  test('правило з кількома concerns — відсортовані алфавітно', async () => {
    await withTmpDir(async dir => {
      await addConcern(dir, 'text', 'shellcheck', { check: true })
      await addConcern(dir, 'text', 'cspell', { check: true })
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toHaveLength(1)
      expect(out[0].concerns.map(c => c.name)).toEqual(['cspell', 'shellcheck'])
    })
  })

  test('пропускає правило без жодного concern.json', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'rules', 'docs-only'))
      await writeFile(join(dir, 'rules', 'docs-only', 'docs-only.mdc'), '', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([])
    })
  })

  test('правило з utility-dir без concern.json не включається', async () => {
    await withTmpDir(async dir => {
      // utility dir без concern.json — не concern
      const utilDir = join(dir, 'rules', 'abie', 'lib')
      await mkdir(utilDir, { recursive: true })
      await writeFile(join(utilDir, 'helper.mjs'), 'export const x = 1\n', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out).toEqual([])
    })
  })

  test('concern без concern.json не включається', async () => {
    await withTmpDir(async dir => {
      await addConcern(dir, 'text', 'cspell', { check: true })
      // directory without concern.json
      await mkdir(join(dir, 'rules', 'text', 'orphan'), { recursive: true })
      await writeFile(join(dir, 'rules', 'text', 'orphan', 'orphan.rego'), '', 'utf8')
      const out = await discoverCheckableRules(join(dir, 'rules'))
      expect(out[0].concerns.map(c => c.name)).toEqual(['cspell'])
    })
  })
})
