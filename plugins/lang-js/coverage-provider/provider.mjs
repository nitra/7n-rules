/** @see ./docs/provider.md */
import { collect, detect } from './js-collector.mjs'
import { collectPerFile } from './per-file.mjs'

/**
 * @typedef {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} FixContext
 */

/**
 * Epoch-ms дедлайн з бюджету хука: fix-модулі не стартують нову одиницю
 * (файл/батч) після нього — конвергенцію жене ladder ядра повторними rung-ами.
 * @param {FixContext} ctx FixContext ladder-а
 * @returns {number|null} дедлайн або null (без ліміту)
 */
function deadlineFrom(ctx) {
  return ctx?.timeoutMs ? Date.now() + ctx.timeoutMs : null
}

/**
 * CoverageProvider JS/TS-екосистеми (порт `coverage` plugin-api, spec
 * 2026-07-22 absorb-7n-test): vitest line coverage + Stryker мутаційка +
 * окремий Storybook-вимір (browser mode). CLI-оркестрації тут немає — методи
 * викликає концерн `coverage` правила `test` ядра (`npm/rules/test/coverage/`).
 *
 * Fix-hooks (опційна частина порту, викликає `fix-worker.mjs` концерну):
 * `generateTests`/`generateStories`/`fixSurvived`/`fixFailingTests`. Кожен
 * приймає `{ cwd, …, ctx }` (FixContext ladder-а), прокидає `ctx.recordWrite`
 * у місця запису та поважає `ctx.timeoutMs` дедлайном; повертає
 * `{ touchedFiles }`. Fix-модулі імпортуються ліниво — detect/collect-шлях
 * (read-only `--no-fix`) не вантажить LLM-стек.
 */
export default {
  id: 'js',
  title: 'JS/TS (vitest + Stryker)',
  detect,
  collect,
  collectPerFile,

  /**
   * Догенерація unit-тестів для JS/TS-файлів нижче порогу покриття:
   * assess-need (LLM-довизначення потреби; очевидне вже відсіяв quickClassify
   * на боці детектора) → gen-tests (per-export tiered генерація).
   * @param {{cwd: string, files: Array<{file: string, pct: number, reason?: string}>, ctx: FixContext}} args корінь, файли нижче порогу, FixContext
   * @returns {Promise<{touchedFiles: string[]}>} записані тест-файли
   */
  async generateTests({ cwd, files, ctx }) {
    if (!files?.length) return { touchedFiles: [] }
    const [{ assessNeed }, { generateTests }] = await Promise.all([
      import('./fix/assess-need.mjs'),
      import('./fix/gen-tests.mjs')
    ])
    const assessed = await assessNeed(files, cwd)
    const needed = assessed.filter(f => f.needsTests)
    return generateTests(needed, cwd, {
      recordWrite: ctx?.recordWrite,
      deadlineAt: deadlineFrom(ctx)
    })
  },

  /**
   * Догенерація Storybook CSF3 stories для `.vue`-файлів нижче порогу
   * (stories = компонентні тести; валідація — storybook-проєкт vitest споживача).
   * @param {{cwd: string, files: Array<{file: string, pct: number}>, ctx: FixContext}} args корінь, `.vue`-файли нижче порогу, FixContext
   * @returns {Promise<{touchedFiles: string[]}>} записані story-файли
   */
  async generateStories({ cwd, files, ctx }) {
    if (!files?.length) return { touchedFiles: [] }
    const { generateStories } = await import('./fix/gen-stories.mjs')
    return generateStories(files, cwd, {
      recordWrite: ctx?.recordWrite,
      deadlineAt: deadlineFrom(ctx)
    })
  },

  /**
   * Батчевий agent-fix survived-мутантів (runAgentFix, записи через
   * write-guard → ctx.recordWrite).
   * @param {{cwd: string, survived: Array<object>, ctx: FixContext}} args корінь, survived-групи з violations, FixContext
   * @returns {Promise<{touchedFiles: string[]}>} змінені файли
   */
  async fixSurvived({ cwd, survived, ctx }) {
    if (!survived?.length) return { touchedFiles: [] }
    const { fixSurvivedMutants } = await import('./fix/coverage-fix.mjs')
    const res = await fixSurvivedMutants(survived, cwd, {
      model: ctx?.model,
      tier: ctx?.tier,
      timeoutMs: ctx?.timeoutMs,
      recordWrite: ctx?.recordWrite,
      chain: ctx?.chain ?? null,
      feedback: ctx?.feedback ?? null
    })
    return { touchedFiles: res.touchedFiles }
  },

  /**
   * Починка падаючих тестів (зокрема щойно згенерованих): vitest JSON-звіт →
   * батчеві text-виправлення з прямим записом.
   * @param {{cwd: string, ctx: FixContext}} args корінь проєкту і FixContext
   * @returns {Promise<{touchedFiles: string[]}>} переписані тест-файли
   */
  async fixFailingTests({ cwd, ctx }) {
    const { fixFailingTests } = await import('./fix/fix-tests.mjs')
    const res = await fixFailingTests(cwd, {
      model: ctx?.model,
      recordWrite: ctx?.recordWrite,
      deadlineAt: deadlineFrom(ctx)
    })
    return { touchedFiles: res.touchedFiles }
  }
}
