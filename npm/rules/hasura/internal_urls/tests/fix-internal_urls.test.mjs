/**
 * Тести T0-фіксу `hasura/internal_urls`: виправлення `service`/`namespace`
 * розбіжностей у `HASURA_GRAPHQL_ENDPOINT`, збереження `cluster`/`port`.
 *
 * `lint(ctx)` тут — через `runConcernDetector` (dispatch-рівень): JS
 * `main.mjs` видалений (I1 фази 5 батчу 4, YAML-кластер частина 2), detector
 * тепер живе лише в `crates/rules-core/src/concerns/hasura_internal_urls.rs`.
 *
 * T0-фікс (T2 зрізу 5 фази 7): JS `fix-internal_urls.mjs` теж видалений —
 * rewrite-логіка тепер у `crates/rules-core/src/concerns/fix.rs`
 * (`run_concern_fix`), а JS-бік отримує синтетичний T0Pattern через
 * `loadT0Patterns` (`run-fix.mjs`, реєстр `NATIVE_FIXES`). Тести нижче
 * дзеркалять старі кейси через ЦЮ обгортку, не пряму функцію concern-а.
 * Нюанс dispatch-рівня: `test()` синтетичного патерна = «native-план
 * непорожній», тож reason-only перевірки старого JS `test()` стали
 * fixture-повними (план рахується від реального стану файлів).
 */
import { describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { createSnapshot } from '../../../../scripts/lib/lint-surface/snapshot.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs/fix-*.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

const ruleId = 'hasura'
const concernId = 'internal_urls'
const ctxFor = dir => ({ cwd: dir, ruleId, concernId, files: undefined })
const lint = ctx => runConcernDetector(CONCERN, ctx)
/**
 * Резолвить синтетичний native T0Pattern для `dir` (той самий, що бере реальний fix-pipeline).
 * @param {string} dir корінь тимчасового репо
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]>} T0-патерни concern-а
 */
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)

/**
 * Сідає fixture: nitra/abie-репо з `svc-hl.yaml` (Service `order-h`) і
 * `dev.env` зі старим service-сегментом URL.
 * @param {string} dir корінь тимчасового репо
 * @returns {Promise<void>}
 */
async function seedServiceMismatch(dir) {
  await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/abinbevefes/foo' })
  await mkdir(join(dir, 'hasura', 'k8s', 'base'), { recursive: true })
  await writeFile(
    join(dir, 'hasura', 'k8s', 'base', 'svc-hl.yaml'),
    'apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n',
    'utf8'
  )
  await writeFile(
    join(dir, 'dev.env'),
    'HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n',
    'utf8'
  )
}

describe('native-fix hasura/internal_urls (обгортка над T0Pattern)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern', async () => {
    await withTmpDir(async dir => {
      const patterns = await patternsFor(dir)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
    })
  })

  test('test: true лише на mismatch-причини з реальним фіксом, false інакше', async () => {
    await withTmpDir(async dir => {
      await seedServiceMismatch(dir)
      const [pattern] = await patternsFor(dir)
      const { violations } = await lint(ctxFor(dir))
      expect(violations[0].reason).toBe('internal-url-service-mismatch')
      expect(pattern.test(violations)).toBe(true)
      expect(pattern.test([])).toBe(false)
      // internal-url-invalid — НЕ T0-фікс (cluster/port нізвідки вивести).
      expect(pattern.test([{ reason: 'internal-url-invalid', message: 'm', file: 'dev.env' }])).toBe(false)
    })
  })

  test('apply: переписує service, зберігаючи namespace/cluster/port', async () => {
    await withTmpDir(async dir => {
      await seedServiceMismatch(dir)

      const { violations: before } = await lint(ctxFor(dir))
      expect(before).toHaveLength(1)
      expect(before[0].reason).toBe('internal-url-service-mismatch')

      const [pattern] = await patternsFor(dir)
      const res = await pattern.apply(before, { ...ctxFor(dir), recordWrite: vi.fn() })
      expect(res.touchedFiles).toHaveLength(1)
      // touchedFiles — абсолютні шляхи (доккомент `nativeFixPattern`, `run-fix.mjs`).
      expect(res.touchedFiles[0]).toBe(join(dir, 'dev.env'))

      const content = await readFile(join(dir, 'dev.env'), 'utf8')
      expect(content).toBe('HASURA_GRAPHQL_ENDPOINT=http://order-h.ua-contract.svc.abie-ua.internal:8080\n')

      const { violations: after } = await lint(ctxFor(dir))
      expect(after).toEqual([])
    })
  })

  test('apply: не чіпає структурно невалідний URL (internal-url-invalid)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/nitra/foo' })
      await writeFile(join(dir, 'dev.env'), 'HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n', 'utf8')

      const { violations: before } = await lint(ctxFor(dir))
      expect(before[0].reason).toBe('internal-url-invalid')

      const [pattern] = await patternsFor(dir)
      expect(pattern.test(before)).toBe(false)
      const res = await pattern.apply(before, { ...ctxFor(dir), recordWrite: vi.fn() })
      expect(res.touchedFiles).toEqual([])

      const content = await readFile(join(dir, 'dev.env'), 'utf8')
      expect(content).toBe('HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n')
    })
  })

  test('rollback-контракт: ctx.recordWrite викликається ДО запису — rollback відновлює старий URL', async () => {
    await withTmpDir(async dir => {
      await seedServiceMismatch(dir)
      const envPath = join(dir, 'dev.env')
      const original = await readFile(envPath, 'utf8')
      const { violations } = await lint(ctxFor(dir))

      const snapshot = createSnapshot()
      let contentAtRecordWriteTime = null
      const ctx = {
        ...ctxFor(dir),
        recordWrite: absPath => {
          // recordWrite ДО write: pre-image ще ОРИГІНАЛЬНА — інакше rollback
          // відновлював би вже переписаний URL.
          contentAtRecordWriteTime = readFileSync(absPath, 'utf8')
          snapshot.record(absPath)
        }
      }
      const [pattern] = await patternsFor(dir)
      await pattern.apply(violations, ctx)
      expect(contentAtRecordWriteTime).toBe(original)
      expect(await readFile(envPath, 'utf8')).toContain('order-h.ua-contract')

      snapshot.rollback()
      expect(await readFile(envPath, 'utf8')).toBe(original)
    })
  })
})
