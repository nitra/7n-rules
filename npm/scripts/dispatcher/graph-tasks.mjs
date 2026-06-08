/**
 * `n-cursor graph` — task DAG orchestration system.
 *
 * Управляє задачами у `tasks/<node>/` директоріях. Стан вузлів деривується
 * з файлів (immutable protocol): task.md + plan/run/fact/pending-audit/audit-result/invalidated.
 *
 * Підкоманди:
 *   setup         — ініціалізація проєкту (.n-cursor.json, tasks/, git hook)
 *   init <name>   — створити task.md шаблон
 *   plan [<path>] [--mode agent]  — Stage 1: написати plan_NNN.md
 *   status [<path>] [--json]      — показати стан DAG
 *   scan [--json]                 — повний скан, exit 1 якщо failed
 *   run [<path>] [--actor a] [--auto]  — запустити вузол(и)
 *   kill <path>                   — вбити worktree + каскадна інвалідація + видалити plan_*.md
 *   invalidate <path> [--no-cascade]   — позначити як invalidated
 *   done <path>                   — успіх → merge worktree
 *   audit <path>                  — pending-audit_NNN.md + merge agent worktree
 *   failed <path>                 — провал → run_NNN.md (failed)
 *   spawn <path>                  — composite → перевірити дочірні вузли
 *   watch                         — одноразовий скан: audit queue + stale + needs-plan
 */

import { cmdSetup } from './graph/lib/cmd-setup.mjs'
import { cmdInit } from './graph/lib/cmd-init.mjs'
import { cmdPlan } from './graph/lib/cmd-plan.mjs'
import { cmdStatus } from './graph/lib/cmd-status.mjs'
import { cmdScan } from './graph/lib/cmd-scan.mjs'
import { cmdRun } from './graph/lib/cmd-run.mjs'
import { cmdKill } from './graph/lib/cmd-kill.mjs'
import { cmdInvalidate } from './graph/lib/cmd-invalidate.mjs'
import { cmdDone, cmdAudit, cmdFailed, cmdSpawn } from './graph/lib/cmd-signals.mjs'
import { cmdWatch } from './graph/lib/cmd-watch.mjs'

const USAGE = [
  'Usage: n-cursor graph <command> [args]',
  '',
  'Commands:',
  '  setup                          init project: .n-cursor.json, tasks/, git hook',
  '  init <name>                    create task.md template',
  '  plan [<path>] [--mode agent]   Stage 1: write plan_NNN.md',
  '  status [<path>] [--json]       show DAG state',
  '  scan [--json]                  full scan, exit 1 if failed',
  '  run [<path>] [--actor a] [--auto]  run node(s)',
  '  kill <path>                    kill worktree + cascade invalidate + delete plan_*.md',
  '  invalidate <path> [--no-cascade]   mark invalidated',
  '  done <path>                    success → merge worktree',
  '  audit <path>                   pending-audit_NNN.md + merge agent worktree',
  '  failed <path>                  failure → write run_NNN.md',
  '  spawn <path>                   composite → validate children registered',
  '  watch                          one-shot scan: audit queue + stale + needs-plan'
].join('\n')

/** @type {Record<string, (args: string[], deps: object) => Promise<number>>} */
const COMMANDS = {
  setup: cmdSetup,
  init: cmdInit,
  plan: cmdPlan,
  status: cmdStatus,
  scan: cmdScan,
  run: cmdRun,
  kill: cmdKill,
  invalidate: cmdInvalidate,
  done: cmdDone,
  audit: cmdAudit,
  failed: cmdFailed,
  spawn: cmdSpawn,
  watch: cmdWatch
}

/**
 * Точка входу `n-cursor graph` та `n-cursor watch`.
 * Парсить підкоманду і маршрутизує до відповідного handler-а.
 *
 * @param {string[]} args аргументи після `graph` (або `watch`)
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   [key: string]: unknown
 * }} [deps] ін'єкції (пробрасуються до підкоманд)
 * @returns {Promise<number>} exit code
 */
export async function runGraphTasksCli(args, deps = {}) {
  const [sub, ...rest] = args

  if (!sub || !Object.hasOwn(COMMANDS, sub)) {
    console.error(USAGE)
    if (sub) console.error(`\nНевідома підкоманда: "${sub}"`)
    return 1
  }

  return await COMMANDS[sub](rest, deps)
}
