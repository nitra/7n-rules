import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ensureDir, withTmpCwd } from '../../../../scripts/utils/test-helpers.mjs'
import { check } from '../sample_secret.mjs'

describe('security/js/sample_secret/check', () => {
  test('pass: прикладних файлів немає', async () => {
    await withTmpCwd(async () => {
      await writeFile('README.md', '# hello\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('pass: .env.example з канонічним sample-secret', async () => {
    await withTmpCwd(async () => {
      const canonicalPlaceholder = ['sample', 'secret'].join('-')
      await writeFile('.env.example', `DB_PASSWORD=${canonicalPlaceholder}\n`, 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('fail: .env.example з bare secret', async () => {
    await withTmpCwd(async () => {
      await writeFile('.env.example', 'DB_PASSWORD=secret\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('fail: *.sample (YAML) зі значенням "secret" у лапках', async () => {
    await withTmpCwd(async () => {
      await writeFile('config.sample', 'password: "secret"\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('fail: *.dist з =>-присвоєнням (PHP-стиль)', async () => {
    await withTmpCwd(async () => {
      await writeFile('app.php.dist', "<?php return ['password' => 'secret'];\n", 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('fail: файл усередині каталогу fixtures/', async () => {
    await withTmpCwd(async () => {
      await ensureDir(join('test', 'fixtures'))
      await writeFile(join('test', 'fixtures', 'tokens.env'), 'TOKEN=secret\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('pass: ключ з іменем *_secret і реальним значенням не чіпається', async () => {
    await withTmpCwd(async () => {
      await writeFile('.env.example', 'CLIENT_SECRET=replace-me\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('pass: secret лише як частина значення (secret-key) не матчиться', async () => {
    await withTmpCwd(async () => {
      await writeFile('.env.example', 'API_KEY=secret-key\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('pass: не-прикладний .env не сканується', async () => {
    await withTmpCwd(async () => {
      await writeFile('.env', 'DB_PASSWORD=secret\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })
})
