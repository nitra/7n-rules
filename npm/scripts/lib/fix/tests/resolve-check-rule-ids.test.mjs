/**
 * Тести resolveCheckRuleIds — єдиного гейту селекції активних правил за `.n-cursor.json`.
 *
 * Ключова інваріанта: коли конфіг є, він — джерело правди; `.cursor/rules/*.mdc` ігнорується
 * (тож «правило enabled, але .mdc нема» більше НЕ пропускається — фікс дрейфу). Без конфіга —
 * fallback на зматеріалізовані `.mdc` (open-by-default debug).
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { resolveCheckRuleIds } from '../run-fix-check.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../utils/test-helpers.mjs'

const AVAILABLE = ['adr', 'bun', 'changelog', 'text']

/** Створює `.cursor/rules/<name>.mdc` у dir. */
async function writeMdc(dir, name) {
  const rulesDir = join(dir, '.cursor', 'rules')
  await ensureDir(rulesDir)
  await writeFile(join(rulesDir, `${name}.mdc`), '---\nalwaysApply: true\n---\n', 'utf8')
}

describe('resolveCheckRuleIds', () => {
  test('конфіг є → селекція = available ∩ rules (алфавітно), .mdc ігнорується', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['changelog', 'bun'] })
      // .mdc навмисно НЕ створюємо — конфіг має вирішувати сам.
      const ids = await resolveCheckRuleIds([], AVAILABLE, dir)
      expect(ids).toEqual(['bun', 'changelog'])
    })
  })

  test('drift-фікс: rule в конфізі без .mdc → все одно вибирається', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['text'] })
      // .cursor/rules/ порожній (sync не прогнаний) — раніше text тихо пропускався.
      await ensureDir(join(dir, '.cursor', 'rules'))
      const ids = await resolveCheckRuleIds([], AVAILABLE, dir)
      expect(ids).toEqual(['text'])
    })
  })

  test('disable-rules перемагає rules', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['bun', 'text'], 'disable-rules': ['text'] })
      const ids = await resolveCheckRuleIds([], AVAILABLE, dir)
      expect(ids).toEqual(['bun'])
    })
  })

  test('явний запит звужується до активних (вимкнене не вмикається)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['bun'] })
      const ids = await resolveCheckRuleIds(['bun', 'text'], AVAILABLE, dir)
      expect(ids).toEqual(['bun'])
    })
  })

  test('явний запит з невідомим правилом → throw', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['bun'] })
      await expect(resolveCheckRuleIds(['nope'], AVAILABLE, dir)).rejects.toThrow(/Unknown rules: nope/u)
    })
  })

  test('конфіга нема → fallback на .cursor/rules/*.mdc', async () => {
    await withTmpDir(async dir => {
      await writeMdc(dir, 'n-bun')
      await writeMdc(dir, 'n-changelog')
      const ids = await resolveCheckRuleIds([], AVAILABLE, dir)
      expect(ids).toEqual(['bun', 'changelog'])
    })
  })

  test('конфіга нема і .cursor/rules/ нема → порожньо', async () => {
    await withTmpDir(async dir => {
      const ids = await resolveCheckRuleIds([], AVAILABLE, dir)
      expect(ids).toEqual([])
    })
  })
})
