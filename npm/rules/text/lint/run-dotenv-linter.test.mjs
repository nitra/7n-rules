/**
 * Тести run-dotenv-linter.mjs: авто-фікс і фінальний check через рекурсивний режим
 * `dotenv-linter` з виключенням `node_modules` і `.envrc`.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runDotenvLinter } from './run-dotenv-linter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { ensureDir, withTmpCwd } from '../../../scripts/utils/test-helpers.mjs'

describe('run-dotenv-linter.mjs', () => {
  test('runDotenvLinter повертає 0 коли .env*-файлів немає', async () => {
    if (!resolveCmd('dotenv-linter')) {
      expect(true).toBe(true)
      return
    }
    await withTmpCwd(() => {
      expect(runDotenvLinter(process.cwd())).toBe(0)
    })
  })

  test('runDotenvLinter авто-виправляє LowercaseKey і завершується з 0', async () => {
    if (!resolveCmd('dotenv-linter')) {
      expect(true).toBe(true)
      return
    }
    await withTmpCwd(async () => {
      await writeFile('.env', 'foo=bar\n', 'utf8')
      expect(runDotenvLinter(process.cwd())).toBe(0)
      const fixed = await Bun.file(join(process.cwd(), '.env')).text()
      expect(fixed).toContain('FOO=bar')
    })
  })

  test('runDotenvLinter не перевіряє файли в node_modules і .envrc', async () => {
    if (!resolveCmd('dotenv-linter')) {
      expect(true).toBe(true)
      return
    }
    await withTmpCwd(async () => {
      await ensureDir('node_modules/pkg')
      // у node_modules — навмисно битий .env (lowercase key); .envrc — direnv-синтаксис.
      await writeFile('node_modules/pkg/.env', 'bad=1\n', 'utf8')
      await writeFile('.envrc', 'export FOO=bar\nsource_url "https://example.com"\n', 'utf8')
      // tracked-файл валідний — перевірка має пройти, попри присутність виключених шляхів.
      await writeFile('.env', 'FOO=bar\n', 'utf8')
      expect(runDotenvLinter(process.cwd())).toBe(0)
    })
  })
})
