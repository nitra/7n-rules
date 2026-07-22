/**
 * fix-worker концерну `coverage` правила `test` (spec 2026-07-22 absorb-7n-test):
 * LLM-догенерація тестів/stories і починка survived-мутантів через опційні
 * fix-hooks coverage-провайдерів мовних плагінів.
 *
 * Мапа порушення → дія:
 * - `coverage-below-threshold` з `v.file` (делта-режим) → файли нижче порогу:
 *   `.vue` → `provider.generateStories` (stories = компонентні тести,
 *   Storybook-вимір), решта → `provider.generateTests` (assess-need → gen-tests
 *   усередині провайдера). Розподіл за розширенням робить worker — кожен хук
 *   отримує лише свої файли (простіше за подвійну фільтрацію в провайдері).
 * - `mutation-below-threshold` з `v.data.survived` → `provider.fixSurvived`
 *   (батчеві агентні сесії по мутантах).
 * - після генерації → `provider.fixFailingTests` (тести, що впали після
 *   генерації; свіжий vitest-прогін усередині провайдера).
 *
 * Fix-hooks опційні в контракті провайдера — перевірка через `typeof`
 * (assert порту вимагає лише detect/collect/collectPerFile). Хуки отримують
 * FixContext-поля (model/tier/timeoutMs/recordWrite/chain/signal/feedback);
 * recordWrite прокидається до кожного місця запису (rollback-контракт ladder-а).
 * Дедлайн: DEADLINE_FRACTION від ctx.timeoutMs гейтить СТАРТ наступного хука
 * (як js/eslint fix-worker); залишок бюджету передається хуку як timeoutMs.
 * Власних retry-циклів немає — success визначає canonical re-detect runner-а.
 * @typedef {import('../../../scripts/lib/lint-surface/types.mjs').FixWorkerFn} FixWorkerFn
 * @typedef {import('../../../scripts/lib/lint-surface/types.mjs').FixContext} FixContext
 * @typedef {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation} LintViolation
 */
import { resolveProviders } from './main.mjs'

/** Частка ctx.timeoutMs, після якої не стартує наступний хук (запас до backstop ×1.25). */
const DEADLINE_FRACTION = 0.8

/** `.vue`-файли → generateStories, решта → generateTests. */
const VUE_FILE_RE = /\.vue$/

/**
 * Групує violations концерну за призначенням fix-hooks.
 * @param {LintViolation[]} violations порушення концерну coverage
 * @returns {{belowThreshold: Array<{file: string, pct: number, reason: string}>, survived: object[]}} файли нижче порогу + survived-групи
 */
export function groupViolations(violations) {
  const belowThreshold = []
  const survived = []
  for (const v of violations) {
    if (v.reason === 'coverage-below-threshold' && v.file) {
      belowThreshold.push({ file: v.file, pct: v.data?.pct ?? 0, reason: '' })
    } else if (v.reason === 'mutation-below-threshold' && Array.isArray(v.data?.survived)) {
      survived.push(...v.data.survived)
    }
  }
  return { belowThreshold, survived }
}

/**
 * FixContext-поля для fix-hook провайдера із залишком бюджету до дедлайну.
 * @param {FixContext} ctx контекст рунга
 * @param {number|null} deadlineAt epoch-ms дедлайн worker-а
 * @returns {FixContext} копія ctx з обрізаним timeoutMs
 */
function hookCtx(ctx, deadlineAt) {
  const remaining = deadlineAt ? Math.max(1000, deadlineAt - Date.now()) : ctx.timeoutMs
  return { ...ctx, timeoutMs: remaining }
}

/** @type {FixWorkerFn} */
export async function fixWorker(violations, ctx, deps = {}) {
  // Дедлайн фіксується ДО резолву провайдерів — їх завантаження теж у бюджеті рунга.
  const deadlineAt = ctx.timeoutMs ? Date.now() + Math.round(ctx.timeoutMs * DEADLINE_FRACTION) : null
  const expired = () => deadlineAt !== null && Date.now() >= deadlineAt

  const providers = await (deps.resolveProviders ?? resolveProviders)(ctx.cwd)
  const { belowThreshold, survived } = groupViolations(violations)
  const vueFiles = belowThreshold.filter(f => VUE_FILE_RE.test(f.file))
  const jsFiles = belowThreshold.filter(f => !VUE_FILE_RE.test(f.file))

  /** @type {string[]} */
  const touchedFiles = []
  /**
   * Викликає опційний fix-hook провайдера, збирає touchedFiles; виняток хука не
   * валить решту хуків/провайдерів — success визначає canonical re-detect.
   * @param {object} provider coverage-провайдер плагіна
   * @param {string} hook імʼя хука
   * @param {object} args аргументи хука (без ctx)
   * @returns {Promise<void>}
   */
  const runHook = async (provider, hook, args) => {
    if (typeof provider[hook] !== 'function' || expired()) return
    try {
      const res = await provider[hook]({ ...args, cwd: ctx.cwd, ctx: hookCtx(ctx, deadlineAt) })
      touchedFiles.push(...(res?.touchedFiles ?? []))
    } catch (error) {
      console.warn(
        `⚠ coverage fix-worker: ${provider.id}.${hook} впав: ${String(error?.message ?? error).slice(0, 200)}`
      )
    }
  }

  for (const provider of providers) {
    if (jsFiles.length > 0) await runHook(provider, 'generateTests', { files: jsFiles })
    if (vueFiles.length > 0) await runHook(provider, 'generateStories', { files: vueFiles })
    if (survived.length > 0) await runHook(provider, 'fixSurvived', { survived })
    // Після генерації: тести, що впали (зокрема щойно згенеровані), чиняться
    // окремим хуком — свіжий vitest-прогін усередині провайдера. Без жодної
    // роботи вище (порожній профіль violations) хук не стартує.
    if (survived.length > 0 || belowThreshold.length > 0) {
      await runHook(provider, 'fixFailingTests', {})
    }
  }

  return { touchedFiles }
}
