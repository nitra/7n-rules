/**
 * Диференційний parity-гейт R2 зрізу 3 фази 7
 * (`docs/specs/2026-07-30-rules-v2-rust-core-migration.md`): звіряє
 * batch-виконання суцільних builtin-native сегментів плану
 * (`runNativeSegmentSync`, `run-detectors.mjs`, один `runNativeConcernsBatch`-
 * napi-виклик на сегмент) проти чинного per-item шляху — БЕЗ заморожування
 * окремої копії алгоритму (на відміну від `lint-render-native-parity.test.mjs`):
 * per-item шлях і сьогодні лишається живим production-кодом у
 * `detectPlanConcurrently` (`N_RULES_LINT_CONCURRENCY>1` — свідомо НЕ
 * зачеплений цим зрізом, доккомент `run-detectors.mjs`), тож "прапорець"
 * тут — саме ця env-змінна: `1` (дефолт) вмикає новий batch-шлях
 * (`detectPlanSequentially`), `>1` лишає старий per-item шлях
 * (`detectPlanConcurrently` → `runConcernDetector` на кожен item окремо,
 * включно з native — `runNativeConcern`, не `runNativeConcernsBatch`).
 *
 * Мікс builtin-native (`abie/env_dns`, `capacitor/platforms`,
 * `text/forbidden-prettier`) + JS main.mjs concern (`b-js/check`) — рядок
 * рулідів навмисно обраний так, щоб JS-concern опинився МІЖ двома
 * native-рулідами в алфавітному порядку плану (`abie` < `b-js` < `capacitor`
 * < `text`), тож новий шлях реально розбиває план на ТРИ сегменти
 * (native[abie] → single[b-js] → native[capacitor,text]), а не один суцільний
 * батч — сегментація перевіряється не лише "групуй усе native", а й
 * "розривай на межі не-native item-а".
 *
 * Другий describe-блок — error-семантика: `changelog/presence` з
 * пошкодженим change-файлом (`RulesError` із реального native-концерну, той
 * самий fixture, що `crates/rules-core/src/concerns/changelog_presence.rs`
 * тест `malformed_change_file_propagates_error`) усередині native-сегменту з
 * items ДО і ПІСЛЯ помилки — звіряє формат повідомлення `DetectorError`
 * (`detector <ruleId>/<concernId>: native concern кинув: <message>`) і те, що
 * items ПІСЛЯ помилки не потрапляють у `ran`/`violations` (native фізично
 * рахує їх — `run_concerns_batch` fail-soft, doc-комент
 * `crates/rules-core/src/concerns/batch.rs` — але JS-бік їх відкидає, той
 * самий контракт, що дав би early-return per-item циклу).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { detectAll } from '../run-detectors.mjs'
import { withTmpDir, writeJson } from '../../../utils/test-helpers.mjs'

/**
 * Сідить concern у tmp rulesDir. Для native-ключів (`ruleId/concernId` у
 * `NATIVE_CONCERNS`) main.mjs НЕ потрібен (native-гілка `runConcernDetector`
 * перевіряється ПЕРШОЮ і ніколи не доходить до `import(main.mjs)`) — тут він
 * усе одно пишеться, але з тілом, що кидає: якщо маршрутизація колись
 * помилково провалиться на JS-гілку, тест впаде голосно, а не мовчки видасть
 * правдоподібний, але хибний результат.
 * @param {string} rulesDir корінь tmp rulesDir
 * @param {string} rule id правила
 * @param {string} concern id concern-а
 * @param {object} lintSurface lint-блок concern.json
 * @param {string} [mainBody] тіло main.mjs; дефолт — "не повинно викликатись".
 */
async function seedConcern(
  rulesDir,
  rule,
  concern,
  lintSurface,
  mainBody = "export function lint() { throw new Error('native routing regression: main.mjs викликано для native-ключа') }\n"
) {
  const dir = join(rulesDir, rule, concern)
  await mkdir(dir, { recursive: true })
  await writeJson(join(dir, 'concern.json'), { lint: lintSurface })
  await writeFile(join(dir, 'main.mjs'), mainBody, 'utf8')
}

