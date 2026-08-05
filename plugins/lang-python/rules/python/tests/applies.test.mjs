/**
 * Тести rule-level гейта правила `python`. Гейт декларативний
 * (`python/main.json:applies`), тож тест бере САМЕ ТОЙ предикат, який реально
 * лежить у пакеті, і обчислює його — а не окрему тестову копію.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { evaluateAppliesNode, readRuleApplies } from '@7n/rules/scripts/lib/rule-applies.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

const RULE_DIR = fileURLToPath(new URL('../', import.meta.url))

/**
 * @param {string} cwd корінь тимчасового репо
 * @returns {boolean} вердикт гейта з пакета
 */
function applies(cwd) {
  const spec = readRuleApplies(RULE_DIR)
  expect(spec.kind).toBe('declarative')
  return evaluateAppliesNode(spec.node, cwd)
}

describe('python applies', () => {
  test('гейт правила — декларативний, без виконуваного модуля', () => {
    expect(readRuleApplies(RULE_DIR)).toEqual({ kind: 'declarative', node: { pathExists: 'pyproject.toml' } })
  })

  test('true коли pyproject.toml у cwd', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\nversion = "0.1.0"\n', 'utf8')
      expect(applies(dir)).toBe(true)
    })
  })

  test('false коли pyproject.toml відсутній', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      expect(applies(dir)).toBe(false)
    })
  })
})
