/**
 * Тести concern-а abie/js/env_dns: для кожного `*.dev.env`/`*.ua.env` усі URL
 * `http://<svc>.<ns>.svc.<dns>` мають відповідати кластеру за іменем файла.
 * Помилки виявлення/читання спливають як violation, відсутність файлів — clean.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { lint } from '../main.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const ruleId = 'rules/abie'
const concernId = 'rules/abie/env_dns'
const run = dir => lint({ cwd: dir, ruleId, concernId, files: undefined })

describe('abie env_dns concern', () => {
  test('репозиторій без env-файлів → clean (skip з повідомленням про пропуск)', async () => {
    await withTmpDir(async dir => {
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('коректний dev.env з валідним URL → clean', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(
        join(dir, 'pkg/dev.env'),
        'API_URL=http://auth-run-hl.dev-pkg.svc.abie-dev.internal:8080\n',
        'utf8'
      )
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('коректний ua.env з валідним URL → clean', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/ua.env'), 'API_URL=http://file-link-hl.ua-pkg.svc.abie-ua.internal\n', 'utf8')
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('dev.env з URL для іншого кластера (abie-ua) → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/dev.env'), 'API_URL=http://x.dev-y.svc.abie-ua.internal\n', 'utf8')
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })

  test('ua.env з намспейсом без префікса ua- → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/ua.env'), 'API_URL=http://x.dev-y.svc.abie-ua.internal\n', 'utf8')
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })

  test('файл `.env` (локальний без імені) — НЕ перевіряється', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/.env'), 'API_URL=http://x.y.svc.bad.internal\n', 'utf8')
      expect((await run(dir)).violations).toEqual([])
    })
  })

  test('кілька env-файлів — один невалідний → violation', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'a'))
      await ensureDir(join(dir, 'b'))
      await writeFile(join(dir, 'a/dev.env'), 'API_URL=http://x.dev-a.svc.abie-dev.internal\n', 'utf8')
      await writeFile(join(dir, 'b/ua.env'), 'API_URL=http://x.dev-b.svc.abie-ua.internal\n', 'utf8')
      expect((await run(dir)).violations.length).toBeGreaterThan(0)
    })
  })
})
