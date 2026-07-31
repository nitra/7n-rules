/**
 * Тести concern-а abie/js/env_dns: для кожного `*.dev.env`/`*.ua.env` усі URL
 * `http(s)://<svc>.<ns>.svc.<dns>` мають відповідати кластеру за іменем файла.
 * Помилки виявлення/читання спливають як violation, відсутність файлів — clean.
 *
 * Прогін — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (F2 фази 5 батчу 2), concern тепер живе лише в
 * `crates/rules-core/src/concerns/env_dns.rs` і виконується через native-гілку
 * `runConcernDetector`. Lib-модуль `../lib/env-dns.mjs` лишається — його юніт-тести
 * (`npm/rules/abie/lib/tests/env-dns.test.mjs`) не чіпаються цим портом.
 */
import { describe, expect, test } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

// Короткий формат ruleId/concernId — узгоджений з `NATIVE_CONCERNS` (`abie/env_dns`).
const ruleId = 'abie'
const concernId = 'env_dns'
const run = dir => runConcernDetector(CONCERN, { cwd: dir, ruleId, concernId, files: undefined })

describe('abie env_dns concern', () => {
  test('репозиторій без env-файлів → clean (skip з повідомленням про пропуск)', async () => {
    await withTmpDir(async dir => {
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('коректний dev.env з валідним URL → clean', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(
        join(dir, 'pkg/dev.env'),
        'API_URL=https://auth-run-hl.dev-pkg.svc.abie-dev.internal:8080\n',
        'utf8'
      )
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('коректний ua.env з валідним URL → clean', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/ua.env'), 'API_URL=https://file-link-hl.ua-pkg.svc.abie-ua.internal\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('dev.env з URL для іншого кластера (abie-ua) → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/dev.env'), 'API_URL=https://x.dev-y.svc.abie-ua.internal\n', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('ua.env з намспейсом без префікса ua- → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/ua.env'), 'API_URL=https://x.dev-y.svc.abie-ua.internal\n', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('файл `.env` (локальний без імені) — НЕ перевіряється', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/.env'), 'API_URL=https://x.y.svc.bad.internal\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('кілька env-файлів — один невалідний → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'a'))
      await ensureDir(join(dir, 'b'))
      await writeFile(join(dir, 'a/dev.env'), 'API_URL=https://x.dev-a.svc.abie-dev.internal\n', 'utf8')
      await writeFile(join(dir, 'b/ua.env'), 'API_URL=https://x.dev-b.svc.abie-ua.internal\n', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })
})
