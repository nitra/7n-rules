/**
 * CLI-диспетчер `n-cursor flow` (spec §8 Dual-Mode Dispatcher).
 *
 * Два фасади навколо єдиного джерела істини `.flow.json`:
 *  - **Пасивний Турнікет** (Фасад A): `init`, `verify`, `release` — для IDE-
 *    агентів (Cursor/Claude Code), що самі пишуть код; `n-cursor` лише судить.
 *  - **Активний Раннер** (Фасад B): `run`, `resume`, `cancel`, `repair` —
 *    повний 5-фазний polyfill-цикл для headless/CI.
 */
import { cancel, repair, resume, run } from './lib/active.mjs'
import { init, release, verify } from './lib/commands.mjs'
import { gate } from './lib/gate.mjs'
import { plan } from './lib/plan.mjs'
import { review } from './lib/review.mjs'
import { spec } from './lib/spec.mjs'

const USAGE = [
  'Usage:',
  '  npx @nitra/cursor flow init "<опис>"      # Фасад A: worktree + .flow.json (+ level)',
  '  npx @nitra/cursor flow spec [--panel]     # Фасад A: фаза дизайну → docs/specs/<…>',
  '  npx @nitra/cursor flow plan [--panel]     # Фасад A: фаза плану → docs/plans/<…> + state',
  '  npx @nitra/cursor flow verify             # Фасад A: Quality Gates (pass/fail)',
  '  npx @nitra/cursor flow review             # Фасад A: adversarial diff-review (за level)',
  '  npx @nitra/cursor flow gate               # Фасад A: вердикт PASS/CONCERNS/FAIL (verify+review)',
  '  npx @nitra/cursor flow release            # Фасад A: .changes + completion snapshot',
  '  npx @nitra/cursor flow run "<опис>"       # Фасад B: повний 5-фазний цикл',
  '  npx @nitra/cursor flow resume             # продовжити з чекпойнта',
  '  npx @nitra/cursor flow cancel             # скасувати, прибрати стан',
  '  npx @nitra/cursor flow repair [--discard-step-work]   # відновлення пошкодженого стану'
].join('\n')

/** Підкоманди flow. */
export const SUBCOMMANDS = ['init', 'spec', 'plan', 'verify', 'review', 'gate', 'release', 'run', 'resume', 'cancel', 'repair']

/**
 * Усі handler-и реальні (Ф1 Spec/Plan + Ф2 Турнікет + Ф4 Активний Раннер).
 * @type {Record<string, (rest: string[], deps: object) => Promise<number>>}
 */
export const DEFAULT_HANDLERS = { init, spec, plan, verify, review, gate, release, run, resume, cancel, repair }

/**
 * Точка входу `case 'flow'` у `bin/n-cursor.js`. Парсить підкоманду й
 * маршрутизує до handler-а. Невідома/відсутня підкоманда → usage + код 1.
 * @param {string[]} args аргументи після `flow`
 * @param {{ handlers?: Record<string, (rest: string[], deps: object) => Promise<number>> }} [deps] ін'єкція handler-ів (для тестів)
 * @returns {Promise<number>} exit code
 */
export async function runFlowCli(args, deps = {}) {
  const [sub, ...rest] = args
  const handlers = deps.handlers ?? DEFAULT_HANDLERS
  if (!sub || ! Object.hasOwn(handlers, sub)) {
    console.error(USAGE)
    return 1
  }
  return await handlers[sub](rest, deps)
}
