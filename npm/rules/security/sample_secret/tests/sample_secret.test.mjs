import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { lint } from '../main.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'security', concernId: 'sample_secret', files: undefined })

describe('security/js/sample_secret/check', () => {
  test('pass: прикладних файлів немає', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'README.md'), '# hello\n', 'utf8')
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('pass: .env.example з канонічним sample-secret', async () => {
    await withTmpDir(async dir => {
      const canonicalPlaceholder = ['sample', 'secret'].join('-')
      await writeFile(join(dir, '.env.example'), `DB_PASSWORD=${canonicalPlaceholder}\n`, 'utf8')
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('fail: .env.example з bare secret', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.env.example'), 'DB_PASSWORD=secret\n', 'utf8')
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })

  test('fail: *.sample (YAML) зі значенням "secret" у лапках', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'config.sample'), 'password: "secret"\n', 'utf8')
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })

  test('fail: *.dist з =>-присвоєнням (PHP-стиль)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'app.php.dist'), "<?php return ['password' => 'secret'];\n", 'utf8')
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })

  test('fail: файл усередині каталогу fixtures/', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'test', 'fixtures'))
      await writeFile(join(dir, 'test', 'fixtures', 'tokens.env'), 'TOKEN=secret\n', 'utf8')
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })

  test('pass: ключ з іменем *_secret і реальним значенням не чіпається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.env.example'), 'CLIENT_SECRET=replace-me\n', 'utf8')
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('pass: secret лише як частина значення (secret-key) не матчиться', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.env.example'), 'API_KEY=secret-key\n', 'utf8')
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('pass: не-прикладний .env не сканується', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.env'), 'DB_PASSWORD=secret\n', 'utf8')
      expect((await run(dir)).violations).toEqual([])
    })
  })
})
