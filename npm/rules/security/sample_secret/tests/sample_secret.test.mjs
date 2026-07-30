/**
 * Тести `security/sample_secret` — через `runConcernDetector` (dispatch-рівень).
 * JS `main.mjs` видалений (E2 фази 5 `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`),
 * concern тепер живе лише в `crates/rules-core/src/concerns/sample_secret.rs` і
 * виконується через native-гілку `runConcernDetector` — тому саме dispatch і є
 * parity-гейтом, а не виклик функції напряму.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

const run = dir =>
  runConcernDetector(CONCERN, { cwd: dir, ruleId: 'security', concernId: 'sample_secret', files: undefined })

describe('security/js/sample_secret/check', () => {
  test('pass: прикладних файлів немає', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'README.md'), '# hello\n', 'utf8')
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })

  test('pass: .env.example з канонічним sample-secret', async () => {
    await withTmpDir(async dir => {
      const canonicalPlaceholder = ['sample', 'secret'].join('-')
      await writeFile(join(dir, '.env.example'), `DB_PASSWORD=${canonicalPlaceholder}\n`, 'utf8')
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })

  test('fail: .env.example з bare secret', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.env.example'), 'DB_PASSWORD=secret\n', 'utf8')
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test('fail: *.sample (YAML) зі значенням "secret" у лапках', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'config.sample'), 'password: "secret"\n', 'utf8')
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test('fail: *.dist з =>-присвоєнням (PHP-стиль)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'app.php.dist'), "<?php return ['password' => 'secret'];\n", 'utf8')
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test('fail: файл усередині каталогу fixtures/', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'test', 'fixtures'))
      await writeFile(join(dir, 'test', 'fixtures', 'tokens.env'), 'TOKEN=secret\n', 'utf8')
      const res = await run(dir)
      expect(res.violations.length).toBeGreaterThan(0)
    })
  })

  test('pass: ключ з іменем *_secret і реальним значенням не чіпається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.env.example'), 'CLIENT_SECRET=replace-me\n', 'utf8')
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })

  test('pass: secret лише як частина значення (secret-key) не матчиться', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.env.example'), 'API_KEY=secret-key\n', 'utf8')
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })

  test('pass: не-прикладний .env не сканується', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.env'), 'DB_PASSWORD=secret\n', 'utf8')
      const res = await run(dir)
      expect(res.violations).toEqual([])
    })
  })
})
