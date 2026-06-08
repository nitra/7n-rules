/**
 * Git worktree management для graph task system.
 *
 * Atomic mkdir lock: EEXIST → skip (вже запущено).
 * Worktree name: sanitize(node-path) + '-' + epoch (секунди).
 *
 * Всі git операції через execSync (node:child_process). FS через ін'єкцію.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { sanitizeNodeName } from './node-state.mjs'

/**
 * Генерує ім'я worktree для вузла.
 * @param {string} nodePath відносний шлях вузла (напр. "research/collect-data")
 * @param {number} [epochSec] epoch в секундах (default: Date.now()/1000)
 * @returns {string} ім'я worktree
 */
export function makeWorktreeName(nodePath, epochSec) {
  const epoch = epochSec ?? Math.floor(Date.now() / 1000)
  const sanitized = sanitizeNodeName(nodePath.replace(/\//g, '-'))
  return `${sanitized}-${epoch}`
}

/**
 * Створює git worktree для вузла з atomic mkdir lock.
 * Повертає null якщо worktree вже існує (EEXIST → вже запущено).
 *
 * @param {string} worktreesDir абсолютний шлях до .worktrees/
 * @param {string} worktreeName ім'я нового worktree
 * @param {string} root корінь репо
 * @param {{
 *   execSync?: (cmd: string, opts?: object) => string,
 *   mkdirSync?: (p: string, opts?: object) => void
 * }} [deps] ін'єкції
 * @returns {{ worktreePath: string } | null} шлях worktree або null якщо вже існує
 */
export function createWorktree(worktreesDir, worktreeName, root, deps = {}) {
  const execSyncFn = deps.execSync ?? ((cmd, opts) => execSync(cmd, opts))
  const mkdirSyncFn = deps.mkdirSync ?? mkdirSync

  const worktreePath = join(worktreesDir, worktreeName)

  // Atomic mkdir lock: якщо директорія вже є — хтось вже запустив цей вузол
  try {
    mkdirSyncFn(worktreePath, { recursive: false })
  } catch (err) {
    if (err.code === 'EEXIST') return null
    throw err
  }

  try {
    // Видаляємо порожню директорію — git worktree add створить її сам
    rmSync(worktreePath, { recursive: true, force: true })
    execSyncFn(`git worktree add "${worktreePath}" HEAD`, { cwd: root, encoding: 'utf8' })
  } catch (err) {
    // Якщо git worktree add не вдався — прибираємо директорію
    try {
      rmSync(worktreePath, { recursive: true, force: true })
    } catch {
      // пропускаємо
    }
    throw err
  }

  return { worktreePath }
}

/**
 * Видаляє git worktree.
 * @param {string} worktreePath абсолютний шлях до worktree
 * @param {string} root корінь репо
 * @param {{
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 */
export function removeWorktree(worktreePath, root, deps = {}) {
  const execSyncFn = deps.execSync ?? ((cmd, opts) => execSync(cmd, opts))
  try {
    execSyncFn(`git worktree remove --force "${worktreePath}"`, { cwd: root, encoding: 'utf8' })
  } catch {
    // Якщо не вдалось через git — видаляємо вручну
    try {
      rmSync(worktreePath, { recursive: true, force: true })
      execSyncFn('git worktree prune', { cwd: root, encoding: 'utf8' })
    } catch {
      // пропускаємо — можливо вже видалено
    }
  }
}

/**
 * Мерджить зміни з worktree у main-гілку і видаляє worktree.
 * @param {string} worktreePath абсолютний шлях до worktree
 * @param {string} root корінь репо
 * @param {{
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {{ ok: boolean, error?: string }} результат
 */
export function mergeWorktree(worktreePath, root, deps = {}) {
  const execSyncFn = deps.execSync ?? ((cmd, opts) => execSync(cmd, opts))

  try {
    // Отримуємо ім'я гілки worktree
    const branch = execSyncFn('git rev-parse --abbrev-ref HEAD', {
      cwd: worktreePath,
      encoding: 'utf8'
    }).trim()

    // Додаємо всі зміни і комітимо
    execSyncFn('git add -A', { cwd: worktreePath, encoding: 'utf8' })

    let hasChanges = false
    try {
      execSyncFn('git diff --cached --quiet', { cwd: worktreePath, encoding: 'utf8' })
    } catch {
      hasChanges = true
    }

    if (hasChanges) {
      execSyncFn('git commit -m "graph: node task completion"', { cwd: worktreePath, encoding: 'utf8' })
    }

    // Якщо worktree на окремій гілці — мерджимо в main
    if (branch && branch !== 'HEAD' && branch !== 'main' && branch !== 'master') {
      execSyncFn(`git merge --no-ff "${branch}" -m "graph: merge node ${branch}"`, {
        cwd: root,
        encoding: 'utf8'
      })
    }
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) }
  }

  // Видаляємо worktree
  removeWorktree(worktreePath, root, { execSync: execSyncFn })
  return { ok: true }
}

/**
 * Повертає список активних worktrees з репо.
 * @param {string} root корінь репо
 * @param {{
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Set<string>} set імен worktrees
 */
export function listActiveWorktrees(root, deps = {}) {
  const execSyncFn = deps.execSync ?? ((cmd, opts) => execSync(cmd, opts))

  try {
    const out = execSyncFn('git worktree list --porcelain', { cwd: root, encoding: 'utf8' })
    const names = new Set()
    for (const line of String(out).split('\n')) {
      if (line.startsWith('worktree ')) {
        const path = line.slice('worktree '.length).trim()
        const name = path.split('/').pop() ?? ''
        if (name) names.add(name)
      }
    }
    return names
  } catch {
    return new Set()
  }
}

/**
 * Знаходить worktree що належить вузлу (за prefix).
 * @param {string} nodePath відносний шлях вузла
 * @param {string} worktreesDir абсолютний шлях до .worktrees/
 * @param {{
 *   readdirSync?: (d: string) => string[],
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {string | null} абсолютний шлях до worktree або null
 */
export function findNodeWorktree(nodePath, worktreesDir, deps = {}) {
  const readdirSyncFn = deps.readdirSync ?? readdirSync
  const prefix = sanitizeNodeName(nodePath.replace(/\//g, '-'))

  let entries
  try {
    entries = readdirSyncFn(worktreesDir)
  } catch {
    return null
  }

  const match = entries.find(name => name.startsWith(prefix + '-') || name === prefix)
  return match ? join(worktreesDir, match) : null
}
