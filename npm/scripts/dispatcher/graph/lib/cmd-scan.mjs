/**
 * `n-cursor graph scan [--json]` — повний скан DAG, exit 1 якщо є failed-вузли.
 *
 * Обходить весь DAG, деривує стани, виводить зведення.
 * exit 0 = все чисто (або лише needs-plan/waiting)
 * exit 1 = є failed або pending-audit без відповіді
 *
 * FS ін'єктується для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveTasksDir } from './config.mjs'
import { scanNodes, topoSort, areDepsResolved } from './scanner.mjs'
import { listActiveWorktrees } from './worktree-ops.mjs'

/**
 * `graph scan [--json]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (0=clean, 1=attention)
 */
export async function cmdScan(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const execSyncFn = deps.execSync ?? ((cmd, opts) => execSync(cmd, { ...opts, encoding: 'utf8' }))

  const jsonMode = args.includes('--json')

  const config = loadConfig({ root, readFile, exists })
  const tasksDir = resolveTasksDir(config, root)

  const activeWorktrees = listActiveWorktrees(root, { execSync: execSyncFn })

  const allNodes = scanNodes(tasksDir, activeWorktrees, {
    readdirSync: readdir,
    existsSync: exists,
    readFileSync: readFile
  })

  const sorted = topoSort(allNodes)

  // Підрахунок по станах
  const stateCounts = {}
  for (const n of sorted) {
    stateCounts[n.state] = (stateCounts[n.state] ?? 0) + 1
  }

  // Знаходимо проблемні вузли
  const failed = sorted.filter(n => n.state === 'failed')
  const pendingAudit = sorted.filter(n => n.state === 'pending-audit')
  const needsPlan = sorted.filter(n => n.state === 'needs-plan')

  // Знаходимо готові до запуску (waiting + deps resolved)
  const nodeMap = new Map(sorted.map(n => [n.id, n]))
  const ready = sorted.filter(n => n.state === 'waiting' && areDepsResolved(n, nodeMap))

  const hasProblems = failed.length > 0

  if (jsonMode) {
    console.log(JSON.stringify({
      ok: !hasProblems,
      total: sorted.length,
      counts: stateCounts,
      failed: failed.map(n => n.path),
      pending_audit: pendingAudit.map(n => n.path),
      needs_plan: needsPlan.map(n => n.path),
      ready: ready.map(n => n.path)
    }, null, 2))
  } else {
    const summaryParts = Object.entries(stateCounts)
      .map(([s, c]) => `${s}:${c}`)
      .join(' ')

    log(`scan: ${sorted.length} вузлів — ${summaryParts}`)

    if (failed.length > 0) {
      log(`\nFAILED (${failed.length}):`)
      for (const n of failed) log(`  - ${n.path}`)
    }

    if (pendingAudit.length > 0) {
      log(`\npending-audit (${pendingAudit.length}):`)
      for (const n of pendingAudit) log(`  - ${n.path}`)
    }

    if (needsPlan.length > 0) {
      log(`\nneeds-plan (${needsPlan.length}):`)
      for (const n of needsPlan) log(`  - ${n.path}`)
    }

    if (ready.length > 0) {
      log(`\nready to run (${ready.length}):`)
      for (const n of ready) log(`  - ${n.path}`)
    }

    if (!hasProblems && failed.length === 0) {
      log('\nscan: OK')
    }
  }

  return hasProblems ? 1 : 0
}
