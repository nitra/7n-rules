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

/**
 * Усі handler-и реальні (Ф1 Spec/Plan + Ф2 Турнікет + Ф4 Активний Раннер).
 * @type {Record<string, (rest: string[], deps: object) => Promise<number>>}
 */
export const DEFAULT_HANDLERS = { init, spec, plan, verify, review, gate, release, run, resume, cancel, repair }

/**
 * Витягує опційний `--branch <гілка>` з аргументів (для cwd-незалежного резолву
 * стану — беклог #1). Повертає очищені аргументи й значення гілки.
 * @param {string[]} args аргументи після підкоманди
 * @returns {{ rest: string[], branch: string | undefined }} очищені аргументи + гілка
 */
export function extractBranchFlag(args) {
  const rest = []
  let branch
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--branch') {
      const val = args[i + 1]
      // Поглинаємо наступний аргумент як значення лише якщо це справді значення,
      // а не інший прапорець / кінець аргументів (інакше `--branch` був би no-op,
      // що тихо ковтав би сусідній прапорець).
      if (val !== undefined && !val.startsWith('-')) {
        branch = val
        i++
      }
      continue
    }
    const inline = args[i].startsWith('--branch=') ? args[i].slice('--branch='.length) : null
    if (inline !== null) {
      if (inline !== '') branch = inline
      continue
    }
    rest.push(args[i])
  }
  return { rest, branch }
}

/**
 * Точка входу `case 'flow'` у `bin/n-cursor.js`. Парсить підкоманду й
 * маршрутизує до handler-а. Невідома/відсутня підкоманда → usage + код 1.
 * Опційний `--branch <гілка>` прокидається в `deps.branch` (резолв стану поза worktree).
 * @param {string[]} args аргументи після `flow`
 * @param {{ handlers?: Record<string, (rest: string[], deps: object) => Promise<number>>, branch?: string }} [deps] ін'єкція handler-ів (для тестів)
 * @returns {Promise<number>} exit code
 */
export async function runFlowCli(args, deps = {}) {
  const [sub, ...raw] = args
  const handlers = deps.handlers ?? DEFAULT_HANDLERS
  if (!sub || !Object.hasOwn(handlers, sub)) {
    console.error(USAGE)
    return 1
  }
  const { rest, branch } = extractBranchFlag(raw)
  return await handlers[sub](rest, { ...deps, branch: deps.branch ?? branch })
}
