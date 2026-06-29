/**
 * Тести правила ci4.mdc (concern marksman_config): копіювання canonical
 * `.marksman.toml` baseline у корінь cwd з ідемпотентністю на повторних прогонах.
 */
import { describe, expect, test } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { main as check } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CORE_SECTION_RE = /^\[core\]/m
const COMPLETION_SECTION_RE = /^\[completion\]/m
const CODE_ACTION_SECTION_RE = /^\[code_action\]/m

describe('check ci4.marksman_config', () => {
  test('успіх: порожній cwd → .marksman.toml створюється з baseline', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
      const target = join(dir, '.marksman.toml')
      expect(existsSync(target)).toBe(true)
      const content = await readFile(target, 'utf8')
      expect(content).toContain('markdown.glfm = true')
      expect(content).toContain('wiki.style = "file-stem"')
      expect(content).toContain('toc.enable = true')
    })
  })

  test('idempotency: повторний прогон не перетирає існуючий .marksman.toml', async () => {
    await withTmpDir(async dir => {
      const target = join(dir, '.marksman.toml')
      const customContent = '# user-customized config\n[core]\nmarkdown.glfm = false\n'
      await writeFile(target, customContent)
      expect(await check(dir)).toBe(0)
      const after = await readFile(target, 'utf8')
      expect(after).toBe(customContent)
    })
  })

  test('успіх: створений файл — валідний TOML із очікуваними секціями', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
      const content = await readFile(join(dir, '.marksman.toml'), 'utf8')
      expect(content).toMatch(CORE_SECTION_RE)
      expect(content).toMatch(COMPLETION_SECTION_RE)
      expect(content).toMatch(CODE_ACTION_SECTION_RE)
    })
  })

  test('код виходу 0 у обох сценаріях (створено vs існує)', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
      expect(await check(dir)).toBe(0)
    })
  })
})
