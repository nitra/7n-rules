import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { isRuleEnabled, readNCursorConfigLite } from '../read-n-cursor-config-lite.mjs'
import { withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

describe('readNCursorConfigLite', () => {
  test('повертає exists:false коли файл відсутній', async () => {
    await withTmpDir(async dir => {
      const cfg = await readNCursorConfigLite(dir)
      expect(cfg).toEqual({ exists: false, rules: [], disableRules: [] })
    })
  })

  test('повертає rules і disableRules з файлу', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['js-lint', 'docker'], 'disable-rules': ['text'] })
      const cfg = await readNCursorConfigLite(dir)
      expect(cfg.exists).toBe(true)
      expect(cfg.rules).toEqual(['js-lint', 'docker'])
      expect(cfg.disableRules).toEqual(['text'])
    })
  })

  test('повертає порожні масиви коли поля відсутні', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-cursor.json'), { name: 'x' })
      const cfg = await readNCursorConfigLite(dir)
      expect(cfg.exists).toBe(true)
      expect(cfg.rules).toEqual([])
      expect(cfg.disableRules).toEqual([])
    })
  })

  test('фільтрує нерядкові елементи з rules', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-cursor.json'), '{"rules":["a",42,null,"b"]}', 'utf8')
      const cfg = await readNCursorConfigLite(dir)
      expect(cfg.rules).toEqual(['a', 'b'])
    })
  })
})

describe('isRuleEnabled', () => {
  test('true коли config.exists=false (open by default)', () => {
    expect(isRuleEnabled({ exists: false, rules: [], disableRules: [] }, 'any')).toBe(true)
  })

  test('false коли rule в disableRules', () => {
    expect(isRuleEnabled({ exists: true, rules: ['a'], disableRules: ['a'] }, 'a')).toBe(false)
  })

  test('true коли rule в rules', () => {
    expect(isRuleEnabled({ exists: true, rules: ['a', 'b'], disableRules: [] }, 'a')).toBe(true)
  })

  test('false коли rule не в rules', () => {
    expect(isRuleEnabled({ exists: true, rules: ['b'], disableRules: [] }, 'a')).toBe(false)
  })
})
