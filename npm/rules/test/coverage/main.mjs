/** @see ./docs/main.md */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { assertCoverageProvider } from '../../../scripts/lib/plugin-api.mjs'
import { readNRulesConfigLite } from '../../../scripts/lib/read-n-rules-config-lite.mjs'
import { getHandlers } from '../../../scripts/lib/resolve-plugins.mjs'
import { applyVerdicts } from './lib/classify/apply.mjs'
import { classify } from './lib/classify/index.mjs'

/** Дефолтний поріг line coverage, % (успадковано з `@7n/test` COVERAGE_THRESHOLD). */
const DEFAULT_COVERAGE_THRESHOLD = 80
/** Дефолтний поріг mutation score, % (рішення spec 2026-07-22, п. 3 підтверджених judgment calls). */
const DEFAULT_MUTATION_THRESHOLD = 80
/**
 * Дефолт confidence-порогу LLM-класифікації allowed-gaps: 1.1 = rollout-mode
 * (confidence ∈ [0,1], жоден мутант не виключається) — успадковано з `@7n/test`.
 */
const DEFAULT_CLASSIFY_THRESHOLD = 1.1

/**
 * Читає пороги з `.n-rules.json#coverage` (top-level обʼєкт — `rules` у схемі
 * є масивом id, тож per-rule конфіг там неможливий; зафіксоване відхилення
 * від спеки absorb-7n-test п. 2.7 dev-design).
 * @param {string} cwd корінь проєкту
 * @returns {Promise<{coverage: number, mutation: number, classify: number}>} пороги (coverage/mutation — %, classify — confidence [0..1] або 1.1 = вимкнено)
 */
export async function readThresholds(cwd) {
  const defaults = {
    coverage: DEFAULT_COVERAGE_THRESHOLD,
    mutation: DEFAULT_MUTATION_THRESHOLD,
    classify: DEFAULT_CLASSIFY_THRESHOLD
  }
  const configPath = join(cwd, '.n-rules.json')
  if (!existsSync(configPath)) return defaults
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'))
    const c = parsed?.coverage
    return {
      coverage: typeof c?.coverageThreshold === 'number' ? c.coverageThreshold : defaults.coverage,
      mutation: typeof c?.mutationThreshold === 'number' ? c.mutationThreshold : defaults.mutation,
      classify: typeof c?.classifyConfidenceThreshold === 'number' ? c.classifyConfidenceThreshold : defaults.classify
    }
  } catch {
    return defaults
  }
}

/**
 * Резолвить активні coverage-провайдери мовних плагінів (порт `coverage`
 * plugin-api, реєстрація через `contributes.handlers.coverage`).
 * @param {string} cwd корінь проєкту
 * @returns {Promise<Array<import('../../../scripts/lib/plugin-api.mjs').CoverageProvider>>} валідні провайдери
 */
async function resolveProviders(cwd) {
  const config = await readNRulesConfigLite(cwd)
  const providers = []
  for (const handler of getHandlers(cwd, config, 'coverage')) {
    const mod = await import(pathToFileURL(handler.modulePath).href)
    providers.push(assertCoverageProvider(mod.default, handler.pluginName))
  }
  return providers
}

/**
 * Відсоток `covered/total`; `null` коли вимірювати нічого (total 0).
 * @param {number} covered покрито
 * @param {number} total всього
 * @returns {number|null} відсоток або null
 */
function pct(covered, total) {
  return total === 0 ? null : (covered / total) * 100
}

/**
 * Гейт покриття/мутаційного тестування (spec 2026-07-22 absorb-7n-test).
 *
 * Делта (`ctx.files`): легкий per-file line coverage змінених файлів через
 * `provider.collectPerFile` — БЕЗ мутаційки; порушення = файл нижче порогу.
 * Full/`lint test` (`ctx.files === undefined`): повний вимір
 * `provider.collect` (coverage + мутаційка + Storybook-вимір); порушення =
 * область нижче порогу line coverage або mutation score (survived-мутанти
 * йдуть у `data` порушення — вхід fix-worker-а).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} порушення гейта
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd
  const thresholds = await readThresholds(cwd)
  const providers = await resolveProviders(cwd)

  for (const provider of providers) {
    if (ctx.files) {
      const rows = await provider.collectPerFile(cwd, { files: ctx.files })
      for (const row of rows) {
        if (row.pct >= thresholds.coverage) continue
        fail(
          `${row.file}: line coverage ${row.pct.toFixed(1)}% < порогу ${thresholds.coverage}% ` +
            `(${row.linesCovered}/${row.linesFound} рядків${row.reason ? `; ${row.reason}` : ''}) — ` +
            'додай unit-тести (test.mdc) або запусти `npx @7n/rules lint test`',
          { reason: 'coverage-below-threshold', file: row.file, data: { pct: row.pct, threshold: thresholds.coverage } }
        )
      }
      continue
    }

    if (!(await provider.detect(cwd))) continue
    let rows = await provider.collect(cwd, {})

    // LLM-класифікація survived-мутантів (allowed gaps): verdict-и
    // equivalent/defensive/glue/wrapper з confidence ≥ порогу виключаються зі
    // знаменника score. Дефолтний поріг 1.1 = вимкнено (rollout-mode) — тоді
    // й LLM не викликається. Провал класифікації не валить вимір.
    const hasSurvived = rows.some(r => (r.survived ?? []).length > 0)
    if (hasSurvived && thresholds.classify <= 1) {
      try {
        const verdicts = await classify(
          rows.flatMap(r => r.survived ?? []),
          cwd
        )
        rows = applyVerdicts(rows, verdicts, thresholds.classify).rows
      } catch (error) {
        console.warn(
          `⚠ coverage classify недоступний (${String(error.message ?? error).slice(0, 120)}) — гейт без allowed-gaps`
        )
      }
    }

    for (const row of rows) {
      const linePct = pct(row.coverage.lines.covered, row.coverage.lines.total)
      if (linePct !== null && linePct < thresholds.coverage) {
        fail(
          `${row.area}: line coverage ${linePct.toFixed(1)}% < порогу ${thresholds.coverage}% ` +
            `(${row.coverage.lines.covered}/${row.coverage.lines.total} рядків)`,
          { reason: 'coverage-below-threshold', data: { area: row.area, pct: linePct, threshold: thresholds.coverage } }
        )
      }
      const mutationPct = pct(row.mutation.caught, row.mutation.total)
      if (mutationPct !== null && mutationPct < thresholds.mutation) {
        fail(
          `${row.area}: mutation score ${mutationPct.toFixed(1)}% < порогу ${thresholds.mutation}% ` +
            `(вбито ${row.mutation.caught}/${row.mutation.total}; вцілілі мутанти у data.survived)`,
          {
            reason: 'mutation-below-threshold',
            data: { area: row.area, pct: mutationPct, threshold: thresholds.mutation, survived: row.survived }
          }
        )
      }
    }
  }

  return reporter.result()
}
