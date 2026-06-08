/**
 * Сигнальні команди: `done`, `audit`, `failed`, `spawn`.
 *
 * Ці команди викликаються зсередини worktree (агентом або скриптом),
 * або зовні через `n-cursor graph done|audit|failed|spawn <path>`.
 *
 * done    → записує run_NNN.md (result:success), мерджить worktree
 * audit   → знаходить latest fact_NNN.md, створює pending-audit_NNN.md,
 *            записує run_NNN.md, мерджить worktree
 * failed  → записує run_NNN.md (result:failed), залишає worktree
 * spawn   → перевіряє що дочірні вузли зареєстровані (мають task.md)
 *
 * FS і child_process ін'єктуються для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildMarkdown } from './frontmatter.mjs'
import { latestFactNNN, nextRunNNN } from './nnn.mjs'
import { loadConfig, resolveTasksDir, resolveWorktreesDir } from './config.mjs'
import { findNodeWorktree, listActiveWorktrees, mergeWorktree } from './worktree-ops.mjs'

/**
 * Пише run_NNN.md артефакт.
 * @param {string} nodeDir директорія вузла
 * @param {string} nnn NNN рядок
 * @param {'success'|'failed'} result результат
 * @param {{ actor: string, now: string }} meta метадані
 * @param {(p: string, c: string, enc: string) => void} writeFile функція запису
 */
function writeRunFile(nodeDir, nnn, result, meta, writeFile) {
  const fm = {
    created_at: meta.now,
    actor: meta.actor,
    result
  }
  const content = buildMarkdown(fm, `## Run ${nnn}\n\nactor: ${meta.actor}\nresult: ${result}\n`)
  writeFile(join(nodeDir, `run_${nnn}.md`), content, 'utf8')
}

/**
 * Резолвить шлях вузла з аргументів або env/fallback-файлу.
 * @param {string[]} args аргументи командного рядка
 * @param {{ env?: Record<string, string>, cwd?: string, exists?: (p: string) => boolean, readFile?: (p: string, enc: string) => string }} deps ін'єкції
 * @returns {{ nodePath: string | null, error: string | null }} результат
 */
function resolveNodePath(args, deps) {
  // 1. Прямий аргумент
  if (args[0] && !args[0].startsWith('-')) {
    return { nodePath: args[0], error: null }
  }

  // 2. ENV var
  const env = deps.env ?? process.env
  const fromEnv = env['NCURSOR_NODE_PATH']
  if (fromEnv?.trim()) {
    return { nodePath: fromEnv.trim(), error: null }
  }

  // 3. Fallback файл .n-cursor/current-node
  const cwd = deps.cwd ?? processCwd()
  const exists = deps.exists ?? existsSync
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const fallbackPath = join(cwd, '.n-cursor', 'current-node')
  if (exists(fallbackPath)) {
    try {
      const content = readFile(fallbackPath, 'utf8').trim()
      if (content.length > 0) return { nodePath: content, error: null }
    } catch {
      // пропускаємо
    }
  }

  return { nodePath: null, error: 'NCURSOR_NODE_PATH not set and .n-cursor/current-node not found' }
}

