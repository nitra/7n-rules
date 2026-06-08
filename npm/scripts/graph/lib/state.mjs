/**
 * Визначення стану вузла за наявністю файлів (O(1), без читання вмісту).
 * Пріоритет: invalidated > resolved > pending-audit > stalled > running > waiting/blocked > failed > needs-plan
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @typedef {'needs-plan'|'waiting'|'blocked'|'running'|'stalled'|'pending-audit'|'resolved'|'failed'|'invalidated'} NodeState
 */

/**
 * Визначає стан атомарного вузла за файлами у директорії.
 * @param {string} dir абсолютний шлях до директорії вузла
 * @param {{ depsResolved: boolean }} opts
 * @returns {NodeState}
 */
export function deriveAtomicState(dir, { depsResolved = true } = {}) {
  if (existsSync(join(dir, 'invalidated'))) return 'invalidated'

  const files = listFiles(dir)

  if (hasFact(files) && !files.includes('invalidated')) return 'resolved'

  const pendingNNN = findPendingAudit(files)
  if (pendingNNN !== null) return 'pending-audit'

  const runningUntil = findRunningUntil(files)
  if (runningUntil !== null) {
    const ts = Number(runningUntil)
    const now = Math.floor(Date.now() / 1000)
    return ts > now ? 'running' : 'stalled'
  }

  const hasPlan = files.some(f => /^plan_\d{3}\.md$/u.test(f))
  const hasRun = files.some(f => /^run_\d{3}\.md$/u.test(f))

  if (!hasPlan) return 'needs-plan'
  if (hasRun && !hasFact(files)) return 'failed'
  if (hasPlan && !depsResolved) return 'blocked'
  return 'waiting'
}

/**
 * Визначає стан composite вузла за станами дітей.
 * @param {string} dir
 * @param {NodeState[]} childStates
 * @returns {NodeState}
 */
export function deriveCompositeState(dir, childStates) {
  if (existsSync(join(dir, 'invalidated'))) return 'invalidated'

  if (childStates.length === 0) return 'needs-plan'
  if (childStates.every(s => s === 'resolved')) return 'resolved'
  if (childStates.some(s => s === 'running' || s === 'pending-audit')) return 'running'
  if (childStates.some(s => s === 'stalled')) return 'stalled'
  if (childStates.some(s => s === 'failed') && !childStates.some(s => s === 'running')) return 'failed'
  return 'waiting'
}

/**
 * Перевіряє наявність orphan worktree для вузла (resolved + worktree exists).
 * @param {string} dir
 * @param {string} worktreesDir
 * @returns {boolean}
 */
export function hasOrphanWorktree(dir, worktreesDir) {
  const nodeName = dir.split('/').at(-1)
  try {
    return readdirSync(worktreesDir).some(d => d.startsWith(nodeName))
  } catch {
    return false
  }
}

// --- helpers ---

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  try { return readdirSync(dir) } catch { return [] }
}

/** @param {string[]} files @returns {boolean} */
function hasFact(files) {
  return files.some(f => /^fact_\d{3}\.md$/u.test(f))
}

/**
 * Знаходить перший pending-audit_NNN без audit-result_NNN.
 * @param {string[]} files
 * @returns {string | null} NNN або null
 */
function findPendingAudit(files) {
  const pending = files.filter(f => /^pending-audit_\d{3}\.md$/u.test(f)).sort()
  for (const p of pending) {
    const nnn = p.replace('pending-audit_', '').replace('.md', '')
    if (!files.includes(`audit-result_${nnn}.md`)) return nnn
  }
  return null
}

/**
 * Знаходить `running_until_<ts>` файл і повертає ts як рядок.
 * @param {string[]} files
 * @returns {string | null}
 */
function findRunningUntil(files) {
  const f = files.find(f => /^running_until_\d+$/u.test(f))
  return f ? f.replace('running_until_', '') : null
}
