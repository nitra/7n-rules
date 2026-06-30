/**
 * Тести правила ci4.mdc (concern marksman_config): детектор відсутнього `.marksman.toml`
 * і T0-патерн копіювання canonical baseline.
 */
import { describe, expect, test } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { patterns } from '../fix-marksman_config.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const ruleId = 'rules/ci4'
const concernId = 'rules/ci4/marksman_config'

const CORE_SECTION_RE = /^\[core\]/m
const COMPLETION_SECTION_RE = /^\[completion\]/m
const CODE_ACTION_SECTION_RE = /^\[code_action\]/m

describe('lint ci4.marksman_config', () => {
  test('violation коли .marksman.toml відсутній', async () => {
    await withTmpDir(async dir => {
      const { violations } = await lint({ cwd: dir, ruleId, concernId, files: undefined })
      expect(violations).toHaveLength(1)
      expect(violations[0].data?.kind).toBe('marksman-config-missing')
    })
  })

  test('чисто коли .marksman.toml існує', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.marksman.toml'), '# custom\n')
      const { violations } = await lint({ cwd: dir, ruleId, concernId, files: undefined })
      expect(violations).toHaveLength(0)
    })
  })
})

describe('T0 fix ci4.marksman_config', () => {
  const pattern = patterns.find(p => p.id === 'ci4-marksman-config-missing')

  test('pattern існує', () => {
    expect(pattern).toBeDefined()
  })

  test('копіює baseline і повертає touchedFiles', async () => {
    await withTmpDir(async dir => {
      const violations = [{ reason: 'marksman-config-missing', message: '', data: { kind: 'marksman-config-missing' } }]
      const ctx = { cwd: dir, ruleId, concernId }
      const result = await pattern.apply(violations, ctx)
      const target = join(dir, '.marksman.toml')
      expect(existsSync(target)).toBe(true)
      expect(result.touchedFiles).toHaveLength(1)
      expect(result.touchedFiles[0]).toBe(target)
      const content = await readFile(target, 'utf8')
      expect(content).toMatch(CORE_SECTION_RE)
      expect(content).toMatch(COMPLETION_SECTION_RE)
      expect(content).toMatch(CODE_ACTION_SECTION_RE)
    })
  })

  test('після T0 lint повертає 0 violations', async () => {
    await withTmpDir(async dir => {
      const violations = [{ reason: 'marksman-config-missing', message: '', data: { kind: 'marksman-config-missing' } }]
      await pattern.apply(violations, { cwd: dir, ruleId, concernId })
      const { violations: after } = await lint({ cwd: dir, ruleId, concernId, files: undefined })
      expect(after).toHaveLength(0)
    })
  })

  test('idempotency: існуючий файл не перетирається', async () => {
    await withTmpDir(async dir => {
      const target = join(dir, '.marksman.toml')
      const customContent = '# user-customized\n[core]\nmarkdown.glfm = false\n'
      await writeFile(target, customContent)
      // lint має бути чистим — файл вже існує
      const { violations } = await lint({ cwd: dir, ruleId, concernId, files: undefined })
      expect(violations).toHaveLength(0)
      // вміст не змінився
      expect(await readFile(target, 'utf8')).toBe(customContent)
    })
  })
})
