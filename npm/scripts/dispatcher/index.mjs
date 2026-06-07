/**
 * CLI-диспетчер `n-cursor flow` (думка.MD — протокол всередині вузла графу).
 *
 * flow plan    — Stage 1: читає task.md, створює plan_NNN.md, виводить контекст
 * flow verify  — Stage 2: структурний check + ## Done when + outputs на stdout
 * flow done    — CWD → node path → `graph done <path>`
 * flow audit   — CWD → node path → pending-audit_NNN.md → `graph audit <path>`
 * flow failed  — CWD → node path → `graph failed <path>`
 * flow spawn   — CWD → node path → `graph spawn <path>`
 */
import { plan } from './lib/flow-plan.mjs'
import { verify } from './lib/flow-verify.mjs'
import { audit, done, failed, spawn } from './lib/flow-signals.mjs'

const USAGE = [
  'Usage:',
  '  npx @nitra/cursor flow plan     # Stage 1: читає task.md, створює plan_NNN.md',
  '  npx @nitra/cursor flow verify   # Stage 2: структурна перевірка + stdout-контекст для агента',
  '  npx @nitra/cursor flow done     # успіх → graph done <node-path>',
  '  npx @nitra/cursor flow audit    # аудит → pending-audit_NNN.md → graph audit <node-path>',
  '  npx @nitra/cursor flow failed   # провал → graph failed <node-path>',
  '  npx @nitra/cursor flow spawn    # розклад → graph spawn <node-path>'
].join('\n')

/**
 * @type {Record<string, (rest: string[], deps: object) => Promise<number>>}
 */
export const DEFAULT_HANDLERS = { plan, verify, done, audit, failed, spawn }

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
  if (!sub || !Object.hasOwn(handlers, sub)) {
    console.error(USAGE)
    return 1
  }
  return await handlers[sub](rest, deps)
}
