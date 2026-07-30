/**
 * Тести JS-доповнення `k8s.dremio_logging` для `dremio_v2/templates/zookeeper.yaml`
 * (Helm-темплейт, Go-template синтаксис — не rego, див. doc-комент native-порту)
 * — через `runConcernDetector` (dispatch-рівень), не пряма функція. JS `main.mjs`
 * і його експорт `zkLogbackRootLevelViolation` видалені (E2 фази 5
 * `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`); concern тепер живе
 * лише в `crates/rules-core/src/concerns/dremio_logging.rs` (функція
 * `zk_logback_root_level_violation`) і виконується через native-гілку
 * `runConcernDetector` — тому саме dispatch і є parity-гейтом: кожен колишній
 * unit-кейс тут — фікстура `dremio_v2/templates/zookeeper.yaml` у tmp-проєкті,
 * передана через `ctx.files` (per-file scope цього концерну).
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

/** Відносний шлях фікстури — той самий, що й `lint.glob` у `concern.json`. */
const REL = 'dremio_v2/templates/zookeeper.yaml'

/**
 * Пише фікстуру `zookeeper.yaml` у tmp-проєкт і прогонить `k8s/dremio_logging`
 * через dispatch (per-file, `ctx.files = [REL]`).
 * @param {string} dir корінь tmp-проєкту
 * @param {string} content вміст фікстури
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]>} порушення
 */
const check = async (dir, content) => {
  await ensureDir(join(dir, dirname(REL)))
  await writeFile(join(dir, REL), content, 'utf8')
  const { violations } = await runConcernDetector(CONCERN, {
    cwd: dir,
    ruleId: 'k8s',
    concernId: 'dremio_logging',
    files: [REL]
  })
  return violations
}

describe('k8s/dremio_logging: zookeeper.yaml вбудований logback.xml root level', () => {
  test('немає вбудованого logback.xml — без порушень (не наша справа)', async () => {
    await withTmpDir(async dir => {
      const src = 'apiVersion: apps/v1\nkind: StatefulSet\nmetadata:\n  name: zk\n'
      expect(await check(dir, src)).toEqual([])
    })
  })

  test('root level="WARN" — без порушень (валідно)', async () => {
    await withTmpDir(async dir => {
      const src = [
        'data:',
        '  logback.xml: |',
        '    <configuration>',
        '      <root level="WARN">',
        '        <appender-ref ref="CONSOLE" />',
        '      </root>',
        '    </configuration>',
        ''
      ].join('\n')
      expect(await check(dir, src)).toEqual([])
    })
  })

  test('root level="ERROR"/"OFF" — теж валідно (строгіше за warn)', async () => {
    for (const level of ['ERROR', 'OFF', 'error', 'off']) {
      await withTmpDir(async dir => {
        const src = `data:\n  logback.xml: |\n    <root level="${level}">\n`
        expect(await check(dir, src)).toEqual([])
      })
    }
  })

  test('root level="INFO" — порушення', async () => {
    await withTmpDir(async dir => {
      const src = [
        'data:',
        '  logback.xml: |',
        '    <configuration>',
        '      <root level="INFO">',
        '        <appender-ref ref="CONSOLE" />',
        '      </root>',
        '    </configuration>',
        ''
      ].join('\n')
      const violations = await check(dir, src)
      expect(violations.length).toBe(1)
      expect(violations[0].reason).toBe('zk-logback-root-level')
      expect(violations[0].message).toContain('INFO')
      expect(violations[0].message.startsWith(REL)).toBe(true)
    })
  })

  test('логер-вміст присутній, але <root> відсутній — порушення', async () => {
    await withTmpDir(async dir => {
      const src =
        'data:\n  logback.xml: |\n    <configuration>\n      <appender name="CONSOLE" />\n    </configuration>\n'
      const violations = await check(dir, src)
      expect(violations.length).toBe(1)
      expect(violations[0].message).toContain('без <root level')
    })
  })

  test('case-insensitive: level="Warn" — валідно', async () => {
    await withTmpDir(async dir => {
      const src = 'data:\n  logback.xml: |\n    <root level="Warn">\n'
      expect(await check(dir, src)).toEqual([])
    })
  })
})
