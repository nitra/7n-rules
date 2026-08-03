/** @see ./docs/fix-check.md */

/**
 * T0-autofix для `js/check` — детермінований scaffold/merge `eslint.config.js`
 * і `.oxlintrc.json`. Раніше обидва йшли у LLM-ладдер, який переписував конфіги
 * цілком: для eslint.config.js це вгадувало воркспейс-типи (інцидент: у
 * vue-монорепо записано `getConfig({ node: ['npm'] })` — eslint перестав
 * обробляти .vue файли), а для .oxlintrc.json — 15 КБ канону, який дешевій
 * моделі не відтворити byte-perfect (verify fail), а дорожчій — не встигнути
 * за один rung-таймаут.
 *
 * Джерело правди для eslint.config.js — `planEslintConfigFix` (детекція типів
 * із workspaces root package.json + vue-залежність/.vue-файли), наявний конфіг
 * оновлюється точковим merge хірургічно, без повного перезапису.
 *
 * Джерело правди для .oxlintrc.json — `planOxlintrcFix`, що дзеркалить
 * `verifyOxlintRcAgainstCanonical`: відсутній файл копіює канон, наявний —
 * доповнюється до канону без втрати project-specific розширень (зайві
 * `rules`-ключі й `ignorePatterns` зберігаються).
 *
 * Решта порушень js/check (engines, workflows) — поза цим T0, стандартний шлях
 * (ladder/manual).
 */
import { existsSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  ESLINT_CONFIG_IGNORES,
  ESLINT_CONFIG_MISSING,
  ESLINT_CONFIG_VUE_WORKSPACE,
  planEslintConfigFix
} from './eslint-config.mjs'
import {
  KNIP_CANONICAL_JSON_PATH,
  KNIP_MISSING,
  OXLINT_CANONICAL_JSON_PATH,
  OXLINTRC_DRIFT,
  OXLINTRC_MISSING,
  planOxlintrcFix
} from '../tooling/main.mjs'

const ESLINT_CONFIG_REASONS = new Set([ESLINT_CONFIG_MISSING, ESLINT_CONFIG_IGNORES, ESLINT_CONFIG_VUE_WORKSPACE])
const OXLINTRC_REASONS = new Set([OXLINTRC_MISSING, OXLINTRC_DRIFT])

/**
 * Читає `.oxlintrc.json`, якщо є й валідний JSON; інакше `null` (трактується
 * як відсутній файл — `planOxlintrcFix` будує з канону).
 * @param {string} oxPath абсолютний шлях до `.oxlintrc.json`
 * @returns {Promise<unknown>} розпарсений вміст або `null`
 */
async function readOxlintrcOrNull(oxPath) {
  if (!existsSync(oxPath)) return null
  try {
    return JSON.parse(await readFile(oxPath, 'utf8'))
  } catch {
    return null
  }
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'js-check-eslint-config',
    test: violations => violations.some(v => ESLINT_CONFIG_REASONS.has(v.reason)),
    apply: async (violations, ctx) => {
      const plan = await planEslintConfigFix(ctx.cwd)
      if (plan === null) return { touchedFiles: [] }
      ctx.recordWrite?.(plan.path)
      await writeFile(plan.path, plan.content, 'utf8')
      return { touchedFiles: [plan.path], message: plan.message }
    }
  },
  {
    id: 'js-check-oxlintrc',
    test: violations => violations.some(v => OXLINTRC_REASONS.has(v.reason)),
    apply: async (violations, ctx) => {
      const oxPath = join(ctx.cwd, '.oxlintrc.json')
      const [actual, canonicalRaw] = await Promise.all([
        readOxlintrcOrNull(oxPath),
        readFile(OXLINT_CANONICAL_JSON_PATH, 'utf8')
      ])
      const merged = planOxlintrcFix(actual, JSON.parse(canonicalRaw))
      ctx.recordWrite?.(oxPath)
      await writeFile(oxPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
      return { touchedFiles: [oxPath], message: '.oxlintrc.json: T0 merge до канону oxlint (@7n/rules)' }
    }
  },
  {
    // Раніше цю копію робив САМ детектор під час фази detect (і звітував
    // `pass`) — див. доккомент `checkKnipConfig` у `main.mjs` і рішення Ґ
    // спеки `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`. Тепер
    // це звичайний T0, як `js-check-oxlintrc` вище.
    id: 'js-check-knip',
    test: violations => violations.some(v => v.reason === KNIP_MISSING),
    apply: async (violations, ctx) => {
      // Пошкоджена інсталяція пакета: канону немає — писати нічого, порушення
      // лишається (раніше цю гілку детектор звітував як fail сам).
      if (!existsSync(KNIP_CANONICAL_JSON_PATH)) return { touchedFiles: [] }
      const knipPath = join(ctx.cwd, 'knip.json')
      // Ідемпотентність: якщо файл уже з'явився (інший фіксер, паралельний
      // прогін) — не перезаписуємо чужий вміст.
      if (existsSync(knipPath)) return { touchedFiles: [] }
      ctx.recordWrite?.(knipPath)
      await copyFile(KNIP_CANONICAL_JSON_PATH, knipPath)
      return {
        touchedFiles: [knipPath],
        message: 'knip.json створено з канонічного knip-canonical.json (@7n/rules)'
      }
    }
  }
]
