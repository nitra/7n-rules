/**
 * Тести run-dotenv-linter.mjs: авто-фікс і фінальний check через рекурсивний режим
 * `dotenv-linter` з виключенням `node_modules` і `.envrc`.
 */
import { describe, expect, test } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runDotenvLinter } from '../run-dotenv-linter.mjs'
import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('run-dotenv-linter.mjs', () => {
  test('runDotenvLinter повертає 0 коли .env*-файлів немає', async () => {
    if (!resolveCmd('dotenv-linter')) {
      expect(true).toBe(true)
      return
    }
    await withTmpDir(dir => {
      expect(runDotenvLinter(dir)).toBe(0)
    })
  })

  test('runDotenvLinter авто-виправляє LowercaseKey і завершується з 0', async () => {
    if (!resolveCmd('dotenv-linter')) {
      expect(true).toBe(true)
      return
    }
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.env'), 'foo=bar\n', 'utf8')
      expect(runDotenvLinter(dir)).toBe(0)
      const fixed = await readFile(join(dir, '.env'), 'utf8')
      expect(fixed).toContain('FOO=bar')
    })
  })

  test('runDotenvLinter не перевіряє файли в node_modules і .envrc', async () => {
    if (!resolveCmd('dotenv-linter')) {
      expect(true).toBe(true)
      return
    }
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'node_modules/pkg'))
      // у node_modules — навмисно битий .env (lowercase key); .envrc — direnv-синтаксис.
      await writeFile(join(dir, 'node_modules/pkg/.env'), 'bad=1\n', 'utf8')
      await writeFile(join(dir, '.envrc'), 'export FOO=bar\nsource_url "https://example.com"\n', 'utf8')
      // tracked-файл валідний — перевірка має пройти, попри присутність виключених шляхів.
      await writeFile(join(dir, '.env'), 'FOO=bar\n', 'utf8')
      expect(runDotenvLinter(dir)).toBe(0)
    })
  })
})
