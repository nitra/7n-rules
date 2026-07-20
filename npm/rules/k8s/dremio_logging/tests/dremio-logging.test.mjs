/**
 * E2E-тести концерну `k8s/dremio_logging` через policy-adapter (`evaluatePolicyConcern`):
 * повний шлях walkGlob-резолв → conftest із XML-парсером (інференція за розширенням
 * `.xml`) → нормалізовані violations. Пер-документна семантика deny-правил покрита
 * `dremio_logging_test.rego` (conftest verify); тут — саме інтеграційний шар,
 * якого rego-тести не бачать: glob, XML-парсинг реального файлу, per-file
 * репортинг env-копій без крос-файлової дедуплікації.
 *
 * Фікстури logback.xml збираються динамічно у tmp-каталогах (не в репо).
 * Без `conftest` у PATH прогін пропускається (як у policy-test-step).
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluatePolicyConcern } from '../../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'
import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json` і rego). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Обов'язкові FQCN — дзеркало `required_loggers` з dremio_logging.rego. */
const REQUIRED_FQCN = [
  'com.dremio.sabot.exec.fragment.FragmentExecutor',
  'com.dremio.sabot.exec.fragment.FragmentStatusReporter',
  'com.dremio.sabot.exec.QueryTicket',
  'com.dremio.service.reflection.descriptor.MaterializationCache',
  'com.dremio.exec.planner.plancache.PlanCacheSynchronizer',
  'com.dremio.exec.planner.plancache.CacheRefresher',
  'com.dremio.sabot.exec.FragmentExecutors'
]

const hasConftest = Boolean(resolveCmd('conftest'))

/**
 * Рендерить мінімальний logback.xml із заданими <logger>-рядками.
 * @param {string[]} loggerLines рядки `<logger …/>` (можливо порожні)
 * @returns {string} вміст logback.xml
 */
const renderLogback = loggerLines => `<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <appender name="console" class="ch.qos.logback.core.ConsoleAppender">
    <encoder><pattern>%d %m%n</pattern></encoder>
  </appender>
${loggerLines.map(l => `  ${l}`).join('\n')}
  <root level="info">
    <appender-ref ref="console"/>
  </root>
</configuration>
`

/** Усі шість валідних WARN-оверрайдів. */
const allWarnLines = REQUIRED_FQCN.map(n => `<logger name="${n}" level="warn"/>`)

/**
 * Записує logback.xml за відносним шляхом у tmp-проєкті.
 * @param {string} dir корінь tmp-проєкту
 * @param {string} rel відносний шлях файлу
 * @param {string[]} loggerLines рядки `<logger …/>`
 * @returns {Promise<void>}
 */
const writeLogback = async (dir, rel, loggerLines) => {
  await ensureDir(join(dir, dirname(rel)))
  await writeFile(join(dir, rel), renderLogback(loggerLines), 'utf8')
}

/**
 * Запускає концерн у whole-repo режимі над tmp-проєктом.
 * @param {string} dir корінь tmp-проєкту
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]>} порушення
 */
const check = async dir => {
  const { violations } = await evaluatePolicyConcern(
    { cwd: dir, ruleId: 'k8s', concernId: 'dremio_logging', files: undefined },
    { engine: 'rego', policyDir: CONCERN_DIR, files: { walkGlob: '**/dremio_v2/config/logback.xml' } }
  )
  return violations
}

describe.skipIf(!hasConftest)('k8s/dremio_logging (e2e через conftest)', () => {
  test('валідний logback.xml з усіма WARN-оверрайдами — без порушень', async () => {
    await withTmpDir(async dir => {
      await writeLogback(dir, 'dev/dremio_v2/config/logback.xml', allWarnLines)
      expect(await check(dir)).toEqual([])
    })
  })

  test('без оверрайдів — порушення на кожен обовʼязковий FQCN із шляхом файлу', async () => {
    await withTmpDir(async dir => {
      await writeLogback(dir, 'dev/dremio_v2/config/logback.xml', [])
      const violations = await check(dir)
      expect(violations.length).toBe(REQUIRED_FQCN.length)
      for (const v of violations) {
        expect(v.file).toBe('dev/dremio_v2/config/logback.xml')
        expect(v.reason).toBe('policy-deny')
      }
      for (const fqcn of REQUIRED_FQCN) {
        expect(violations.some(v => v.message.includes(fqcn))).toBe(true)
      }
    })
  })

  test('env-копії перевіряються окремо: зламана ua/ флагується, валідна dev/ — ні', async () => {
    await withTmpDir(async dir => {
      await writeLogback(dir, 'dev/dremio_v2/config/logback.xml', allWarnLines)
      // ua/: один оверрайд ослаблено до info, решта warn
      const uaLines = [
        `<logger name="${REQUIRED_FQCN[0]}" level="info"/>`,
        ...REQUIRED_FQCN.slice(1).map(n => `<logger name="${n}" level="warn"/>`)
      ]
      await writeLogback(dir, 'ua/dremio_v2/config/logback.xml', uaLines)
      const violations = await check(dir)
      expect(violations.length).toBe(1)
      expect(violations[0].file).toBe('ua/dremio_v2/config/logback.xml')
      expect(violations[0].message).toContain(REQUIRED_FQCN[0])
    })
  })

  test('logback.xml поза dremio_v2/config не перевіряється', async () => {
    await withTmpDir(async dir => {
      await writeLogback(dir, 'other/logback.xml', [])
      await writeLogback(dir, 'dev/dremio_v2/logback.xml', [])
      expect(await check(dir)).toEqual([])
    })
  })
})
