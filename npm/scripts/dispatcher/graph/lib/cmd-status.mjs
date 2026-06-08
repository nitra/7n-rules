/**
 * `n-cursor graph status [<path>] [--json]` — показує стан DAG вузлів.
 *
 * Без path — показує всі вузли. З path — лише вузол і його нащадків.
 * --json — machine-readable JSON вивід.
 *
 * FS ін'єктується для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveTasksDir } from './config.mjs'
import { scanNodes, topoSort } from './scanner.mjs'
import { listActiveWorktrees } from './worktree-ops.mjs'

/** Кольори для стану (ANSI). */
const STATE_COLORS = {
  'needs-plan': '\x1b[33m',   // жовтий
  waiting: '\x1b[36m',         // блакитний
  running: '\x1b[34m',         // синій
  'pending-audit': '\x1b[35m', // фіолетовий
  resolved: '\x1b[32m',        // зелений
  failed: '\x1b[31m',           // червоний
  invalidated: '\x1b[90m'      // сірий
}
const RESET = '\x1b[0m'

/**
 * Повертає colored рядок стану (якщо TTY).
 * @param {string} state стан вузла
 * @param {boolean} color чи потрібен колір
 * @returns {string} рядок
 */
function colorState(state, color) {
  if (!color) return state
  const c = STATE_COLORS[state] ?? ''
  return `${c}${state}${RESET}`
}

/**
 * `graph status [<path>] [--json]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdStatus(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const execSyncFn = deps.execSync ?? ((cmd, opts) => execSync(cmd, { ...opts, encoding: 'utf8' }))

  // Парсимо аргументи
  let nodePath = null
  let jsonMode = false

  for (const arg of args) {
    if (arg === '--json') jsonMode = true
    else if (!arg.startsWith('-')) nodePath = arg
  }

  const config = loadConfig({ root, readFile, exists })
  const tasksDir = resolveTasksDir(config, root)
  const worktreesDir = join(root, config.worktrees_dir.startsWith('/') ? config.worktrees_dir : config.worktrees_dir.slice(2))

  const activeWorktrees = listActiveWorktrees(root, { execSync: execSyncFn })

  const allNodes = scanNodes(tasksDir, activeWorktrees, {
    readdirSync: readdir,
    existsSync: exists,
    readFileSync: readFile
  })

  // Фільтруємо якщо є path
  let nodes = allNodes
  if (nodePath) {
    nodes = allNodes.filter(n => n.path === nodePath || n.path.startsWith(nodePath + '/'))
    if (nodes.length === 0) {
      log(`status: вузол "${nodePath}" не знайдено`)
      return 1
    }
  }

  const sorted = topoSort(nodes)

  if (jsonMode) {
    console.log(JSON.stringify(sorted.map(n => ({
      id: n.id,
      path: n.path,
      state: n.state,
      deps: n.deps,
      composite: n.composite,
      children: n.children
    })), null, 2))
    return 0
  }

  // Текстовий вивід
  const useColor = process.stdout.isTTY ?? false

  // Підрахунок по станах
  const stateCounts = {}
  for (const n of sorted) {
    stateCounts[n.state] = (stateCounts[n.state] ?? 0) + 1
  }
  const summary = Object.entries(stateCounts)
    .map(([s, c]) => `${colorState(s, useColor)}:${c}`)
    .join(' ')

  log(`DAG tasks — ${summary}`)
  log('')

  for (const node of sorted) {
    const indent = node.path.includes('/') ? '  '.repeat(node.path.split('/').length - 1) : ''
    const composite = node.composite ? ' [composite]' : ''
    const deps = node.deps.length > 0 ? ` ← [${node.deps.join(', ')}]` : ''
    log(`${indent}${node.path} [${colorState(node.state, useColor)}]${composite}${deps}`)
  }

  return 0
}
