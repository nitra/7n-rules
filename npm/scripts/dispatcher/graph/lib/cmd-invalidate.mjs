/**
 * `n-cursor graph invalidate <path> [--no-cascade]` — позначає вузол як invalidated.
 *
 * Записує порожній файл `invalidated` у директорію вузла.
 * За замовчуванням каскадно інвалідує всі залежні вузли.
 * --no-cascade — лише поточний вузол.
 *
 * FS ін'єктується для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveTasksDir } from './config.mjs'
import { scanNodes } from './scanner.mjs'
import { listActiveWorktrees } from './worktree-ops.mjs'

/**
 * `graph invalidate <path> [--no-cascade]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdInvalidate(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))

  let nodePath = null
  let noCascade = false

  for (const arg of args) {
    if (arg === '--no-cascade') noCascade = true
    else if (!arg.startsWith('-')) nodePath = arg
  }

  if (!nodePath) {
    log('Usage: n-cursor graph invalidate <path> [--no-cascade]')
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const tasksDir = resolveTasksDir(config, root)
  const nodeDir = join(tasksDir, nodePath)

  if (!exists(join(nodeDir, 'task.md'))) {
    log(`invalidate: вузол "${nodePath}" не знайдено`)
    return 1
  }

  // Записуємо invalidated sentinel
  try {
    writeFile(join(nodeDir, 'invalidated'), '', 'utf8')
    log(`invalidate: вузол "${nodePath}" інвалідовано`)
  } catch (err) {
    log(`invalidate: не вдалося записати invalidated — ${err.message ?? String(err)}`)
    return 1
  }

  if (noCascade) return 0

  // Каскадна інвалідація
  const activeWorktrees = listActiveWorktrees(root, { execSync: execSyncFn })
  const allNodes = scanNodes(tasksDir, activeWorktrees, {
    readdirSync: readdir,
    existsSync: exists,
    readFileSync: readFile
  })

  const dependents = allNodes.filter(n => n.deps.includes(nodePath))
  for (const dep of dependents) {
    if (!exists(join(dep.dir, 'invalidated'))) {
      try {
        writeFile(join(dep.dir, 'invalidated'), '', 'utf8')
        log(`invalidate: каскадна інвалідація "${dep.path}"`)
      } catch {
        // пропускаємо
      }
    }
  }

  return 0
}
