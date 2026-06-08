/**
 * `n-cursor graph kill <path>` — вбиває worktree вузла і каскадно інвалідує нащадків.
 *
 * 1. Знаходить worktree вузла
 * 2. Видаляє worktree (force)
 * 3. Видаляє plan_*.md (скидає планування)
 * 4. Записує invalidated sentinel
 * 5. Каскадно інвалідує всі залежні вузли
 *
 * FS і child_process ін'єктуються для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveTasksDir, resolveWorktreesDir } from './config.mjs'
import { scanNodes } from './scanner.mjs'
import { findNodeWorktree, listActiveWorktrees, removeWorktree } from './worktree-ops.mjs'

/**
 * Записує invalidated sentinel для вузла.
 * @param {string} nodeDir директорія вузла
 * @param {(p: string, c: string, enc: string) => void} writeFile функція запису
 */
function writeInvalidated(nodeDir, writeFile) {
  writeFile(join(nodeDir, 'invalidated'), '', 'utf8')
}

/**
 * Видаляє plan_*.md файли з директорії вузла.
 * @param {string} nodeDir директорія вузла
 * @param {string[]} files список файлів
 * @param {(p: string) => void} unlink функція видалення
 */
function deletePlanFiles(nodeDir, files, unlink) {
  for (const f of files) {
    if (/^plan_\d+\.md$/.test(f)) {
      try {
        unlink(join(nodeDir, f))
      } catch {
        // пропускаємо
      }
    }
  }
}

/**
 * `graph kill <path>` command handler.
 * @param {string[]} args аргументи: [path]
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   unlink?: (p: string) => void,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdKill(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const unlink = deps.unlink ?? unlinkSync
  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))

  const [nodePath] = args
  if (!nodePath) {
    log('Usage: n-cursor graph kill <path>')
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const tasksDir = resolveTasksDir(config, root)
  const worktreesDir = resolveWorktreesDir(config, root)

  const nodeDir = join(tasksDir, nodePath)
  if (!exists(join(nodeDir, 'task.md'))) {
    log(`kill: вузол "${nodePath}" не знайдено`)
    return 1
  }

  // 1. Знаходимо і видаляємо worktree
  const worktreePath = findNodeWorktree(nodePath, worktreesDir, {
    readdirSync: readdir,
    execSync: execSyncFn
  })

  if (worktreePath) {
    log(`kill: видаляємо worktree ${worktreePath}`)
    removeWorktree(worktreePath, root, { execSync: execSyncFn })
  } else {
    log(`kill: worktree не знайдено для "${nodePath}"`)
  }

  // 2. Видаляємо plan_*.md
  const files = readdir(nodeDir)
  deletePlanFiles(nodeDir, files, unlink)
  const planCount = files.filter(f => /^plan_\d+\.md$/.test(f)).length
  if (planCount > 0) {
    log(`kill: видалено ${planCount} plan_*.md файл(ів)`)
  }

  // 3. Записуємо invalidated sentinel
  try {
    writeInvalidated(nodeDir, writeFile)
    log(`kill: вузол "${nodePath}" інвалідовано`)
  } catch (err) {
    log(`kill: не вдалося записати invalidated — ${err.message ?? String(err)}`)
    return 1
  }

  // 4. Каскадна інвалідація залежних вузлів
  const activeWorktrees = listActiveWorktrees(root, { execSync: execSyncFn })
  const allNodes = scanNodes(tasksDir, activeWorktrees, {
    readdirSync: readdir,
    existsSync: exists,
    readFileSync: readFile
  })

  // Знаходимо вузли що залежать від нашого вузла
  const dependents = allNodes.filter(n => n.deps.includes(nodePath))
  for (const dep of dependents) {
    if (!exists(join(dep.dir, 'invalidated'))) {
      try {
        writeInvalidated(dep.dir, writeFile)
        log(`kill: каскадна інвалідація "${dep.path}"`)
      } catch {
        // пропускаємо
      }
    }
  }

  return 0
}