/** Ключ `ruleId/concernId` порядку, стійкий до відмінностей у `ran`-порядку між sequential/concurrent прогонами. */
const keyOf = e => `${e.ruleId}/${e.concern.name}`

describe('R2 зрізу 3 фази 7 — batch native-сегменти vs per-item (N_RULES_LINT_CONCURRENCY=1 vs >1)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /**
   * Будує rulesDir із міксом native (abie/env_dns, capacitor/platforms,
   * text/forbidden-prettier) + JS (b-js/check) — детально в doc-коменті модуля.
   * @param {string} dir tmp-корінь
   * @returns {Promise<string>} rulesDir
   */
  async function seedMixedRules(dir) {
    const rulesDir = join(dir, 'rules')
    await seedConcern(rulesDir, 'abie', 'env_dns', { scope: 'full', glob: [] })
    await seedConcern(
      rulesDir,
      'b-js',
      'check',
      { scope: 'per-file', glob: ['**/*'] },
      "export function lint() { return { violations: [{ reason: 'js-probe', message: 'js concern ran' }] } }\n"
    )
    await seedConcern(rulesDir, 'capacitor', 'platforms', { scope: 'full', glob: [] })
    await seedConcern(rulesDir, 'text', 'forbidden-prettier', { scope: 'full', glob: [] })
    await writeJson(join(dir, '.n-rules.json'), { rules: ['abie', 'b-js', 'capacitor', 'text'] })
    return rulesDir
  }

  test('чистий репо: batch-шлях і per-item шлях дають однакові violations/ran/exitCode', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedMixedRules(dir)

      const batched = await detectAll({ rulesDir, cwd: dir, full: true, log: () => {} })

      vi.stubEnv('N_RULES_LINT_CONCURRENCY', '2')
      const perItem = await detectAll({ rulesDir, cwd: dir, full: true, log: () => {} })
      vi.unstubAllEnvs()

      expect(batched.exitCode).toBe(perItem.exitCode)
      // `violations` — уже SORTED-вихід native `sortAndRenderViolations` (R1 фази 7)
      // в обох випадках, тож порядок детерміновано незалежно від виконання — пряме toEqual.
      expect(batched.violations).toEqual(perItem.violations)
      expect(batched.ran.map(keyOf).toSorted()).toEqual(perItem.ran.map(keyOf).toSorted())
      // b-js/check — єдиний violation-джерело на чистому дереві.
      expect(batched.violations.map(v => v.reason)).toEqual(['js-probe'])
    })
  })

  test('з .prettierrc (native-violation) + b-js: ідентичний результат обох шляхів', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedMixedRules(dir)
      await writeFile(join(dir, '.prettierrc'), '{}\n', 'utf8')

      const batched = await detectAll({ rulesDir, cwd: dir, full: true, log: () => {} })

      vi.stubEnv('N_RULES_LINT_CONCURRENCY', '2')
      const perItem = await detectAll({ rulesDir, cwd: dir, full: true, log: () => {} })
      vi.unstubAllEnvs()

      expect(batched.exitCode).toBe(perItem.exitCode)
      expect(batched.violations).toEqual(perItem.violations)
      expect(batched.ran.map(keyOf).toSorted()).toEqual(perItem.ran.map(keyOf).toSorted())
      // Два джерела violations: native (forbidden-prettier) + JS (b-js/check).
      expect(batched.violations.map(v => v.reason).toSorted()).toEqual(['forbidden-prettier', 'js-probe'])
    })
  })

  test('verbose progress-лог: batch-шлях логує ТІ САМІ рядки (concern/scope/файли), що per-item', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedMixedRules(dir)
      const batchedLogs = []
      await detectAll({ rulesDir, cwd: dir, full: true, verbose: true, log: s => batchedLogs.push(s) })

      vi.stubEnv('N_RULES_LINT_CONCURRENCY', '2')
      const perItemLogs = []
      await detectAll({ rulesDir, cwd: dir, full: true, verbose: true, log: s => perItemLogs.push(s) })
      vi.unstubAllEnvs()

      /** Витягує `🔍 key [scope] → N` рядки незалежно від порядку прогону. */
      const preRunLines = logs =>
        logs
          .join('')
          .split('\n')
          .filter(l => l.includes('🔍'))
          .map(l => l.trim())
          .toSorted()
      expect(preRunLines(batchedLogs)).toEqual(preRunLines(perItemLogs))
    })
  })
})

