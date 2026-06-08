/**
 * Деривація стану вузла з файлової системи (immutable file-presence protocol).
 *
 * Стан визначається виключно наявністю файлів у tasks/<node>/:
 *   invalidated > resolved > pending-audit > running > failed > waiting > needs-plan
 *
 * Чиста функція — FS ін'єктується. Не пише нічого на диск.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { hasPendingAudit, latestFactNNN } from './nnn.mjs'

/** Всі можливі стани вузла. */
export const NODE_STATES = /** @type {const} */ ([
  'needs-plan',
  'waiting',
  'running',
  'pending-audit',
  'resolved',
  'failed',
  'invalidated'
])

/**
 * Перевіряє чи директорія є composite-вузлом (містить дочірні директорії з task.md).
 * @param {string} nodeDir абсолютний шлях до директорії вузла
 * @param {{ readdirSync?: (d: string) => string[], existsSync?: (p: string) => boolean }} [deps] ін'єкції
 * @returns {boolean} true якщо є хоча б один дочірній вузол
 */
export function isComposite(nodeDir, deps = {}) {
  const readdir = deps.readdirSync ?? readdirSync
  const exists = deps.existsSync ?? existsSync

  let entries
  try {
    entries = readdir(nodeDir)
  } catch {
    return false
  }

  return entries.some(name => {
    const childTask = join(nodeDir, name, 'task.md')
    return exists(childTask)
  })
}

/**
 * Деривує composite-стан з масиву станів дочірніх вузлів.
 * @param {string[]} childStates масив станів дочірніх вузлів
 * @returns {string} агрегований стан
 */
export function deriveCompositeState(childStates) {
  if (childStates.length === 0) return 'waiting'
  if (childStates.some(s => s === 'invalidated')) return 'invalidated'
  if (childStates.some(s => s === 'failed')) return 'failed'
  if (childStates.some(s => s === 'running')) return 'running'
  if (childStates.some(s => s === 'pending-audit')) return 'pending-audit'
  if (childStates.every(s => s === 'resolved')) return 'resolved'
  return 'waiting'
}

/**
 * Деривує стан одного вузла з присутності файлів.
 *
 * Пріоритет: invalidated > resolved > pending-audit > running > failed > waiting > needs-plan
 *
 * @param {string} nodeDir абсолютний шлях до директорії вузла
 * @param {Set<string>} activeWorktrees set імен активних worktree (наприклад, 'my-node-1234567890')
 * @param {{
 *   readdirSync?: (d: string) => string[],
 *   readFileSync?: (p: string, enc: string) => string,
 *   existsSync?: (p: string) => boolean
 * }} [deps] ін'єкції
 * @returns {string} стан вузла
 */
export function deriveNodeState(nodeDir, activeWorktrees, deps = {}) {
  const readdir = deps.readdirSync ?? readdirSync
  const readFile = deps.readFileSync ?? ((p, enc) => readFileSync(p, enc))
  const exists = deps.existsSync ?? existsSync

  // Файл task.md обов'язковий
  if (!exists(join(nodeDir, 'task.md'))) {
    return 'needs-plan'
  }

  let files
  try {
    files = readdir(nodeDir)
  } catch {
    return 'needs-plan'
  }

  const fileSet = new Set(files)

  // 1. invalidated — sentinel файл
  if (fileSet.has('invalidated')) return 'invalidated'

  // 2. resolved — є fact_NNN.md і немає invalidated
  const factNNN = latestFactNNN(nodeDir, readdir)
  if (factNNN !== null) return 'resolved'

  // 3. pending-audit — є pending-audit_NNN.md без відповідного audit-result_NNN.md
  const { has: hasPending } = hasPendingAudit(nodeDir, readdir)
  if (hasPending) return 'pending-audit'

  // 4. running — активний worktree існує (перевіряємо за prefix node dir name)
  const nodeName = nodeDir.split('/').filter(Boolean).pop() ?? ''
  if (activeWorktrees.size > 0) {
    for (const wt of activeWorktrees) {
      // worktree name: sanitized-node-path-epoch
      if (wt.includes(sanitizeNodeName(nodeName))) return 'running'
    }
  }

  // 5. failed — є run_NNN.md з result:failed, без fact_NNN.md і без активного worktree
  const runFiles = files.filter(f => /^run_\d+\.md$/.test(f))
  if (runFiles.length > 0) {
    // Перевіряємо останній run файл
    let hasFailedRun = false
    for (const runFile of runFiles) {
      try {
        const content = readFile(join(nodeDir, runFile), 'utf8')
        if (content.includes('result: failed') || content.includes('result:failed')) {
          hasFailedRun = true
        }
      } catch {
        // пропускаємо нечитабельні файли
      }
    }
    if (hasFailedRun) return 'failed'
  }

  // 6. waiting — є plan_NNN.md АБО mode:agent
  const hasPlan = files.some(f => /^plan_\d+\.md$/.test(f))
  if (hasPlan) return 'waiting'

  // Читаємо mode з task.md
  try {
    const taskContent = readFile(join(nodeDir, 'task.md'), 'utf8')
    if (taskContent.includes('mode: agent')) return 'waiting'
  } catch {
    // пропускаємо
  }

  // 7. needs-plan — task.md є, mode:human (default), немає plan_NNN.md
  return 'needs-plan'
}

/**
 * Санітизує ім'я вузла для використання в назві worktree.
 * @param {string} name ім'я вузла (може містити /)
 * @returns {string} санітизоване ім'я
 */
export function sanitizeNodeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-')
}
