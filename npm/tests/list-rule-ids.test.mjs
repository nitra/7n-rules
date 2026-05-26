import { afterEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listRuleIds } from '../scripts/lib/list-rule-ids.mjs'

/** @type {string[]} */
const tmpRoots = []

/**
 * Створює тимчасове дерево rules/ з fix.mjs і прихованими каталогами.
 * @param {{withFix?: string[], withoutFix?: string[], hidden?: string[]}} opts набори id правил
 * @returns {string} абсолютний шлях до кореня fake rules/
 */
function makeFakeRules({ withFix = [], withoutFix = [], hidden = [] }) {
  const root = mkdtempSync(join(tmpdir(), 'list-rule-ids-'))
  tmpRoots.push(root)
  for (const id of withFix) {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, 'fix.mjs'), '')
  }
  for (const id of withoutFix) {
    mkdirSync(join(root, id), { recursive: true })
  }
  for (const id of hidden) {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, 'fix.mjs'), '')
  }
  return root
}

afterEach(() => {
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop(), { recursive: true, force: true })
})

describe('listRuleIds', () => {
  test('повертає алфавітно відсортовані id з fix.mjs', async () => {
    const root = makeFakeRules({ withFix: ['ga', 'abie', 'k8s'] })
    expect(await listRuleIds(root)).toEqual(['abie', 'ga', 'k8s'])
  })

  test('пропускає каталоги без fix.mjs', async () => {
    const root = makeFakeRules({ withFix: ['abie'], withoutFix: ['no-fix'] })
    expect(await listRuleIds(root)).toEqual(['abie'])
  })

  test('пропускає каталоги з dot-prefix навіть якщо мають fix.mjs', async () => {
    const root = makeFakeRules({ withFix: ['abie'], hidden: ['.hidden'] })
    expect(await listRuleIds(root)).toEqual(['abie'])
  })

  test('фільтрація через filter повертає лише цей id', async () => {
    const root = makeFakeRules({ withFix: ['abie', 'ga', 'k8s'] })
    expect(await listRuleIds(root, 'abie')).toEqual(['abie'])
  })

  test('фільтр на відсутнє правило — порожній масив', async () => {
    const root = makeFakeRules({ withFix: ['abie'] })
    expect(await listRuleIds(root, 'nope')).toEqual([])
  })
})
