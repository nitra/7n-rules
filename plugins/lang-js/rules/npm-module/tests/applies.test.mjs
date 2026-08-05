/**
 * Тести rule-level гейта правила `npm-module` для service monorepo і npm
 * publisher-а. Гейт декларативний (`npm-module/main.json:applies`), тож тест
 * обчислює САМЕ ТОЙ предикат, який лежить у пакеті, і додатково перевіряє
 * наскрізний ефект через `detectAll`.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { detectAll } from '@7n/rules/scripts/lib/lint-surface/run-detectors.mjs'
import { evaluateAppliesNode, readRuleApplies } from '@7n/rules/scripts/lib/rule-applies.mjs'
import { ensureDir, withTmpDir, writeJson } from '@7n/rules/scripts/utils/test-helpers.mjs'

const RULE_DIR = fileURLToPath(new URL('../', import.meta.url))
const RULES_DIR = fileURLToPath(new URL('../../', import.meta.url))

/**
 * @param {string} cwd корінь тимчасового репо
 * @returns {boolean} вердикт гейта з пакета
 */
function applies(cwd) {
  const spec = readRuleApplies(RULE_DIR)
  expect(spec.kind).toBe('declarative')
  return evaluateAppliesNode(spec.node, cwd)
}

describe('npm-module applies', () => {
  test('гейт правила — декларативний any з трьох умов', () => {
    const spec = readRuleApplies(RULE_DIR)
    expect(spec.kind).toBe('declarative')
    expect(spec.node.any).toHaveLength(3)
  })

  test('service monorepo без npm topology пропускає npm-module', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-rules.json'), { rules: ['npm-module'] })
      await writeJson(join(dir, 'package.json'), { private: true, workspaces: ['run/*', 'jobs/*', 'nats-jobs/*'] })

      expect(applies(dir)).toBe(false)
      const result = await detectAll({ cwd: dir, rulesDirs: [RULES_DIR], rules: ['npm-module'] })
      expect(result.violations).toEqual([])
      expect(result.ran).toEqual([])
    })
  })

  test('workspace "npm" вмикає правило (jsonFieldContains)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { private: true, workspaces: ['run/*', 'npm'] })
      expect(applies(dir)).toBe(true)
    })
  })

  test('workflow npm-publish.yml вмикає правило без каталогу npm/', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/npm-publish.yml'), 'name: publish\n', 'utf8')
      expect(applies(dir)).toBe(true)
    })
  })

  test('publisher без npm workspace лишається в scope і root policy повертає порушення', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-rules.json'), { rules: ['npm-module'] })
      await writeJson(join(dir, 'package.json'), { private: true, workspaces: ['run/*'] })
      await ensureDir(join(dir, 'npm'))
      await writeJson(join(dir, 'npm/package.json'), { name: '@example/publisher', version: '1.0.0' })
      await writeFile(join(dir, 'hk.pkl'), '', 'utf8')

      expect(applies(dir)).toBe(true)
      const result = await detectAll({ cwd: dir, rulesDirs: [RULES_DIR], rules: ['npm-module'] })
      expect(result.violations.some(v => v.concernId === 'root_package_json' && v.message.includes('"npm"'))).toBe(true)
    })
  })
})