/**
 * `graph done <path>` — успіх → пише run_NNN.md (success), мерджить worktree.
 * @param {string[]} args аргументи
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdDone(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))
  const nowFn = deps.now ?? (() => new Date().toISOString())

  const { nodePath, error } = resolveNodePath(args, { env: deps.env, cwd: root, exists, readFile })
  if (!nodePath) {
    log(`done: ${error}`)
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const tasksDir = resolveTasksDir(config, root)
  const worktreesDir = resolveWorktreesDir(config, root)
  const nodeDir = join(tasksDir, nodePath)

  if (!exists(join(nodeDir, 'task.md'))) {
    log(`done: вузол "${nodePath}" не знайдено`)
    return 1
  }

  // Записуємо run_NNN.md
  const nnn = nextRunNNN(nodeDir, readdir)
  try {
    writeRunFile(nodeDir, nnn, 'success', { actor: 'agent', now: nowFn() }, writeFile)
    log(`done: записано run_${nnn}.md (result: success)`)
  } catch (err) {
    log(`done: не вдалося записати run_${nnn}.md — ${err.message ?? String(err)}`)
    return 1
  }

  // Знаходимо і мерджимо worktree
  const worktreePath = findNodeWorktree(nodePath, worktreesDir, {
    readdirSync: readdir,
    execSync: execSyncFn
  })

  if (worktreePath) {
    const mergeResult = mergeWorktree(worktreePath, root, { execSync: execSyncFn })
    if (!mergeResult.ok) {
      log(`done: merge не вдався — ${mergeResult.error}`)
      return 1
    }
    log(`done: worktree merged і видалено`)
  } else {
    log(`done: worktree не знайдено для "${nodePath}" — пропускаємо merge`)
  }

  log(`done: вузол "${nodePath}" успішно завершено`)
  return 0
}

/**
 * `graph audit <path>` — аудит → creates pending-audit_NNN.md, merge worktree.
 * @param {string[]} args аргументи
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdAudit(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))
  const nowFn = deps.now ?? (() => new Date().toISOString())

  const { nodePath, error } = resolveNodePath(args, { env: deps.env, cwd: root, exists, readFile })
  if (!nodePath) {
    log(`audit: ${error}`)
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const tasksDir = resolveTasksDir(config, root)
  const worktreesDir = resolveWorktreesDir(config, root)
  const nodeDir = join(tasksDir, nodePath)

  if (!exists(join(nodeDir, 'task.md'))) {
    log(`audit: вузол "${nodePath}" не знайдено`)
    return 1
  }

  // Знаходимо latest fact_NNN.md NNN
  const factNNN = latestFactNNN(nodeDir, readdir)
  if (!factNNN) {
    log(`audit: fact_NNN.md не знайдено для "${nodePath}" — спершу виконайте задачу`)
    return 1
  }

  // Створюємо pending-audit_NNN.md
  const pendingPath = join(nodeDir, `pending-audit_${factNNN}.md`)
  if (exists(pendingPath)) {
    log(`audit: ${pendingPath} вже існує — audit вже запитано`)
    return 1
  }

  const pendingContent = buildMarkdown({
    created_at: nowFn(),
    fact_ref: `fact_${factNNN}.md`,
    actor: 'agent'
  }, '')

  try {
    writeFile(pendingPath, pendingContent, 'utf8')
    log(`audit: створено ${pendingPath}`)
  } catch (err) {
    log(`audit: не вдалося записати ${pendingPath} — ${err.message ?? String(err)}`)
    return 1
  }

  // Записуємо run_NNN.md
  const nnn = nextRunNNN(nodeDir, readdir)
  try {
    writeRunFile(nodeDir, nnn, 'success', { actor: 'agent', now: nowFn() }, writeFile)
    log(`audit: записано run_${nnn}.md`)
  } catch (err) {
    log(`audit: не вдалося записати run_${nnn}.md — ${err.message ?? String(err)}`)
  }

  // Мерджимо worktree агента
  const worktreePath = findNodeWorktree(nodePath, worktreesDir, {
    readdirSync: readdir,
    execSync: execSyncFn
  })

  if (worktreePath) {
    const mergeResult = mergeWorktree(worktreePath, root, { execSync: execSyncFn })
    if (!mergeResult.ok) {
      log(`audit: merge не вдався — ${mergeResult.error}`)
    } else {
      log(`audit: agent worktree merged і видалено`)
    }
  }

  log(`audit: запит аудиту для "${nodePath}" (fact_${factNNN}.md) успішно створено`)
  return 0
}

/**
 * `graph failed <path>` — провал → пише run_NNN.md (failed), залишає worktree.
 * @param {string[]} args аргументи
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdFailed(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const nowFn = deps.now ?? (() => new Date().toISOString())

  const { nodePath, error } = resolveNodePath(args, { env: deps.env, cwd: root, exists, readFile })
  if (!nodePath) {
    log(`failed: ${error}`)
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const tasksDir = resolveTasksDir(config, root)
  const nodeDir = join(tasksDir, nodePath)

  if (!exists(join(nodeDir, 'task.md'))) {
    log(`failed: вузол "${nodePath}" не знайдено`)
    return 1
  }

  // Записуємо run_NNN.md з result:failed
  const nnn = nextRunNNN(nodeDir, readdir)
  try {
    writeRunFile(nodeDir, nnn, 'failed', { actor: 'agent', now: nowFn() }, writeFile)
    log(`failed: записано run_${nnn}.md (result: failed)`)
  } catch (err) {
    log(`failed: не вдалося записати run_${nnn}.md — ${err.message ?? String(err)}`)
    return 1
  }

  log(`failed: вузол "${nodePath}" позначено як failed — worktree збережено для діагностики`)
  return 0
}

/**
 * `graph spawn <path>` — composite → перевіряє що дочірні вузли зареєстровані.
 * @param {string[]} args аргументи
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdSpawn(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync

  const { nodePath, error } = resolveNodePath(args, { env: deps.env, cwd: root, exists, readFile })
  if (!nodePath) {
    log(`spawn: ${error}`)
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const tasksDir = resolveTasksDir(config, root)
  const nodeDir = join(tasksDir, nodePath)

  if (!exists(join(nodeDir, 'task.md'))) {
    log(`spawn: вузол "${nodePath}" не знайдено`)
    return 1
  }

  // Перевіряємо дочірні директорії
  let entries
  try {
    entries = readdir(nodeDir)
  } catch {
    log(`spawn: не вдалося прочитати директорію вузла`)
    return 1
  }

  const childDirs = entries.filter(name => {
    if (name.startsWith('.') || name.endsWith('.md') || name.endsWith('.json')) return false
    return exists(join(nodeDir, name, 'task.md'))
  })

  if (childDirs.length === 0) {
    log(`spawn: вузол "${nodePath}" не має дочірніх вузлів із task.md`)
    log(`spawn: для composite вузла треба створити дочірні директорії з task.md`)
    return 1
  }

  log(`spawn: вузол "${nodePath}" є composite з ${childDirs.length} дочірніми вузлами:`)
  for (const child of childDirs) {
    log(`  - ${nodePath}/${child}`)
  }

  return 0
}
