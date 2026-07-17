/**
 * Тести detector-а `text/markdownlint` (main.mjs) — реальний прогін `markdownlint-cli2`,
 * без моків. Перевіряє, що violation несе реальну деталь (файл/рядок/правило) замість
 * голого "щось не пройшло" — інцидент: `logError` глушився, LLM fix-worker (і non-verbose
 * підсумок) не бачив жодної причини провалу (той самий патерн, що й `text/run-v8r` до фіксу).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { lint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('text/markdownlint detector', () => {
  test('markdown без топ-рівневого заголовка (MD041) → violation несе file+rule+опис', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.cursor'), { recursive: true })
      await writeFile(join(dir, 'bad.md'), 'без заголовка на першому рядку\n', 'utf8')

      const { violations } = await lint({ cwd: dir, ruleId: 'text', concernId: 'markdownlint', files: undefined })
      const mdViolation = violations.find(v => v.reason === 'markdownlint')

      expect(mdViolation).toBeDefined()
      expect(mdViolation.message).toContain('bad.md')
      expect(mdViolation.message).toContain('MD041')
    })
  })

  test('валідний markdown → без markdownlint-violation', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'good.md'), '# Заголовок\n\nАбзац тексту.\n', 'utf8')

      const { violations } = await lint({ cwd: dir, ruleId: 'text', concernId: 'markdownlint', files: undefined })
      expect(violations.find(v => v.reason === 'markdownlint')).toBeUndefined()
    })
  })
})