describe('R2 зрізу 3 фази 7 — DetectorError-семантика в native-сегменті', () => {
  /**
   * rulesDir із native-сегментом [abie/env_dns (ok), capacitor/platforms (ok),
   * changelog/presence (ERROR — пошкоджений change-файл), text/forbidden-prettier
   * (ok, ПІСЛЯ помилки — не має потрапити в ran)], усі per-file/full з
   * glob `['**\/*']`, щоб `changelog/presence` отримав реальний `files`
   * (delta-режим — на відміну від `full`, де ВСІ items отримують
   * `files: undefined`, і `changelog/presence` завжди early-return `Ok([])`).
   * @param {string} dir tmp-корінь
   * @returns {Promise<string>} rulesDir
   */
  async function seedErrorSegment(dir) {
    const rulesDir = join(dir, 'rules')
    await seedConcern(rulesDir, 'abie', 'env_dns', { scope: 'full', glob: ['**/*'] })
    await seedConcern(rulesDir, 'capacitor', 'platforms', { scope: 'full', glob: ['**/*'] })
    await seedConcern(rulesDir, 'changelog', 'presence', { scope: 'per-file', glob: ['**/*'] })
    await seedConcern(rulesDir, 'text', 'forbidden-prettier', { scope: 'full', glob: ['**/*'] })
    await writeJson(join(dir, '.n-rules.json'), { rules: ['abie', 'capacitor', 'changelog', 'text'] })
    // Той самий fixture, що rules-core::concerns::changelog_presence::tests::malformed_change_file_propagates_error.
    await writeJson(join(dir, 'package.json'), { name: 'demo', version: '1.0.0' })
    await writeFile(join(dir, '.changes', '260702-1200.md'), 'garbage', 'utf8').catch(async () => {
      await mkdir(join(dir, '.changes'), { recursive: true })
      await writeFile(join(dir, '.changes', '260702-1200.md'), 'garbage', 'utf8')
    })
    return rulesDir
  }

  test('помилка в середині batch-сегменту → exit 2, ran містить лише items ДО помилки', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedErrorSegment(dir)
      const r = await detectAll({ rulesDir, cwd: dir, files: ['src/index.mjs'], log: () => {} })

      expect(r.exitCode).toBe(2)
      // abie/env_dns, capacitor/platforms — АЛФАВІТНО ДО changelog/presence, виконались і зібрались;
      // text/forbidden-prettier — ПІСЛЯ помилки в плановому порядку, у ran не потрапляє.
      expect(r.ran.map(keyOf)).toEqual(['abie/env_dns', 'capacitor/platforms'])
      expect(r.violations).toEqual([])
    })
  })

  test('DetectorError-формат batch-шляху === формат одиночного native-виклику', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedErrorSegment(dir)
      const logs = []
      await detectAll({ rulesDir, cwd: dir, files: ['src/index.mjs'], log: s => logs.push(s) })
      const infraLine = logs
        .join('')
        .split('\n')
        .find(l => l.includes('💥'))
      expect(infraLine).toBeDefined()
      // Той самий контракт, що `DetectorError` (`detect.mjs`): "detector <ruleId>/<concernId>: <detail>",
      // і `<detail>` для native-гілки — "native concern кинув: <message>" (`detect.mjs::runConcernDetector`).
      expect(infraLine).toContain('detector changelog/presence: native concern кинув:')
    })
  })
})
